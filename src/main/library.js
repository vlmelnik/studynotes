'use strict';
// Library storage: plain folders on disk so the user can put the library
// into OneDrive / Google Drive and get sync for free.
//
//   <root>/<Folder>/.../<Notebook>/notebook.json
//                                  source.pdf      (only for imported PDFs)
//                                  text.json       (extracted PDF text, for search)
//                                  cover.png
//                                  pages/<pageId>.json   (ink + text boxes)
//
// A directory is a notebook if it contains notebook.json, otherwise a folder.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { migrateNotebook, migratePage, pageIsEmpty, NOTEBOOK_VERSION } = require('../shared/format');
const { PAGE_SIZES, isDark } = require('../shared/paper');

const NOTEBOOK_FILE = 'notebook.json';
const VIEW_FILE = '.view.json';
const IMAGE_EXT = /^(png|jpg|jpeg|gif|webp)$/;
const PAGE_ID = /^[a-zA-Z0-9_-]+$/; // accepted when reading/writing a known id
const APP_ID = /^[a-z0-9]{6,40}$/;  // ids the app generates (hex / base36)

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function sanitizeName(name) {
  let n = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/[. ]+$/, ''); // Windows: no trailing dot/space
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = '_' + n;
  if (!n) n = 'Untitled';
  return n.slice(0, 120);
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function uniqueChild(dir, name) {
  const base = sanitizeName(name);
  let candidate = base;
  let i = 2;
  while (await exists(path.join(dir, candidate))) candidate = `${base} (${i++})`;
  return candidate;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Crash-safe write: write a temp file, then rename over the target.
// Retries because on Windows sync clients / antivirus briefly lock files.
async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${newId()}.tmp`;
  // Flush to the disk before the rename: after a power cut the file is then
  // either the old or the new version, never empty or half written.
  try {
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      lastErr = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) break;
      await sleep(50 * (attempt + 1));
    }
  }
  await fsp.rm(tmp, { force: true });
  throw lastErr;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && (err.code === 'ENOENT' || err instanceof SyntaxError)) return fallback;
    throw err;
  }
}

class Library {
  constructor(root) {
    this.root = path.resolve(root);
    this._nbCache = new Map(); // notebook dir -> { text, modified, mtimeMs } of notebook.json
    this._views = new Map();   // notebook dir -> last written .view.json text
  }

  async ensureRoot() {
    await fsp.mkdir(this.root, { recursive: true });
  }

  // Resolve a library-relative path ('' = root) and refuse anything outside.
  abs(rel) {
    const clean = String(rel || '').replace(/\\/g, '/');
    const p = path.resolve(this.root, clean);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) {
      throw new Error('Path outside library: ' + rel);
    }
    return p;
  }

  isRoot(rel) {
    return this.abs(rel) === this.root;
  }

  rel(abs) {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  async isNotebook(rel) {
    return exists(path.join(this.abs(rel), NOTEBOOK_FILE));
  }

  async listFolder(rel = '') {
    const dir = this.abs(rel);
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    const folders = [];
    const notebooks = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const childAbs = path.join(dir, e.name);
      const nbFile = path.join(childAbs, NOTEBOOK_FILE);
      if (await exists(nbFile)) {
        const nb = await readJson(nbFile, null);
        if (!nb) continue;
        const hasCover = await exists(path.join(childAbs, 'cover.png'));
        notebooks.push({
          path: this.rel(childAbs),
          name: e.name,
          title: nb.title || e.name,
          modified: nb.modified || 0,
          pageCount: Array.isArray(nb.pages) ? nb.pages.length : 0,
          hasPdf: !!nb.hasPdf,
          kind: nb.kind || 'notebook',
          coverColor: nb.coverColor || null,
          cover: hasCover ? (nb.coverVersion || 1) : 0,
          // first page, so the library can draw the real cover / paper
          first: firstPageLook(nb),
        });
      } else {
        folders.push({ path: this.rel(childAbs), name: e.name });
      }
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    notebooks.sort((a, b) => b.modified - a.modified);
    return { path: rel, folders, notebooks };
  }

  // All folders (for the "move to" picker).
  async listAllFolders() {
    const out = [{ path: '', name: 'Library' }];
    const walk = async (rel, depth) => {
      if (depth > 12) return;
      const { folders } = await this.listFolder(rel);
      for (const f of folders) {
        out.push({ path: f.path, name: f.name });
        await walk(f.path, depth + 1);
      }
    };
    await walk('', 0);
    return out;
  }

  // All notebooks anywhere in the library (for search).
  async listAllNotebooks() {
    const out = [];
    const walk = async (rel, depth) => {
      if (depth > 12) return;
      const { folders, notebooks } = await this.listFolder(rel);
      out.push(...notebooks);
      for (const f of folders) await walk(f.path, depth + 1);
    };
    await walk('', 0);
    return out;
  }

  async createFolder(parentRel, name) {
    const parent = this.abs(parentRel);
    await fsp.mkdir(parent, { recursive: true });
    const dirName = await uniqueChild(parent, name || 'New Folder');
    await fsp.mkdir(path.join(parent, dirName));
    return this.rel(path.join(parent, dirName));
  }

  async _createNotebookDir(parentRel, title) {
    const parent = this.abs(parentRel);
    if (await this.isNotebook(parentRel) && parentRel) throw new Error('Cannot create inside a notebook');
    await fsp.mkdir(parent, { recursive: true });
    const dirName = await uniqueChild(parent, title);
    const dir = path.join(parent, dirName);
    await fsp.mkdir(path.join(dir, 'pages'), { recursive: true });
    return dir;
  }

  // Blank notebook with one or more paper pages.
  async createNotebook(parentRel, { title = 'Untitled Notebook', paper = 'lined', size = 'A4', coverColor = '#3b6ea5', pageCount = 1, kind = 'notebook', landscape = false, pc = null, cover = null } = {}) {
    let [w, h] = PAGE_SIZES[size] || PAGE_SIZES.A4;
    if (landscape !== (w > h)) [w, h] = [h, w];
    const dir = await this._createNotebookDir(parentRel, title);
    const now = Date.now();
    if (kind === 'board') {
      const nb = {
        version: NOTEBOOK_VERSION, id: newId(), kind: 'board', title, created: now, modified: now, coverColor,
        hasPdf: false, sources: {}, paperDefault: 'board',
        // Endless page: world coordinates, the page box grows with the content.
        pages: [{ id: newId(), kind: 'board', paper: 'board', ox: -1600, oy: -1000, w: 3200, h: 2000 }],
      };
      await atomicWrite(path.join(dir, NOTEBOOK_FILE), JSON.stringify(nb));
      return this.rel(dir);
    }
    const nb = {
      version: NOTEBOOK_VERSION,
      kind: 'notebook',
      sources: {},
      id: newId(),
      title: title,
      created: now,
      modified: now,
      coverColor: cover ? cover.color : coverColor,
      hasPdf: false,
      paperDefault: paper,
      ...(pc && pc !== 'cream' ? { pcDefault: pc } : {}),
      pages: Array.from({ length: Math.min(500, Math.max(1, Number(pageCount) | 0)) }, () => ({ id: newId(), kind: 'paper', paper, w, h, ...(pc && pc !== 'cream' ? { pc } : {}) })),
    };
    if (cover && cover.color) {
      // First page: the cover, with the title as an editable text box.
      const c = { style: cover.style === 'solid' ? 'solid' : 'simple', color: String(cover.color), accent: String(cover.accent || '#ffffff') };
      const page = { id: newId(), kind: 'paper', paper: 'cover', cover: c, w, h };
      nb.pages.unshift(page);
      // Title size: as large as fits – the longest word on one line, at most 3 lines.
      const boxW = w * 0.66, cw = 0.56; // average bold character width / font size
      const longest = Math.max(1, ...String(title).split(/\s+/).map((x) => x.length));
      const fs = Math.max(12, Math.round(Math.min(Math.min(w, h) * 0.06, boxW / (longest * cw), (3 * boxW) / (Math.max(1, String(title).length) * cw))));
      const text = { id: newId(), x: Math.round(w * 0.16), y: Math.round(h * 0.34 - fs * 1.6), w: Math.round(w * 0.66), fs, c: isDark(c.color) ? '#ffffff' : '#2b2b2b', text: title, ff: 'carlito', b: true, lay: 'f' };
      await atomicWrite(this.pageFile(this.rel(dir), page.id), JSON.stringify({ strokes: [], texts: [text], items: [] }));
    }
    await atomicWrite(path.join(dir, NOTEBOOK_FILE), JSON.stringify(nb));
    return this.rel(dir);
  }

  // Copy a PDF into a new notebook. Page list is filled by the renderer on
  // first open (it needs pdf.js to know every page's size and rotation).
  async importPdf(parentRel, srcFile, title) {
    const t = title || path.basename(srcFile).replace(/\.pdf$/i, '');
    const dir = await this._createNotebookDir(parentRel, t);
    try {
      await fsp.copyFile(srcFile, path.join(dir, 'source.pdf'));
      const now = Date.now();
      const nb = {
        version: NOTEBOOK_VERSION,
        kind: 'notebook',
        sources: { main: { file: 'source.pdf', name: path.basename(srcFile) } },
        id: newId(),
        title: t,
        created: now,
        modified: now,
        coverColor: null,
        hasPdf: true,
        needsInit: true,
        paperDefault: 'blank',
        pages: [],
      };
      await atomicWrite(path.join(dir, NOTEBOOK_FILE), JSON.stringify(nb));
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true });
      throw err;
    }
    return this.rel(dir);
  }

  // The reading position (zoom, page, scroll) lives in ".view.json" next to
  // notebook.json: it is local to this PC, not synced and not part of backups,
  // so just opening and closing a notebook changes nothing that gets uploaded.
  async readNotebook(rel) {
    const nb = migrateNotebook(await readJson(path.join(this.abs(rel), NOTEBOOK_FILE)));
    const view = await readJson(path.join(this.abs(rel), VIEW_FILE), null).catch(() => null);
    if (view) nb.view = view;
    return nb;
  }

  async writeNotebook(rel, nb) {
    const dir = this.abs(rel);
    const { view, modified, ...content } = nb;
    if (view) {
      const v = JSON.stringify(view);
      if (this._views.get(dir) !== v) { await atomicWrite(path.join(dir, VIEW_FILE), v); this._views.set(dir, v); }
    }
    // Rewrite notebook.json only when its content really changed. The cache
    // is trusted only while the file's mtime is unchanged (sync, rename… may
    // have written it meanwhile).
    const file = path.join(dir, NOTEBOOK_FILE);
    const text = JSON.stringify(content);
    const st = await fsp.stat(file).catch(() => null);
    let cached = this._nbCache.get(dir);
    if (st && (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size)) {
      try {
        const { view: _v, modified: m, ...old } = JSON.parse(await fsp.readFile(file, 'utf8'));
        cached = { text: JSON.stringify(old), modified: m, mtimeMs: st.mtimeMs, size: st.size };
        this._nbCache.set(dir, cached);
      } catch { cached = null; } // damaged: write
    }
    if (st && cached && cached.text === text) { nb.modified = cached.modified; return nb.modified; }
    nb.modified = Date.now();
    await atomicWrite(file, JSON.stringify({ ...content, modified: nb.modified }));
    const st2 = await fsp.stat(file).catch(() => null);
    this._nbCache.set(dir, { text, modified: nb.modified, mtimeMs: st2 ? st2.mtimeMs : 0, size: st2 ? st2.size : -1 });
    return nb.modified;
  }

  pageFile(rel, pageId) {
    if (!PAGE_ID.test(pageId)) throw new Error('Bad page id');
    return path.join(this.abs(rel), 'pages', pageId + '.json');
  }

  async readPage(rel, pageId) {
    return migratePage(await readJson(this.pageFile(rel, pageId), {}));
  }

  async readPages(rel, pageIds) {
    const out = {};
    await Promise.all(pageIds.map(async (id) => { out[id] = await this.readPage(rel, id); }));
    return out;
  }

  async writePage(rel, pageId, data) {
    const file = this.pageFile(rel, pageId);
    if (pageIsEmpty(data)) {
      await fsp.rm(file, { force: true });
      return;
    }
    await atomicWrite(file, JSON.stringify(data));
  }

  // Which pages have stored data (so the renderer only loads those).
  async listPageFiles(rel) {
    const dir = path.join(this.abs(rel), 'pages');
    const files = await fsp.readdir(dir).catch(() => []);
    // Only files named like our own page ids. Anything else (e.g. a sync
    // client's conflict copy "abc (1).json" or "abc-PC.json") is left alone.
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => APP_ID.test(id));
  }

  // Delete page files no longer referenced by notebook.json.
  // Remove page files the notebook no longer lists. Files newer than
  // notebook.json are kept: they may have just arrived from another PC
  // (sync writes pages first, notebook.json last). `remove` lets the app use
  // the Recycle Bin.
  async cleanupPages(rel, remove = (f) => fsp.rm(f, { force: true })) {
    const nb = await this.readNotebook(rel);
    const nbTime = (await fsp.stat(path.join(this.abs(rel), NOTEBOOK_FILE))).mtimeMs;
    const used = new Set(nb.pages.map((p) => p.id));
    const removed = [];
    for (const id of await this.listPageFiles(rel)) {
      if (used.has(id)) continue;
      const f = this.pageFile(rel, id);
      const st = await fsp.stat(f).catch(() => null);
      if (!st || st.mtimeMs > nbTime) continue;
      await remove(f);
      removed.push(id);
    }
    return removed;
  }

  // Extracted PDF text for search: text.json for the main PDF,
  // sources/<id>.text.json for PDFs inserted later.
  textFile(rel, src = 'main') {
    if (src === 'main') return path.join(this.abs(rel), 'text.json');
    if (!PAGE_ID.test(src)) throw new Error('Bad source id');
    return path.join(this.abs(rel), 'sources', src + '.text.json');
  }

  async writeText(rel, data, src = 'main') {
    await atomicWrite(this.textFile(rel, src), JSON.stringify(data));
  }

  async readText(rel, src = 'main') {
    return readJson(this.textFile(rel, src), null);
  }

  // Copy a PDF into the notebook so its pages can be inserted. The renderer
  // records it in notebook.json (it owns that file while the notebook is open).
  async addSource(rel, srcFile) {
    const id = newId();
    const file = 'sources/' + id + '.pdf';
    await fsp.mkdir(path.join(this.abs(rel), 'sources'), { recursive: true });
    await fsp.copyFile(srcFile, path.join(this.abs(rel), file));
    return { id, file, name: path.basename(srcFile) };
  }

  // Store an image (pasted or inserted). Same content → same file.
  async writeAsset(rel, bytes, ext) {
    ext = String(ext || 'png').toLowerCase().replace('jpeg', 'jpg');
    if (!IMAGE_EXT.test(ext)) throw new Error('Unsupported image type: ' + ext);
    const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 20);
    const name = 'assets/' + hash + '.' + ext;
    const file = path.join(this.abs(rel), name);
    if (!(await exists(file))) await atomicWrite(file, bytes);
    return name;
  }

  async readAsset(rel, name) {
    if (!/^assets\/[a-f0-9]{20}\.(png|jpg|gif|webp)$/.test(name)) throw new Error('Bad asset name');
    return fsp.readFile(path.join(this.abs(rel), name));
  }

  async writeCover(rel, pngBuffer) {
    // notebook.json (coverVersion) is updated by the renderer through its
    // normal save, so there is no read-modify-write race with the editor.
    await atomicWrite(path.join(this.abs(rel), 'cover.png'), pngBuffer);
  }

  // Rename a folder, or a notebook (title + directory). Returns the new path.
  async rename(rel, newName) {
    if (this.isRoot(rel)) throw new Error('Cannot rename the library root');
    const src = this.abs(rel);
    const parent = path.dirname(src);
    const isNb = await this.isNotebook(rel);
    let target = src;
    const wanted = sanitizeName(newName);
    if (wanted !== path.basename(src)) {
      if (wanted.toLowerCase() === path.basename(src).toLowerCase()) {
        // Only the case changes ("physik" -> "Physik"): Windows sees the same
        // name, so go through a temporary name.
        target = path.join(parent, wanted);
        const tmp = path.join(parent, `${wanted}.${newId()}.renaming`);
        await fsp.rename(src, tmp);
        await fsp.rename(tmp, target);
      } else {
        const dirName = await uniqueChild(parent, newName);
        target = path.join(parent, dirName);
        await fsp.rename(src, target);
      }
    }
    const newRel = this.rel(target);
    if (isNb) {
      const nb = await this.readNotebook(newRel);
      nb.title = String(newName).trim() || nb.title;
      await this.writeNotebook(newRel, nb);
    }
    return newRel;
  }

  async move(rel, destFolderRel) {
    if (this.isRoot(rel)) throw new Error('Cannot move the library root');
    const src = this.abs(rel);
    const dest = this.abs(destFolderRel);
    if (dest === src || dest.startsWith(src + path.sep)) throw new Error('Cannot move a folder into itself');
    if (await this.isNotebook(destFolderRel) && destFolderRel) throw new Error('Destination is a notebook');
    if (path.dirname(src) === dest) return rel;
    const dirName = await uniqueChild(dest, path.basename(src));
    const target = path.join(dest, dirName);
    try {
      await fsp.rename(src, target);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fsp.cp(src, target, { recursive: true });
      await fsp.rm(src, { recursive: true, force: true });
    }
    return this.rel(target);
  }

  async duplicateNotebook(rel) {
    const src = this.abs(rel);
    const nb = await this.readNotebook(rel);
    const dirName = await uniqueChild(path.dirname(src), (nb.title || 'Notebook') + ' copy');
    const target = path.join(path.dirname(src), dirName);
    await fsp.cp(src, target, { recursive: true });
    const newRel = this.rel(target);
    const copy = await this.readNotebook(newRel);
    copy.id = newId();
    copy.title = dirName;
    await this.writeNotebook(newRel, copy);
    return newRel;
  }

  // Copy a notebook folder from outside the library (a backup) into `parentRel`
  // under a new name and id. Returns the new notebook's rel.
  async importNotebookCopy(srcDir, parentRel, title) {
    const parent = this.abs(parentRel);
    const dirName = await uniqueChild(parent, title);
    const target = path.join(parent, dirName);
    await fsp.cp(srcDir, target, { recursive: true });
    const newRel = this.rel(target);
    const nb = await this.readNotebook(newRel);
    nb.id = newId();
    nb.title = dirName;
    await this.writeNotebook(newRel, nb);
    return newRel;
  }

  // Permanently delete (main process prefers shell.trashItem; this is the fallback).
  async remove(rel) {
    if (this.isRoot(rel)) throw new Error('Cannot delete the library root');
    await fsp.rm(this.abs(rel), { recursive: true, force: true });
  }
}

function firstPageLook(nb) {
  const p = Array.isArray(nb.pages) && nb.pages[0];
  if (!p || p.kind !== 'paper') return null;
  const out = { paper: p.paper, w: p.w, h: p.h };
  if (p.cover) out.cover = p.cover;
  if (p.pc) out.pc = p.pc;
  return out;
}

module.exports = { Library, atomicWrite, sanitizeName, newId, PAGE_SIZES };
