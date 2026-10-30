'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, clipboard, nativeTheme, safeStorage, net } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Readable } = require('stream');
const { fileURLToPath } = require('url');
const { Library, atomicWrite } = require('./library');
const { exportNotebook } = require('./export');
const external = require('./external');
const forms = require('./forms');
const fontkit = require('@pdf-lib/fontkit');
const RU = require('../shared/i18n-ru');
// Native dialogs in the interface language.
const tr = (s) => ((config && config.settings && config.settings.lang === 'ru' && RU.words[s]) || s);
const { searchLibrary } = require('./search');
const { exportLibrary, exportNotebookArchive, importLibrary } = require('./backup');
const localBackup = require('./localbackup');
const { sendMail, sendTelegram } = require('./send');
const { makeSettingsExport, readSettingsImport } = require('../shared/format');
const { CloudSync } = require('./cloud');

const DIST = path.join(__dirname, '..', '..', 'dist');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const TEST_MODE = !!process.env.STUDYNOTES_TEST;

if (TEST_MODE) app.disableHardwareAcceleration();
if (process.env.STUDYNOTES_USERDATA) app.setPath('userData', process.env.STUDYNOTES_USERDATA);

// Single instance: a second launch focuses the existing window.
if (!TEST_MODE && !app.requestSingleInstanceLock()) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'sn', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ---------- config ----------
const configFile = () => path.join(app.getPath('userData'), 'config.json');
let config = {};
async function loadConfig() {
  try { config = JSON.parse(await fsp.readFile(configFile(), 'utf8')); } catch { config = {}; }
  if (!config.libraryRoot) config.libraryRoot = process.env.STUDYNOTES_LIBRARY || path.join(app.getPath('documents'), 'StudyNotes');
  if (!config.settings) config.settings = {};
}
async function saveConfig() {
  await atomicWrite(configFile(), JSON.stringify(config, null, 2));
}

let library;
async function openLibrary() {
  library = new Library(config.libraryRoot);
  await library.ensureRoot();
}

// ---------- sn:// protocol: app files + library files with Range support ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.icc': 'application/octet-stream', '.map': 'application/json',
};

function resolveRequest(url) {
  const u = new URL(url);
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (u.host === 'app') {
    const p = path.resolve(DIST, rel || 'index.html');
    if (!p.startsWith(DIST + path.sep) && p !== DIST) return null;
    return p;
  }
  if (u.host === 'lib' && library) {
    try { return library.abs(rel); } catch { return null; }
  }
  return null;
}

async function serveFile(request) {
  const file = resolveRequest(request.url);
  if (!file) return new Response('Not found', { status: 404 });
  let stat;
  try { stat = await fsp.stat(file); } catch { return new Response('Not found', { status: 404 }); }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  // The app page (sn://app) reads pixels of pictures (sn://lib): allow it.
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': 'sn://app' };
  const range = request.headers.get('Range');
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    let start = m[1] === '' ? stat.size - Number(m[2]) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(stat.size - 1, end);
    if (start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(stat.size) },
  });
}

// ---------- window ----------
let win;
let closing = false;

function createWindow() {
  const bounds = config.windowBounds || { width: 1400, height: 900 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f4f2ee',
    title: 'StudyNotes',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (config.maximized && !TEST_MODE) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL('sn://app/index.html');

  // Block navigation away from the app; open external links in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('sn://app/')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // If the window's page crashes, reload it instead of leaving a blank window.
  // Notes were saved within ~2 s of every change, and the reload checks them.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || closing) return;
    openNotebooks = []; // the reloaded window opens no notebooks
    startupReport = { crashed: true, rendererCrash: true, repaired: [], unrepairable: [] };
    rendererReady = false;
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 500);
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });

  // Let the renderer flush unsaved ink before the window closes.
  win.on('close', (e) => {
    if (closing) return;
    e.preventDefault();
    config.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized()) config.windowBounds = win.getBounds();
    saveConfig().catch(() => {});
    // The renderer acknowledges at once and then saves for as long as it
    // needs. Only if it doesn't answer at all (crashed / hung) do we close.
    closeAcked = false;
    win.webContents.send('app:before-close');
    setTimeout(() => { if (!closeAcked && !win.isDestroyed()) { closing = true; win.close(); } }, 4000);
  });
}

