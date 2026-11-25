'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, clipboard, ClipboardItem, nativeTheme, safeStorage, net, utilityProcess } = require('electron');
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
const { Ocr } = require('./ocr');
const handwriting = require('./handwriting');

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
  win.on('closed', () => { try { reader.close(); } catch { /* not created */ } });

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
handle('lib:readOcr', (rel, src) => library.readOcr(rel, src));
handle('lib:writeOcr', (rel, data, src) => library.writeOcr(rel, data, src));
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

// Copy in StudyNotes: a picture of the selection for other programs (a lone
// picture as its own bytes, otherwise what the selection shows on screen),
// its text, and HTML with both plus an HTML comment that tells our own paste
// to use the internal clip instead.
handle('clip:write', async ({ png, rect, text, html }) => {
  let bytes = png ? Buffer.from(png) : null;
  if (!bytes && rect && win && rect.width >= 1 && rect.height >= 1) {
    const shot = await win.webContents.capturePage({ x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    if (!shot.isEmpty()) bytes = shot.toPNG();
  }
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/\n/g, '<br>');
  const items = { 'text/plain': text || '', 'text/html': (bytes ? `<img src="data:image/png;base64,${bytes.toString('base64')}">` : '') + (text ? `<p>${esc(text)}</p>` : '') + (html || '') };
  if (bytes) items['image/png'] = new Blob([bytes], { type: 'image/png' });
  await clipboard.write([new ClipboardItem(items)]);
  return !!bytes;
});

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

// inline: pictures of extension elements (formulas …) drawn by the renderer
handle('lib:export', async (rel, pageIds, inline) => {
  const notebook = await library.readNotebook(rel);
  const r = await dialog.showSaveDialog(win, {
    title: tr('Export as PDF'),
    defaultPath: path.join(app.getPath('documents'), (notebook.title || 'Notebook').replace(/[<>:"/\\|?*]/g, ' ') + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  await exportTo(rel, notebook, pageIds, r.filePath, inline);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
// Export without a dialog: automated tests only (writes to an arbitrary path).
if (TEST_MODE) {
  handle('lib:exportTo', async (rel, pageIds, outFile, inline) => {
    const notebook = await library.readNotebook(rel);
    await exportTo(rel, notebook, pageIds, outFile, inline);
    return outFile;
  });
}

async function exportTo(rel, notebook, pageIds, outFile, inline = null) {
  // Settings → "Export handwriting as text" (Windows' handwriting recognizer);
  // only for exports, not when a PDF opened from disk is saved back
  const inkTextAll = config.settings.exportInkText ? (groups) => handwriting.recognizeMany(groups, config.settings.inkRecognizer || '') : null;
  await atomicWrite(outFile, Buffer.from(await buildPdf(rel, notebook, pageIds, undefined, inkTextAll, inline)));
}

async function buildPdf(rel, notebook, pageIds, beforeSave, inkTextAll = null, inline = null) {
  const dir = library.abs(rel);
  const ids = await library.listPageFiles(rel);
  const pages = await library.readPages(rel, ids);
  return exportNotebook({
    notebook, pages, pageIds, beforeSave, inkTextAll, inline,
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
// Eyedropper: the colour of one screen pixel of the window (everything
// that is visible there: PDF, ink, text, pictures).
handle('screen:pixel', async (x, y) => {
  if (!win) return null;
  const img = await win.webContents.capturePage({ x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), width: 1, height: 1 });
  const b = img.toBitmap(); // BGRA
  if (!b || b.length < 4) return null;
  const hex = (v) => v.toString(16).padStart(2, '0');
  return `#${hex(b[2])}${hex(b[1])}${hex(b[0])}`;
});
// ---------- handwriting → text (Windows' recognizer) ----------
handle('ink:recognize', (strokes, recognizer) => handwriting.recognize(strokes, recognizer));
handle('ink:recognizers', () => handwriting.recognizers());
handle('ink:recognizeLive', (strokes, recognizer) => handwriting.recognizeLive(strokes, recognizer));
app.on('will-quit', () => handwriting.stopLive());

// ---------- text recognition add-on ----------
let ocr = null;
const getOcr = () => {
  if (ocr) return ocr;
  ocr = new Ocr({
    dir: path.join(app.getPath('userData'), 'addons', 'ocr'),
    // (unpacked from the app archive: the recognition worker reads plain files)
    bundledDir: path.join(app.getAppPath(), 'assets', 'ocr').replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'),
    // (tests: a fixed number of readers, whatever the machine has)
    maxWorkers: Number(process.env.STUDYNOTES_OCR_WORKERS) || undefined,
  });
  ocr.forgetDownloaded().catch(() => {});
  return ocr;
};
handle('ocr:status', () => getOcr().status());
handle('ocr:recognize', (image, langs) => getOcr().recognize(image, langs));
handle('ocr:google', (images, lang) => cloud.ocrImages(images, lang));
// The dictionaries take a few seconds to load (and ~350 MB): in a process of
// their own, so the app never freezes; it ends after 2 idle minutes.
const speller = { proc: null, timer: null, seq: 0, wait: new Map() };
function spellCheck(lines) {
  if (!speller.proc) {
    const proc = utilityProcess.fork(path.join(__dirname, 'spell-proc.js'), [], { serviceName: 'StudyNotes spelling' });
    proc.on('message', ({ id, res, err }) => { const w = speller.wait.get(id); speller.wait.delete(id); if (w) (err ? w.reject(new Error(err)) : w.resolve(res)); });
    // (only the requests sent to this process: a new one may already be running)
    proc.on('exit', () => { if (speller.proc === proc) speller.proc = null; for (const [id, w] of speller.wait) if (w.proc === proc) { speller.wait.delete(id); w.reject(new Error('spelling check ended')); } });
    speller.proc = proc;
  }
  clearTimeout(speller.timer);
  // (forgotten at once when ended: a request in the moment before the
  // process is gone starts a new one instead of being lost with it)
  speller.timer = setTimeout(() => { const p = speller.proc; if (p && !speller.wait.size) { speller.proc = null; p.kill(); } }, 120000);
  const id = ++speller.seq;
  return new Promise((resolve, reject) => {
    // a stuck check never holds up the text recognition: the reading is used as it is
    const t = setTimeout(() => {
      if (!speller.wait.delete(id)) return;
      reject(new Error('spelling check timed out'));
      const p = speller.proc; speller.proc = null; if (p) p.kill();
    }, 60000);
    speller.wait.set(id, { proc: speller.proc, resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    speller.proc.postMessage({ id, lines });
  });
}
handle('ocr:spell', (lines) => spellCheck(lines));
app.on('will-quit', () => { if (speller.proc) speller.proc.kill(); });
app.on('will-quit', () => { if (ocr) ocr.stop(); });

// ---------- AI (1.9) ----------
// Providers and keys live here only; the renderer builds the request and checks the plan.
const { Ai, PROVIDERS } = require('./ai');
let ai = null;
const aiInst = () => (ai ||= new Ai({ dir: app.getPath('userData'), safeStorage: require('electron').safeStorage }));
handle('ai:info', async () => {
  const a = aiInst();
  const keys = {};
  for (const p of Object.keys(PROVIDERS)) keys[p] = PROVIDERS[p].key ? await a.hasKey(p) : true;
  return { providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, { name: v.name, key: v.key, base: v.base }])), keys, used: await a.usedThisMonth() };
});
handle('ai:setKey', (provider, key) => aiInst().setKey(provider, key));
handle('ai:models', (cfg) => aiInst().models(cfg));
handle('ai:request', (cfg, req) => aiInst().request(cfg, req));

// ---------- Claude (MCP) ----------
// Claude Desktop starts mcp-bridge.js, which connects to this pipe. Off until
// the user switches it on (Settings → Add-ons); tool calls run in the renderer.
const { startMcp } = require('./mcp-server');
let mcp = null;
const mcpPending = new Map();
let mcpSeq = 0;
function mcpCall(name, args) {
  if (!win || win.isDestroyed()) return Promise.reject(new Error('The StudyNotes window is closed.'));
  const id = ++mcpSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { mcpPending.delete(id); reject(new Error('StudyNotes did not answer in time.')); }, 120000);
    mcpPending.set(id, { resolve, reject, timer });
    win.webContents.send('mcp:call', { id, name, args });
  });
}
ipcMain.on('mcp:result', (_e, id, payload) => {
  const p = mcpPending.get(id);
  if (!p) return;
  mcpPending.delete(id);
  clearTimeout(p.timer);
  if (payload && payload.ok) p.resolve(payload.result); else p.reject(new Error((payload && payload.error) || 'failed'));
});
handle('mcp:setEnabled', async (on) => {
  if (on && !mcp) {
    try { mcp = await startMcp({ version: app.getVersion(), call: mcpCall }); } catch (err) { mcp = null; throw new Error('Could not open the connection for Claude: ' + err.message); }
  } else if (!on && mcp) { const m = mcp; mcp = null; await m.stop(); }
  return !!mcp;
});
// Claude Desktop's config file. The Microsoft Store (MSIX) build keeps its own
// copy under %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude, so
// StudyNotes is written into every copy that exists.
function claudeConfigFiles() {
  if (process.env.STUDYNOTES_CLAUDE_CONFIG) return [process.env.STUDYNOTES_CLAUDE_CONFIG];
  const home = app.getPath('home');
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
  if (process.platform !== 'win32') return [path.join(home, '.config', 'Claude', 'claude_desktop_config.json')];
  const files = [path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')];
  const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
  try {
    for (const d of fs.readdirSync(pkgs)) if (/^Claude_/i.test(d)) files.push(path.join(pkgs, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
  } catch { /* no Store apps */ }
  return files;
}
const mcpEntry = () => ({ command: process.execPath, args: [path.join(__dirname, 'mcp-bridge.js')], env: { ELECTRON_RUN_AS_NODE: '1' } });
// Adds StudyNotes to Claude Desktop's list of MCP servers (a backup of each file is kept).
handle('mcp:installClaude', async () => {
  const written = [];
  for (const file of claudeConfigFiles()) {
    let cfg = {};
    const old = await fsp.readFile(file, 'utf8').catch(() => null);
    if (old !== null && old.trim()) {
      try { cfg = JSON.parse(old); } catch { throw new Error('Claude Desktop\'s settings file could not be read, so it was left unchanged: ' + file); }
      await fsp.writeFile(file + '.bak', old);
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Unexpected content in ' + file);
    cfg.mcpServers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
    cfg.mcpServers.studynotes = mcpEntry();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, JSON.stringify(cfg, null, 2));
    written.push(file);
  }
  return { file: written[0], files: written };
});
// Checks the connection the way Claude Desktop uses it: the config entry, and
// the bridge started from it answering initialize and tools/list.
handle('mcp:test', async () => {
  const files = [];
  let entry = null;
  for (const file of claudeConfigFiles()) {
    const txt = await fsp.readFile(file, 'utf8').catch(() => null);
    let e = null;
    try { e = txt ? (JSON.parse(txt).mcpServers || {}).studynotes || null : null; } catch { /* unreadable */ }
    files.push({ file, exists: txt !== null, connected: !!e });
    entry ||= e;
  }
  const out = { files, pipe: !!mcp, bridge: null, tools: 0, error: null };
  const use = entry || mcpEntry();
  await new Promise((resolve) => {
    const { spawn } = require('child_process');
    let p;
    try { p = spawn(use.command, use.args || [], { env: { ...process.env, ...(use.env || {}), STUDYNOTES_MCP_NO_LAUNCH: '1', STUDYNOTES_MCP_WAIT: '1500' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (err) { out.error = err.message; resolve(); return; }
    let buf = '', err = '';
    const done = () => { clearTimeout(timer); try { p.kill(); } catch { /* gone */ } resolve(); };
    const timer = setTimeout(() => { out.error = out.error || 'The bridge did not answer within 10 s.' + (err ? ' ' + err.slice(0, 300) : ''); done(); }, 10000);
    p.on('error', (e) => { out.error = 'The bridge could not be started: ' + e.message; done(); });
    p.stderr.on('data', (c) => { err += c; });
    p.stdout.on('data', (c) => {
      buf += c;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          if (m.error) { out.bridge = 'started'; out.error = m.error.message; done(); return; }
          out.bridge = 'ok';
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        } else if (m.id === 2) { out.tools = (m.result && m.result.tools || []).length; done(); return; }
      }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'studynotes-test', version: '1' } } }) + '\n');
  });
  return out;
});
// Chat with the user's own Claude Code (src/main/claude-code.js): it reaches the
// notebooks only through the MCP bridge above.
const { ClaudeCodeChat, ChatHistory } = require('./claude-code');
let chat = null;
const chatInst = () => (chat ||= new ClaudeCodeChat({ dir: path.join(app.getPath('userData'), 'claude-chat'), bridge: mcpEntry }));
handle('chat:info', (bin) => chatInst().info(bin));
handle('chat:send', (id, req) => {
  chatInst().send(id, req, (ev) => { if (win && !win.isDestroyed()) win.webContents.send('chat:event', id, ev); }).catch((err) => {
    if (win && !win.isDestroyed()) win.webContents.send('chat:event', id, { kind: 'done', error: String(err.message || err) });
  });
  return true;
});
handle('chat:stop', (id) => chatInst().stop(id));
// Speech to text on this computer (src/main/speech.js), for audio in the chat
const { Speech, MODELS: SPEECH_MODELS, LANGUAGES: SPEECH_LANGS } = require('./speech');
let speech = null;
const speechInst = () => (speech ||= new Speech(path.join(app.getPath('userData'), 'models', 'speech')));
const speechProgress = (id) => (f, file) => { if (win && !win.isDestroyed()) win.webContents.send('speech:progress', id, f, file); };
handle('speech:info', () => ({ models: Object.fromEntries(Object.entries(SPEECH_MODELS).map(([k, m]) => [k, m.label])), languages: SPEECH_LANGS }));
handle('speech:status', (key) => speechInst().status(key));
handle('speech:download', (key, id) => speechInst().download(key, speechProgress(id)));
handle('speech:remove', (key) => speechInst().remove(key));
handle('speech:transcribe', (samples, opts, id) => speechInst().transcribe(samples, opts, speechProgress(id)));
// Telegram sticker packs (src/main/stickers.js)
const { Stickers } = require('./stickers');
let stickerStore = null;
const stickersInst = () => (stickerStore ||= new Stickers(path.join(app.getPath('userData'), 'stickers')));
handle('stickers:pack', (link) => stickersInst().pack(link));
handle('stickers:picture', (id) => stickersInst().picture(id));
handle('stickers:remove', (name) => stickersInst().remove(name));
// The reference reader (src/main/reader-window.js): floating ⇄ docked
const { ReaderWindow } = require('./reader-window');
const reader = new ReaderWindow({ main: () => win, config: () => config, save: () => saveConfig(), test: TEST_MODE });
handle('reader:open', (state) => reader.open(state));
handle('reader:dock', (state, ratio, side) => reader.dock(state, ratio, side));
handle('reader:undock', (state, rect) => reader.undock(state, rect));
handle('reader:close', () => reader.close());
// Study session (src/main/study.js): a bar over every app, captures, the material back at the end
const { Study } = require('./study');
const study = new Study({ main: () => win, dir: path.join(app.getPath('userData'), 'study'), test: TEST_MODE });
handle('study:start', (opts) => study.start(opts));
handle('study:state', () => study.state());
handle('study:capture', (kind) => study.capture(kind));
handle('study:windows', () => study.windows());
handle('study:takeWindow', (id) => study.takeWindow(id));
handle('study:note', (text) => study.note(text));
handle('study:remove', (id) => study.remove(id));
handle('study:finish', (cancel) => study.finish(!!cancel));
handle('study:image', (hash) => study.image(hash));
ipcMain.handle('study:barHeight', (e, h) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) { const b = w.getBounds(); w.setBounds({ ...b, height: Math.max(56, Math.min(420, Math.round(h))) }); } });
handle('snip:done', (rect) => { if (study.snipDone) study.snipDone(rect); });
app.on('will-quit', () => { if (study.active) study.finish(true); });
const chatHistory = new ChatHistory(path.join(app.getPath('userData'), 'chats.json'));
handle('chat:list', () => chatHistory.list());
handle('chat:get', (id) => chatHistory.get(id));
handle('chat:save', (c) => chatHistory.save(c));
handle('chat:delete', (id) => chatHistory.remove(id));
app.on('will-quit', () => { if (chat) for (const id of [...chat.runs.keys()]) chat.stop(id); });
app.on('will-quit', () => { if (mcp) mcp.stop().catch(() => {}); });
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
