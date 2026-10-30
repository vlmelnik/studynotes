'use strict';
// Local backups ("snapshots") of every notebook that changed, kept next to the
// library folder:
//
//   <Library> Backups/
//     index.json                         which notebook was saved when
//     2026-10-20 14-00/<notebook rel>/   one folder per hour with changed notebooks
//
// Kept: every snapshot of today, the last one of each of the previous 7 days,
// and always the newest snapshot of every notebook. Page files are copied; big
// files that never change once written (PDFs, pictures) are hard-linked, so a
// snapshot costs almost no disk space.
//
// Also repairs damaged page / notebook files (after a crash or power cut) from
// the newest snapshot that has an intact copy.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { atomicWrite } = require('./library');

const NOTEBOOK_FILE = 'notebook.json';
const KEEP_DAYS = 7;
const IMMUTABLE = /\.(pdf|png|jpe?g|gif|webp|bmp)$/i;

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stampOf = (d) => `${dayOf(d)} ${pad(d.getHours())}-00`;
const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}-00$/;

function backupRootFor(libraryRoot, fallback) {
  const root = path.resolve(libraryRoot);
  const parent = path.dirname(root);
  if (parent === root) return fallback; // library is a whole drive
  return path.join(parent, path.basename(root) + ' Backups');
}

// All notebook folders in the library: [{ rel, abs }].
async function findNotebooks(root) {
  const out = [];
  const walk = async (abs, rel, depth) => {
    if (depth > 16) return;
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === NOTEBOOK_FILE)) { out.push({ rel, abs }); return; }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) await walk(path.join(abs, e.name), rel ? rel + '/' + e.name : e.name, depth + 1);
    }
  };
  await walk(root, '', 0);
  return out.filter((n) => n.rel);
}

// Files of one notebook: [{ rel (inside the notebook), abs, size, mtimeMs }].
async function notebookFiles(abs) {
  const out = [];
  const walk = async (dir, rel) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (e.name.endsWith('.tmp') || e.name.startsWith('.')) continue;
      const a = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(a, r);
      else if (e.isFile()) { const st = await fsp.stat(a); out.push({ rel: r, abs: a, size: st.size, mtimeMs: st.mtimeMs }); }
    }
  };
  await walk(abs, '');
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

const signature = (files) => crypto.createHash('md5').update(files.map((f) => `${f.rel}:${f.size}:${Math.round(f.mtimeMs)}`).join('\n')).digest('hex');

// index.json (version 2), keyed by the notebook's id so a renamed or moved
// notebook keeps its backups:
//   { version: 2, notebooks: { <id>: { rel, sig, stamps: [stamp], paths: { stamp: rel } } } }
async function loadIndex(dir) {
  try {
    const ix = JSON.parse(await fsp.readFile(path.join(dir, 'index.json'), 'utf8'));
    if (ix && ix.version === 2 && ix.notebooks) return ix;
  } catch { /* first run (or an unreadable index: start a new one, old folders stay) */ }
  return { version: 2, notebooks: {} };
}
const saveIndex = (dir, ix) => atomicWrite(path.join(dir, 'index.json'), JSON.stringify(ix));

async function notebookId(abs) {
  try {
    const nb = JSON.parse(await fsp.readFile(path.join(abs, NOTEBOOK_FILE), 'utf8'));
    if (nb && typeof nb.id === 'string' && nb.id) return nb.id;
  } catch { /* damaged */ }
  return null;
}

// Index entry for a notebook folder: by id, or (notebook.json damaged) by its path.
function entryFor(ix, id, rel) {
  if (id && ix.notebooks[id]) return [id, ix.notebooks[id]];
  for (const [k, rec] of Object.entries(ix.notebooks)) if (rec.rel === rel) return [k, rec];
  return [id, null];
}

async function copyFile(src, dst) {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  if (IMMUTABLE.test(src)) {
    try { await fsp.link(src, dst); return; } catch (err) { if (err.code === 'ENOENT') throw err; /* other drive / FAT: copy */ }
  }
  await fsp.copyFile(src, dst);
}

/**
 * Snapshot every notebook that changed since its last snapshot. A notebook
 * that fails (locked file, online-only file…) is skipped; the others are saved.
 * @returns {{ saved: string[], failed: string[] }} notebook rels
 */
async function snapshot({ root, backupDir, now = new Date(), skip = () => false }) {
  await fsp.mkdir(backupDir, { recursive: true });
  const ix = await loadIndex(backupDir);
  const stamp = stampOf(now);
  const saved = [], failed = [];
  for (const nb of await findNotebooks(root)) {
    if (skip(nb.rel)) continue;
    try {
      const files = await notebookFiles(nb.abs);
      const sig = signature(files);
      const id = (await notebookId(nb.abs)) || 'path:' + nb.rel;
      const rec = ix.notebooks[id] || (ix.notebooks[id] = { rel: nb.rel, sig: null, stamps: [], paths: {} });
      rec.rel = nb.rel;
      if (rec.sig === sig) continue;
      const dest = path.join(backupDir, stamp, ...nb.rel.split('/'));
      const tmp = dest + '.partial';
      await fsp.rm(tmp, { recursive: true, force: true });
      for (const f of files) {
        try { await copyFile(f.abs, path.join(tmp, ...f.rel.split('/'))); } catch (err) { if (err.code !== 'ENOENT') throw err; } // gone meanwhile
      }
      // Replace this hour's earlier snapshot only once the new one is complete.
      const old = dest + '.old';
      await fsp.rm(old, { recursive: true, force: true });
      if (fs.existsSync(dest)) await fsp.rename(dest, old);
      await fsp.rename(tmp, dest);
      await fsp.rm(old, { recursive: true, force: true });
      // An earlier snapshot of this hour under another path (renamed meanwhile)
      if (rec.paths[stamp] && rec.paths[stamp] !== nb.rel) await fsp.rm(path.join(backupDir, stamp, ...rec.paths[stamp].split('/')), { recursive: true, force: true });
      rec.sig = sig;
      rec.paths[stamp] = nb.rel;
      if (!rec.stamps.includes(stamp)) rec.stamps.push(stamp);
      rec.stamps.sort();
      saved.push(nb.rel);
    } catch {
      failed.push(nb.rel);
    }
  }
  prune(ix, now);
  await deleteMarked(ix, backupDir);
  await saveIndex(backupDir, ix);
  return { saved, failed };
}

