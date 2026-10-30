'use strict';
// "Open with StudyNotes" for any PDF on the computer: the notes are written
// into that PDF file itself, so every PDF reader shows them.
//
// To keep everything editable, the written PDF also carries (invisible to
// readers) the original PDF and the StudyNotes data in two extra streams of
// its catalog (/StudyNotesOriginal, /StudyNotesData). Opening such a file
// again restores the editable notebook from them. If another program saved
// the file in between and dropped those streams, the file simply opens as a
// normal PDF (with the notes already printed on it).
//
// While a file is open, its working copy lives in "<library>/.external/<id>"
// (a dot folder: not shown in the library, not synced, not backed up).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = require('pdf-lib');
const { atomicWrite, newId } = require('./library');
const { NOTEBOOK_VERSION } = require('../shared/format');

const KEY_ORIG = 'StudyNotesOriginal';
const KEY_DATA = 'StudyNotesData';
const DATA_VERSION = 1;
const STATE_FILE = 'external.json'; // { path, mtimeMs } of the file on disk, last time we read or wrote it
const ASSET_RE = /^assets\/[a-f0-9]{20}\.(png|jpg|gif|webp)$/;

const idFor = (file) => crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16);

function streamBytes(doc, key) {
  const ref = doc.catalog.get(PDFName.of(key));
  const obj = ref && doc.context.lookup(ref);
  if (!(obj instanceof PDFRawStream)) return null;
  return Buffer.from(decodePDFRawStream(obj).decode());
}

/** { original: Buffer, data: object } embedded by StudyNotes, or null. */
async function readEmbedded(bytes) {
  let doc;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch { return null; }
  const original = streamBytes(doc, KEY_ORIG);
  const dataBytes = streamBytes(doc, KEY_DATA);
  if (!original || !dataBytes) return null;
  try {
    const data = JSON.parse(dataBytes.toString('utf8'));
    if (!data || data.format !== 'studynotes-pdf' || !data.notebook) return null;
    return { original, data };
  } catch { return null; }
}

const samePath = (a, b) => (process.platform === 'win32' || process.platform === 'darwin'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b));

/** Notes in the working copy that have not reached the PDF file yet. */
async function hasUnwrittenNotes(dir, st) {
  const since = (st && st.syncedAt) || 0;
  const files = []; // the notes themselves (notebook.json also changes just from preparing the pages)
  try { for (const f of await fsp.readdir(path.join(dir, 'pages'))) files.push(path.join(dir, 'pages', f)); } catch { /* none */ }
  for (const f of files) {
    try { if ((await fsp.stat(f)).mtimeMs > since + 1) return true; } catch { /* gone */ }
  }
  return false;
}

/**
 * Prepare the working notebook for `file`.
 * - The working copy from last time is reused when the file was not changed
 *   by another program since (so notes that did not reach the file yet stay).
 * - If the file was changed elsewhere AND the working copy has notes that
 *   never reached it, those notes are kept as a notebook in the library
 *   (returned as `recovered`) before the file is opened fresh.
 * - Protected (encrypted) PDFs can't be rewritten: they are imported into the
 *   library as a normal notebook instead (`imported: true`).
 * @param {Library} library
 * @returns {Promise<{ rel: string, recovered?: string, imported?: boolean }>}
 */
async function openExternal(library, file) {
  const abs = path.resolve(file);
  const stat = await fsp.stat(abs);
  if (!stat.isFile()) throw new Error('Not a file');
  const rel = '.external/' + idFor(abs);
  const dir = library.abs(rel);
  const prev = await readState(dir);
  const haveCopy = fs.existsSync(path.join(dir, 'notebook.json'));
  if (prev && haveCopy && samePath(prev.path, abs) && prev.mtimeMs === stat.mtimeMs) return { rel };

  const bytes = await fsp.readFile(abs);
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message))) {
      return { rel: await library.importPdf('', abs), imported: true };
    }
    throw new Error('This file is not a readable PDF');
  }
  let recovered;
  if (prev && haveCopy && (await hasUnwrittenNotes(dir, prev))) {
    const old = await library.readNotebook(rel).catch(() => ({}));
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    const keptRel = await library.importNotebookCopy(dir, '', `${old.title || 'PDF'} (notes not saved into the file, ${stamp})`);
    await fsp.rm(path.join(library.abs(keptRel), STATE_FILE), { force: true });
    recovered = keptRel.split('/').pop();
  }
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(path.join(dir, 'pages'), { recursive: true });
  const emb = await readEmbedded(bytes);
  const name = path.basename(abs);
  const title = name.replace(/\.pdf$/i, '');
  if (emb) {
    await atomicWrite(path.join(dir, 'source.pdf'), emb.original);
    const { notebook, pages = {}, assets = {} } = emb.data;
    for (const [id, page] of Object.entries(pages)) {
      if (/^[A-Za-z0-9_-]{4,40}$/.test(id)) await atomicWrite(path.join(dir, 'pages', id + '.json'), JSON.stringify(page));
    }
    for (const [assetName, b64] of Object.entries(assets)) {
      if (ASSET_RE.test(assetName)) await atomicWrite(path.join(dir, ...assetName.split('/')), Buffer.from(b64, 'base64'));
    }
    // Only the main PDF travels inside the file: pages of other inserted PDFs can't come back.
    const nbPages = (notebook.pages || []).filter((p) => !(p.kind === 'pdf' && p.src && p.src !== 'main'));
    const nb = { ...notebook, title, pages: nbPages, sources: { main: { file: 'source.pdf', name } } };
    await atomicWrite(path.join(dir, 'notebook.json'), JSON.stringify(nb));
  } else {
    await atomicWrite(path.join(dir, 'source.pdf'), bytes);
    const now = Date.now();
    const nb = {
      version: NOTEBOOK_VERSION, kind: 'notebook', id: newId(), title, created: now, modified: now, coverColor: null,
      sources: { main: { file: 'source.pdf', name } }, hasPdf: true, needsInit: true, paperDefault: 'blank', pages: [],
    };
    await atomicWrite(path.join(dir, 'notebook.json'), JSON.stringify(nb));
  }
  await writeState(dir, { path: abs, mtimeMs: stat.mtimeMs, syncedAt: Date.now() });
  return { rel, recovered };
}