let closeAcked = false;
ipcMain.handle('app:close-ack', () => { closeAcked = true; });
ipcMain.handle('app:close-ready', async () => {
  closing = true;
  await extWriteAll();
  await endSession();
  if (win && !win.isDestroyed()) win.close();
});

// ---------- IPC ----------
function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => fn(...args));
}

handle('app:info', () => ({
  libraryRoot: library.root,
  settings: config.settings,
  version: app.getVersion(),
  platform: process.platform,
  test: TEST_MODE,
}));
// Window frame / title bar follow the app theme.
handle('app:setTheme', (pref) => {
  nativeTheme.themeSource = pref === 'dark' ? 'dark' : pref === 'system' ? 'system' : 'light';
  if (win && !win.isDestroyed()) win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1b1c1f' : '#f4f2ee');
});
handle('app:setSettings', async (s) => { config.settings = { ...config.settings, ...s }; await saveConfig(); return config.settings; });
handle('app:chooseLibrary', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: tr('Choose library folder (tip: a folder inside OneDrive or Google Drive syncs automatically)'),
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: library.root,
  });
  if (r.canceled || !r.filePaths[0]) return null;
  config.libraryRoot = r.filePaths[0];
  await saveConfig();
  await openLibrary();
  return library.root;
});
handle('app:showLibraryFolder', () => shell.openPath(library.root));