// Mark snapshots to delete (rec.drop) according to the keep rules.
function prune(ix, now) {
  const today = dayOf(now);
  const oldest = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - KEEP_DAYS));
  for (const rec of Object.values(ix.notebooks)) {
    const keep = new Set();
    const lastOfDay = new Map();
    for (const s of rec.stamps) {
      const day = s.slice(0, 10);
      if (day === today) keep.add(s);
      else if (day >= oldest) lastOfDay.set(day, s); // stamps are sorted: the last one wins
    }
    for (const s of lastOfDay.values()) keep.add(s);
    if (rec.stamps.length) keep.add(rec.stamps[rec.stamps.length - 1]); // never lose the newest
    rec.drop = rec.stamps.filter((s) => !keep.has(s));
    rec.stamps = rec.stamps.filter((s) => keep.has(s));
  }
}

async function deleteMarked(ix, backupDir) {
  for (const rec of Object.values(ix.notebooks)) {
    for (const s of rec.drop || []) {
      const rel = (rec.paths && rec.paths[s]) || rec.rel;
      const top = path.join(backupDir, s);
      const dir = path.join(top, ...rel.split('/'));
      await fsp.rm(dir, { recursive: true, force: true });
      // remove now-empty parent folders up to and including the stamp folder
      let d = path.dirname(dir);
      while (d.startsWith(top)) {
        try { await fsp.rmdir(d); } catch { break; }
        if (d === top) break;
        d = path.dirname(d);
      }
      if (rec.paths) delete rec.paths[s];
    }
    delete rec.drop;
  }
}

/** Snapshots of one notebook (found by its id, so renames don't matter), newest first. */
async function listSnapshots({ backupDir, root, rel }) {
  const ix = await loadIndex(backupDir);
  const id = await notebookId(path.join(root, ...rel.split('/')));
  const [, rec] = entryFor(ix, id, rel);
  if (!rec) return [];
  const out = [];
  for (const s of [...rec.stamps].reverse()) {
    const r = (rec.paths && rec.paths[s]) || rec.rel;
    if (fs.existsSync(path.join(backupDir, s, ...r.split('/'), NOTEBOOK_FILE))) out.push({ stamp: s, label: `${s.slice(0, 10)} ${s.slice(11, 13)}:00` });
  }
  return out;
}

/** Folder of one snapshot (for restoring it as a copy). */
async function snapshotDir({ backupDir, root, rel, stamp }) {
  if (!STAMP_RE.test(stamp)) throw new Error('Bad backup name');
  const ix = await loadIndex(backupDir);
  const id = await notebookId(path.join(root, ...rel.split('/')));
  const [, rec] = entryFor(ix, id, rel);
  const r = (rec && rec.paths && rec.paths[stamp]) || rel;
  const dir = path.resolve(backupDir, stamp, ...r.split('/'));
  if (!dir.startsWith(path.resolve(backupDir) + path.sep)) throw new Error('Bad backup path');
  return dir;
}

/**
 * Find damaged JSON files (empty / cut off after a crash) and put back the
 * newest intact copy from the snapshots of the same notebook. A damaged page
 * without any intact copy is set aside as "<name>.damaged" and reported, so
 * the app can fetch it from Google Drive instead.
 * @returns {{ repaired: string[], unrepairable: string[] }} library-relative paths
 */
async function repairLibrary({ root, backupDir }) {
  const ix = await loadIndex(backupDir);
  const repaired = [], unrepairable = [];
  for (const nb of await findNotebooks(root)) {
    let files;
    try { files = await notebookFiles(nb.abs); } catch { continue; }
    let rec = null;
    for (const f of files) {
      if (!f.rel.endsWith('.json')) continue;
      let ok = true;
      try { JSON.parse(await fsp.readFile(f.abs, 'utf8')); } catch { ok = false; }
      if (ok) continue;
      if (rec === null) rec = entryFor(ix, await notebookId(nb.abs), nb.rel)[1] || false;
      let fixed = false;
      for (const s of rec ? [...rec.stamps].reverse() : []) {
        const r = (rec.paths && rec.paths[s]) || rec.rel;
        const copy = path.join(backupDir, s, ...r.split('/'), ...f.rel.split('/'));
        try {
          const text = await fsp.readFile(copy, 'utf8');
          JSON.parse(text);
          await fsp.copyFile(f.abs, f.abs + '.damaged').catch(() => {});
          await atomicWrite(f.abs, text);
          fixed = true;
          break;
        } catch { /* try an older snapshot */ }
      }
      const name = nb.rel + '/' + f.rel;
      if (fixed) repaired.push(name);
      else {
        // A damaged page is set aside (the page opens empty, or comes back
        // from Drive); notebook.json stays so the notebook does not vanish.
        if (f.rel !== NOTEBOOK_FILE) await fsp.rename(f.abs, f.abs + '.damaged').catch(() => {});
        unrepairable.push(name);
      }
    }
  }
  return { repaired, unrepairable };
}

module.exports = { backupRootFor, snapshot, listSnapshots, snapshotDir, repairLibrary, findNotebooks, notebookFiles, stampOf, dayOf, prune };