async function readState(dir) {
  try { return JSON.parse(await fsp.readFile(path.join(dir, STATE_FILE), 'utf8')); } catch { return null; }
}
const writeState = (dir, st) => atomicWrite(path.join(dir, STATE_FILE), JSON.stringify(st));

/** Free name "<base> (StudyNotes).pdf", "<base> (StudyNotes 2).pdf", … next to `file`. */
function copyName(file) {
  const dir = path.dirname(file), base = path.basename(file).replace(/\.pdf$/i, '').replace(/ \(StudyNotes( \d+)?\)$/, '');
  for (let i = 1; ; i++) {
    const p = path.join(dir, `${base} (StudyNotes${i > 1 ? ' ' + i : ''}).pdf`);
    if (!fs.existsSync(p)) return p;
  }
}

/**
 * Write the notes back into the original file. If another program changed
 * the file meanwhile, nothing of it is overwritten: the notes go into a copy
 * next to it ("… (StudyNotes).pdf"), which is used from then on.
 * @param {(rel, notebook, beforeSave) => Promise<Uint8Array>} exportPdf  builds the PDF
 * @returns {Promise<{ path: string, conflict?: boolean } | null>} null if nothing to do
 */
async function writeBack(library, rel, exportPdf) {
  const dir = library.abs(rel);
  const st = await readState(dir);
  if (!st || !st.path) throw new Error('Not an opened PDF file');
  const notebook = await library.readNotebook(rel);
  if (notebook.needsInit) return null;
  const started = Date.now();
  const original = await fsp.readFile(path.join(dir, 'source.pdf'));
  const ids = await library.listPageFiles(rel);
  const pages = await library.readPages(rel, ids);
  const assets = {};
  for (const p of Object.values(pages)) {
    for (const it of (p && p.items) || []) {
      if (it.type === 'img' && ASSET_RE.test(it.src || '') && !assets[it.src]) {
        const b = await library.readAsset(rel, it.src).catch(() => null);
        if (b) assets[it.src] = Buffer.from(b).toString('base64');
      }
    }
  }
  const { view, ...nbClean } = notebook;
  const data = { format: 'studynotes-pdf', version: DATA_VERSION, notebook: nbClean, pages, assets };
  const bytes = await exportPdf(rel, notebook, async (doc) => {
    const put = (key, buf) => doc.catalog.set(PDFName.of(key), doc.context.register(doc.context.flateStream(buf)));
    put(KEY_ORIG, original);
    put(KEY_DATA, Buffer.from(JSON.stringify(data), 'utf8'));
  });
  let target = st.path, conflict = false;
  const now = await fsp.stat(target).catch(() => null);
  if (now && now.mtimeMs !== st.mtimeMs) { target = copyName(st.path); conflict = true; }
  await atomicWrite(target, Buffer.from(bytes));
  const after = await fsp.stat(target);
  await writeState(dir, { path: target, mtimeMs: after.mtimeMs, syncedAt: started });
  return { path: target, conflict };
}

/** Remove working copies not used for `days` whose notes are all in their file. */
async function cleanupExternal(library, keep = new Set(), days = 60) {
  const base = library.abs('.external');
  let names = [];
  try { names = await fsp.readdir(base); } catch { return; }
  for (const n of names) {
    const rel = '.external/' + n;
    if (!isExternal(rel) || keep.has(rel)) continue;
    const dir = path.join(base, n);
    const st = await readState(dir);
    if (!st || Date.now() - (st.syncedAt || 0) < days * 86400e3) continue;
    if (await hasUnwrittenNotes(dir, st)) continue;
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Path of the PDF on disk behind an opened working copy, or null. */
async function externalPath(library, rel) {
  if (!isExternal(rel)) return null;
  const st = await readState(library.abs(rel));
  return st ? st.path : null;
}
const isExternal = (rel) => /^\.external\/[a-f0-9]{16}$/.test(String(rel || ''));

/** PDF paths among command line arguments (Windows "Open with"). */
function pdfArgs(argv) {
  return argv.slice(1).filter((a) => /\.pdf$/i.test(a) && !a.startsWith('-') && fs.existsSync(a));
}

module.exports = { openExternal, writeBack, readEmbedded, pdfArgs, idFor, externalPath, isExternal, cleanupExternal, hasUnwrittenNotes };
