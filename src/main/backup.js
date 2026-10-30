'use strict';
// Backup of all notes as one .studynotes file (a zip with a manifest).
// Import never overwrites anything: it unpacks into a new folder.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { BACKUP_VERSION } = require('../shared/format');

async function* walk(dir, base = '') {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.name.endsWith('.tmp')) continue;
    if (e.isDirectory()) yield* walk(path.join(dir, e.name), rel);
    else if (e.isFile()) yield rel;
  }
}

/** Zip the whole library folder. Returns { files, bytes }. */
function exportLibrary(root, outFile, appVersion, onProgress) {
  return zipFolder(root, 'library/', outFile, appVersion, onProgress);
}

/**
 * One notebook as a .studynotes file (same format as a full backup, so
 * "Import notes…" restores it as a new notebook).
 */
function exportNotebookArchive(notebookDir, outFile, appVersion) {
  return zipFolder(notebookDir, 'library/' + path.basename(notebookDir) + '/', outFile, appVersion);
}

async function zipFolder(root, prefix, outFile, appVersion, onProgress) {
  const zip = new yazl.ZipFile();
  const tmp = outFile + '.part';
  const out = fs.createWriteStream(tmp);
  const done = new Promise((resolve, reject) => {
    out.on('close', resolve);
    out.on('error', reject);
    zip.outputStream.on('error', reject);
  });
  zip.outputStream.pipe(out);
  let files = 0;
  for await (const rel of walk(root)) {
    // PDFs and images are already compressed – store them as they are (much faster).
    const compress = !/\.(pdf|png|jpe?g|gif|webp)$/i.test(rel);
    zip.addFile(path.join(root, rel), prefix + rel, { compress });
    files++;
    if (onProgress && files % 50 === 0) onProgress(files);
  }
  const manifest = { format: 'studynotes-backup', version: BACKUP_VERSION, appVersion, created: new Date().toISOString(), files };
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
  zip.end();
  await done;
  await fsp.rename(tmp, outFile);
  return { files, bytes: (await fsp.stat(outFile)).size };
}

function openZip(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => (e ? reject(e) : resolve(z))));
}

function readEntries(zip) {
  return new Promise((resolve, reject) => {
    const list = [];
    zip.on('entry', (e) => { list.push(e); zip.readEntry(); });
    zip.on('end', () => resolve(list));
    zip.on('error', reject);
    zip.readEntry();
  });
}

function entryStream(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (e, s) => (e ? reject(e) : resolve(s))));
}

async function readManifest(zip, entries) {
  const m = entries.find((e) => e.fileName === 'manifest.json');
  if (!m) throw new Error('This is not a StudyNotes backup (manifest missing)');
  const chunks = [];
  for await (const c of await entryStream(zip, m)) chunks.push(c);
  const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (manifest.format !== 'studynotes-backup') throw new Error('This is not a StudyNotes backup');
  return manifest;
}

/**
 * Unpack a backup into `destDir` (must not exist yet). Entries that would
 * escape the destination ("zip slip") are rejected.
 */
async function importLibrary(zipFile, destDir, onProgress) {
  const zip = await openZip(zipFile);
  try {
    const entries = await readEntries(zip);
    const manifest = await readManifest(zip, entries);
    await fsp.mkdir(destDir, { recursive: false });
    const root = path.resolve(destDir);
    let n = 0;
    for (const e of entries) {
      if (!e.fileName.startsWith('library/') || e.fileName.endsWith('/')) continue;
      const rel = e.fileName.slice('library/'.length);
      const target = path.resolve(root, rel);
      if (!target.startsWith(root + path.sep)) throw new Error('Unsafe path in backup: ' + e.fileName);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await new Promise(async (resolve, reject) => {
        const rs = await entryStream(zip, e).catch(reject);
        if (!rs) return;
        const ws = fs.createWriteStream(target);
        rs.on('error', reject);
        ws.on('error', reject);
        ws.on('close', resolve);
        rs.pipe(ws);
      });
      n++;
      if (onProgress && n % 50 === 0) onProgress(n);
    }
    return { files: n, manifest };
  } finally {
    zip.close();
  }
}

module.exports = { exportLibrary, exportNotebookArchive, importLibrary };