handle('lib:list', (rel) => library.listFolder(rel));
handle('lib:allFolders', () => library.listAllFolders());
handle('lib:createFolder', (parent, name) => library.createFolder(parent, name));
handle('lib:createNotebook', (parent, opts) => library.createNotebook(parent, opts));
handle('lib:importDialog', async (parent) => {
  const r = await dialog.showOpenDialog(win, {
    title: tr('Import PDF'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  const out = [];
  for (const f of r.filePaths) out.push(await library.importPdf(parent, f));
  return out;
});
handle('lib:importFiles', async (parent, files) => {
  const out = [];
  for (const f of files) if (/\.pdf$/i.test(f)) out.push(await library.importPdf(parent, f));
  return out;
});
handle('lib:readNotebook', (rel) => library.readNotebook(rel));
handle('lib:writeNotebook', async (rel, nb) => { const r = await library.writeNotebook(rel, nb); extChanged(rel); return r; });
handle('lib:readPages', async (rel) => {
  const ids = await library.listPageFiles(rel);
  return library.readPages(rel, ids);
});
handle('lib:writePage', async (rel, id, data) => { const r = await library.writePage(rel, id, data); extChanged(rel); return r; });
handle('lib:cleanupPages', (rel) => {
  if (cloud && cloud.running) return []; // a sync may be writing this notebook right now
  return library.cleanupPages(rel, (f) => shell.trashItem(f).catch(() => fsp.rm(f, { force: true })));
});
handle('lib:readText', (rel, src) => library.readText(rel, src));
handle('lib:writeText', (rel, data, src) => library.writeText(rel, data, src));
handle('lib:writeAsset', (rel, bytes, ext) => library.writeAsset(rel, Buffer.from(bytes), ext));
const noExternal = (rel) => { if (external.isExternal(rel)) throw new Error('A PDF opened from your computer can\'t take more PDFs. Import it into the library to combine PDFs.'); };
handle('lib:addSourceDialog', async (rel) => {
  noExternal(rel);
  const r = await dialog.showOpenDialog(win, { title: tr('Insert PDF'), filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return library.addSource(rel, r.filePaths[0]);
});
handle('lib:addSourceFile', (rel, file) => {
  noExternal(rel);
  if (!/\.pdf$/i.test(file)) throw new Error('Not a PDF');
  return library.addSource(rel, file);
});
handle('lib:pickImages', async () => {
  const r = await dialog.showOpenDialog(win, { title: tr('Insert picture'), filters: [{ name: tr('Images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }], properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(async (f) => ({ name: path.basename(f), bytes: await fsp.readFile(f) })));
});
// Files copied in Explorer (Ctrl+C on a file). Electron 44+ only has the
// async ClipboardItem API; raw OS formats appear as
// 'electron application/osclipboard;format="..."' (Windows: FileNameW).
async function clipboardFilePaths() {
  const files = [];
  const items = await clipboard.read();
  for (const item of items) {
    for (const type of item.types) {
      const fmt = /format="([^"]+)"/.exec(type);
      if (type === 'text/uri-list') {
        const uris = String(await item.getType(type).then((b) => (typeof b === 'string' ? b : b.text())));
        for (const u of uris.split(/\r?\n/)) if (u.startsWith('file://')) files.push(fileURLToPath(u.trim()));
      } else if (fmt && /^FileNameW?$/i.test(fmt[1])) {
        const blob = await item.getType(type);
        const buf = Buffer.from(await blob.arrayBuffer());
        const textOf = /W$/i.test(fmt[1]) ? buf.toString('utf16le') : buf.toString('latin1');
        files.push(...textOf.split('\0').filter(Boolean));
      }
    }
  }
  return [...new Set(files)];
}

handle('clip:files', async () => {
  let files = [];
  try { files = await clipboardFilePaths(); } catch { /* nothing usable */ }
  const out = [];
  for (const f of files) {
    if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(f)) out.push({ kind: 'image', path: f, name: path.basename(f), bytes: await fsp.readFile(f).catch(() => null) });
    else if (/\.pdf$/i.test(f)) out.push({ kind: 'pdf', path: f, name: path.basename(f) });
  }
  return out.filter((x) => x.kind !== 'image' || x.bytes);
});
handle('file:read', (file) => {
  if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(file)) throw new Error('Not an image');
  return fsp.readFile(file);
});
handle('lib:writeCover', (rel, bytes) => library.writeCover(rel, Buffer.from(bytes)));
// Offline AI background removal (model loaded on first use, runs in a worker thread).
let bgremove = null;
handle('image:removeBackground', async (bytes) => {
  bgremove ||= require('./bgremove');
  return bgremove.removeBackground(Buffer.from(bytes));
});
app.on('will-quit', () => { if (bgremove) bgremove.dispose().catch(() => {}); });
handle('lib:rename', (rel, name) => library.rename(rel, name));
handle('lib:move', (rel, dest) => library.move(rel, dest));
handle('lib:duplicate', (rel) => library.duplicateNotebook(rel));
handle('lib:trash', async (rel) => {
  const p = library.abs(rel);
  if (library.isRoot(rel)) throw new Error('Cannot delete library root');
  try { await shell.trashItem(p); } catch { await library.remove(rel); }
});
handle('lib:search', (q) => searchLibrary(library, q));

handle('lib:export', async (rel, pageIds) => {
  const notebook = await library.readNotebook(rel);
  const r = await dialog.showSaveDialog(win, {
    title: tr('Export as PDF'),
    defaultPath: path.join(app.getPath('documents'), (notebook.title || 'Notebook').replace(/[<>:"/\\|?*]/g, ' ') + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  await exportTo(rel, notebook, pageIds, r.filePath);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
// Export without a dialog: automated tests only (writes to an arbitrary path).
if (TEST_MODE) {
  handle('lib:exportTo', async (rel, pageIds, outFile) => {
    const notebook = await library.readNotebook(rel);
    await exportTo(rel, notebook, pageIds, outFile);
    return outFile;
  });
}

async function exportTo(rel, notebook, pageIds, outFile) {
  await atomicWrite(outFile, Buffer.from(await buildPdf(rel, notebook, pageIds)));
}

async function buildPdf(rel, notebook, pageIds, beforeSave) {
  const dir = library.abs(rel);
  const ids = await library.listPageFiles(rel);
  const pages = await library.readPages(rel, ids);
  return exportNotebook({
    notebook, pages, pageIds, beforeSave,
    readSource: async (src) => {
      const s = notebook.sources && notebook.sources[src];
      const file = s ? s.file : src === 'main' ? 'source.pdf' : null;
      if (!file) return null;
      const abs = path.resolve(dir, file);
      if (!abs.startsWith(dir + path.sep)) return null;
      const bytes = await fsp.readFile(abs);
      // Fill & sign: typed form values go into the fields (flattened).
      if (src === 'main' && notebook.form && Object.keys(notebook.form).length) {
        try {
          return await forms.fillForm(bytes, notebook.form, await fsp.readFile(path.join(ASSETS, 'fonts', 'LiberationSans-Regular.ttf')), fontkit);
        } catch (err) {
          // never save silently without the typed values
          throw new Error('The form fields could not be filled (' + err.message + ')');
        }
      }
      return bytes;
    },
    readAsset: (name) => library.readAsset(rel, name),
    readFont: (file) => {
      if (!/^[A-Za-z0-9_.-]+\.ttf$/.test(file)) throw new Error('Bad font');
      return fsp.readFile(file === 'DejaVuSans.ttf' ? path.join(ASSETS, file) : path.join(ASSETS, 'fonts', file));
    },
  });
}

function safeName(s) {
  return String(s || 'Notebook').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().slice(0, 80) || 'Notebook';
}

// ---------- send ----------
handle('lib:send', async (rel, pageIds, via, label) => {
  const notebook = await library.readNotebook(rel);
  const dir = path.join(os.tmpdir(), 'StudyNotes-send');
  await fsp.mkdir(dir, { recursive: true });
  const name = safeName(notebook.title) + (label ? ' - ' + safeName(label) : '') + '.pdf';
  const file = path.join(dir, name);
  await exportTo(rel, notebook, pageIds, file);
  if (via === 'mail') return { file, ...(await sendMail(file, notebook.title + (label ? ' – ' + label : ''), shell)) };
  return { file, ...(await sendTelegram(file, shell)) };
});

// ---------- backup & settings transfer ----------
handle('app:exportSettings', async (settings) => {
  const r = await dialog.showSaveDialog(win, {
    title: tr('Export settings'),
    defaultPath: path.join(app.getPath('documents'), 'StudyNotes-settings.json'),
    filters: [{ name: tr('StudyNotes settings'), extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  await atomicWrite(r.filePath, JSON.stringify(makeSettingsExport(settings, app.getVersion()), null, 2));
  return r.filePath;
});
handle('app:importSettings', async () => {
  const r = await dialog.showOpenDialog(win, { title: tr('Import settings'), filters: [{ name: tr('StudyNotes settings'), extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const imported = readSettingsImport(JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8')));
  config.settings = { ...config.settings, ...imported };
  await saveConfig();
  return config.settings;
});
handle('lib:exportBackup', async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, {
    title: tr('Back up all notes'),
    defaultPath: path.join(app.getPath('documents'), `StudyNotes-backup-${stamp}.studynotes`),
    filters: [{ name: tr('StudyNotes backup'), extensions: ['studynotes'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const res = await exportLibrary(library.root, r.filePath, app.getVersion());
  return { file: r.filePath, ...res };
});
handle('lib:importBackup', async () => {
  const r = await dialog.showOpenDialog(win, { title: tr('Import notes'), filters: [{ name: tr('StudyNotes backup'), extensions: ['studynotes', 'zip'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return importBackupFile(r.filePaths[0]);
});
async function importBackupFile(file) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
  const rel = await library.createFolder('', `Imported ${stamp}`);
  await fsp.rmdir(library.abs(rel));
  const res = await importLibrary(file, library.abs(rel));
  return { rel, files: res.files };
}
if (TEST_MODE) {
  handle('test:exportBackup', async (file) => exportLibrary(library.root, file, app.getVersion()));
  handle('test:importBackup', async (file) => importBackupFile(file));
}

// ---------- startup ----------
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  for (const f of external.pdfArgs(argv)) openFileRequest(f);
});

// ---------- PDF files opened with StudyNotes ("Open with" / double click) ----------
// The notes are written into the PDF file itself: shortly after changes,
// when its tab is closed, on Ctrl+S and when the app closes.
let pendingFiles = external.pdfArgs(process.argv);
function openFileRequest(file) {
  if (win && !win.isDestroyed() && rendererReady) send('app:open-file', file);
  else pendingFiles.push(file);
}
let rendererReady = false;
handle('ext:pending', () => { rendererReady = true; const f = pendingFiles; pendingFiles = []; return f; });
handle('ext:open', async (file) => {
  const rel = '.external/' + external.idFor(file);
  // Already open in a tab (or being written): never rebuild it under the editor.
  await (extRunning.get(rel) || Promise.resolve()).catch(() => {});
  if (openNotebooks.includes(rel)) return { rel };
  return external.openExternal(library, file);
});
handle('ext:path', (rel) => external.externalPath(library, rel));
handle('ext:pickFill', async () => {
  const r = await dialog.showOpenDialog(win, { title: tr('Open a PDF to fill in and sign'), filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

// ---------- Fill & sign ----------
handle('form:fields', async (rel) => {
  const nb = await library.readNotebook(rel);
  const s = nb.sources && nb.sources.main;
  if (!nb.hasPdf || !s) return [];
  return forms.readFormFields(await fsp.readFile(path.join(library.abs(rel), s.file)));
});
const sigStore = () => forms.signatures(path.join(app.getPath('userData'), 'signatures'));
handle('sig:list', () => sigStore().list());
handle('sig:save', (bytes) => sigStore().save(bytes));
handle('sig:remove', (id) => sigStore().remove(id));

const extTimers = new Map(); // rel -> timeout
const extRunning = new Map(); // rel -> promise of the running write
function extChanged(rel) {
  if (!external.isExternal(rel)) return;
  clearTimeout(extTimers.get(rel));
  extTimers.set(rel, setTimeout(() => { extTimers.delete(rel); extWrite(rel).catch(() => {}); }, 15000));
}
// Writes one at a time per file; a request during a write runs once after it.
function extWrite(rel) {
  clearTimeout(extTimers.get(rel));
  extTimers.delete(rel);
  const prev = extRunning.get(rel) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try {
      const res = await external.writeBack(library, rel, (r, nb, beforeSave) => buildPdf(r, nb, null, beforeSave));
      if (res && res.conflict) send('ext:conflict', { rel, path: res.path });
      return res;
    } catch (err) {
      const busy = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES';
      send('ext:error', { rel, message: busy ? 'The PDF is open in another program. Close it there; StudyNotes will try again.' : err.message });
      extChanged(rel); // try again later
      throw err;
    }
  });
  extRunning.set(rel, next);
  next.finally(() => { if (extRunning.get(rel) === next) extRunning.delete(rel); }).catch(() => {});
  return next;
}
handle('ext:write', (rel) => extWrite(rel));
// Before the window closes: returns the files that could not be written.
async function extWriteAll() {
  const rels = new Set([...extTimers.keys(), ...extRunning.keys()]);
  const failed = [];
  await Promise.all([...rels].map((r) => extWrite(r).catch(async (err) => {
    clearTimeout(extTimers.get(r)); extTimers.delete(r);
    failed.push({ path: (await external.externalPath(library, r).catch(() => null)) || r, message: err.message });
  })));
  return failed;
}
handle('ext:writeAll', () => extWriteAll());

// ---------- Google Drive sync ----------
let cloud = null;
let openNotebooks = [];
function setupCloud() {
  cloud = new CloudSync({
    userData: app.getPath('userData'),
    libraryRoot: () => library.root,
    getConfig: () => config.settings.drive || {},
    electron: { safeStorage, shell, net },
    onStatus: (st) => send('cloud:status', st),
    openNotebooks: () => openNotebooks,
    // The 15-minute timer asks the window to save everything and then sync.
    requestSync: () => send('cloud:request-sync'),
    onLibraryChanged: () => send('lib:changed'),
    publishDeps: () => ({
      exists: (rel) => fs.existsSync(path.join(library.abs(rel), 'notebook.json')),
      exportPdf: async (rel, out) => exportTo(rel, await library.readNotebook(rel), null, out),
      exportArchive: (rel, out) => exportNotebookArchive(library.abs(rel), out, app.getVersion()),
    }),
  });
  cloud.schedule();
}
function send(channel, ...args) { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); }
handle('cloud:info', () => cloud.info());
handle('cloud:configure', async (cfg) => {
  config.settings.drive = { ...(config.settings.drive || {}), ...cfg };
  await saveConfig();
  cloud.schedule();
  return cloud.info();
});
handle('cloud:signIn', async () => { const acc = await cloud.signIn(); return { account: acc, info: await cloud.info() }; });
handle('cloud:signOut', async () => { await cloud.signOut(); return cloud.info(); });
handle('cloud:sync', (opts) => cloud.sync(opts || {}));
handle('cloud:openNotebooks', (list) => { openNotebooks = Array.isArray(list) ? list.map(String) : []; });

// ---------- local backups & crash recovery ----------
const backupDir = () => localBackup.backupRootFor(library.root, path.join(app.getPath('userData'), 'Backups'));
const sessionFile = () => path.join(app.getPath('userData'), 'session.json');
let startupReport = null; // { crashed, repaired, unrepairable }
let snapshotRunning = null;
function snapshotNow() {
  if (!snapshotRunning) {
    snapshotRunning = localBackup.snapshot({ root: library.root, backupDir: backupDir() })
      .catch((err) => { console.error('backup failed', err); return { saved: [], error: err.message }; })
      .finally(() => { snapshotRunning = null; });
  }
  return snapshotRunning;
}
async function startSession() {
  let crashed = false;
  try { crashed = !!JSON.parse(await fsp.readFile(sessionFile(), 'utf8')).running; } catch { /* first start or clean exit */ }
  await atomicWrite(sessionFile(), JSON.stringify({ running: true, started: Date.now(), version: app.getVersion() })).catch(() => {});
  if (crashed) {
    // The last session did not end normally (crash, power cut): check every
    // notebook file and put back intact copies from the backups where needed.
    const r = await localBackup.repairLibrary({ root: library.root, backupDir: backupDir() }).catch(() => ({ repaired: [], unrepairable: [] }));
    startupReport = { crashed: true, ...r };
  }
  setTimeout(snapshotNow, 15 * 1000);
  setInterval(snapshotNow, 60 * 60 * 1000);
}
async function endSession() {
  await fsp.rm(sessionFile(), { force: true }).catch(() => {});
}
handle('app:notices', () => fsp.readFile(path.join(ASSETS, 'THIRD-PARTY-NOTICES.txt'), 'utf8').catch(() => ''));
handle('app:startupReport', () => { const r = startupReport; startupReport = null; return r; });
handle('backup:snapshotNow', () => snapshotNow());
handle('backup:list', (rel) => localBackup.listSnapshots({ backupDir: backupDir(), root: library.root, rel }));
handle('backup:openFolder', async () => { await fsp.mkdir(backupDir(), { recursive: true }); return shell.openPath(backupDir()); });
handle('backup:restore', async (rel, stamp) => {
  // Restored as a copy next to the notebook – never overwrites anything.
  const src = await localBackup.snapshotDir({ backupDir: backupDir(), root: library.root, rel, stamp });
  const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const nb = JSON.parse(await fsp.readFile(path.join(src, 'notebook.json'), 'utf8'));
  return library.importNotebookCopy(src, parentRel, `${nb.title || 'Notebook'} (backup ${stamp.slice(0, 10)} ${stamp.slice(11, 13)}-00)`);
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await loadConfig();
  await openLibrary();
  protocol.handle('sn', serveFile);
  await startSession();
  setupCloud();
  setTimeout(() => external.cleanupExternal(library, new Set(openNotebooks)).catch(() => {}), 60 * 1000);
  // Pages that were damaged and had no local backup: forget them in the sync
  // state, so the next sync fetches the intact copy from Drive (instead of
  // treating them as deleted here and deleting them on Drive too).
  if (startupReport && startupReport.unrepairable && startupReport.unrepairable.length) {
    await cloud.forgetFiles(startupReport.unrepairable.filter((r) => !r.endsWith('/notebook.json'))).catch(() => {});
  }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
