'use strict';
// Two-way sync engine between the local library folder and a "remote"
// (Google Drive in production, an in-memory fake in tests).
//
// It is a classic three-way sync: for every relative path we compare
//   L = the local file now, R = the remote file now, S = both as of the last
//   successful sync (persisted in a JSON state file),
// and only the side that changed since S wins. If both changed we keep both.
//
// Remote interface (see DriveRemote in drive.js):
//   init?()                         -> void          (optional)
//   rootId?                         -> string        (optional; detects a new/reset remote)
//   list()                          -> [{ id, path, md5, size, modifiedTime }]
//   upload(path, src)               -> { id, md5 }   src = Buffer or absolute file path
//   update(id, path, src)           -> { id, md5 }
//   download(id)                    -> Buffer
//   downloadToFile?(id, file)       -> void          (optional; streams big files)
//   remove(id)                      -> void          (move to trash)
//
// Relative paths are always '/'-separated, e.g. "Semester 1/Analysis/pages/ab12cd.json".

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { atomicWrite, newId } = require('./library');

const STATE_VERSION = 1;
const NOTEBOOK_FILE = 'notebook.json';
const MAX_DEPTH = 32;

// ---------------------------------------------------------------- helpers

function md5File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

function md5Buffer(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Files we never sync: temp files from atomicWrite, dotfiles, anything in a dot-folder.
function isIgnoredName(name) {
  return name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.damaged') || name.endsWith('.renaming');
}

// Validate a relative path that came from the remote (untrusted). Returns the
// path or null. Rejects absolute paths, '..', backslashes, drive letters and
// characters Windows can't store. Dot segments are "ignored", not "unsafe",
// but the result for the caller is the same: don't touch it.
const BAD_CHARS = /[<>:"|?*\\\u0000-\u001f]/;
function validRemotePath(p) {
  if (typeof p !== 'string' || !p || p.length > 1024) return null;
  if (p.startsWith('/') || BAD_CHARS.test(p)) return null; // ':' covers "C:" and ADS
  const segs = p.split('/');
  for (const s of segs) {
    if (!s || s === '.' || s === '..') return null;
    if (/[. ]$/.test(s)) return null; // Windows silently strips trailing dot/space
  }
  if (isIgnoredName(segs[segs.length - 1]) || segs.some((s) => s.startsWith('.'))) return null;
  return p;
}

// Map a validated relative path to an absolute path, refusing anything outside root.
function absInside(root, rel) {
  const abs = path.resolve(root, ...rel.split('/'));
  if (!abs.startsWith(root + path.sep)) throw new Error('Path outside library: ' + rel);
  return abs;
}

// Recursively list syncable files: rel -> { abs, size, mtimeMs }.
async function scanLocal(root, excludeAbs) {
  const out = new Map();
  const walk = async (dir, relDir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      if (isIgnoredName(e.name)) continue;
      const abs = path.join(dir, e.name);
      const rel = relDir ? relDir + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(abs, rel, depth + 1);
      else if (e.isFile() && abs !== excludeAbs) { // symlinks etc. are skipped
        const st = await fsp.stat(abs).catch(() => null);
        if (st) out.set(rel, { abs, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  await walk(root, '', 0);
  return out;
}

async function loadState(statePath) {
  try {
    const s = JSON.parse(await fsp.readFile(statePath, 'utf8'));
    if (s && s.version === STATE_VERSION && s.files && typeof s.files === 'object') return s;
  } catch { /* missing or corrupt -> first-run semantics (safe: never deletes) */ }
  return { version: STATE_VERSION, remoteRoot: null, files: {} };
}

function pad(n) { return String(n).padStart(2, '0'); }

// "<name> (Drive conflict 2026-10-19 14-05)<ext>" next to the original.
function conflictName(rel, date) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  const base = rel.slice(dir.length);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return { dir, stem: `${stem} (Drive conflict ${stamp})`, ext };
}

// rename with the same Windows lock retries as atomicWrite.
async function renameRetry(from, to) {
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await fsp.rename(from, to); return; } catch (err) {
      lastErr = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) break;
      await sleep(50 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Remove now-empty directories from `dir` upwards (stops at root or a non-empty dir).
async function pruneEmptyDirs(root, dir) {
  while (dir.startsWith(root + path.sep)) {
    try { await fsp.rmdir(dir); } catch { return; }
    dir = path.dirname(dir);
  }
}

const isNotebookJson = (rel) => rel === NOTEBOOK_FILE || rel.endsWith('/' + NOTEBOOK_FILE);

// ---------------------------------------------------------------- engine

/**
 * Run one sync pass.
 * @param {object} o
 * @param {string} o.root           library root folder
 * @param {object} o.remote         remote implementation (see top of file)
 * @param {string} o.statePath      JSON state file (keep it outside root or make it a dotfile)
 * @param {(rel:string)=>boolean} [o.skip]   true = leave this path alone this run
 * @param {(rel:string)=>boolean} [o.uploadOnly]  true = only send local changes, never change the
 *        local file (notebooks open in the editor: saved first, but must not change under it)
 * @param {(p:{done,total,path,action})=>void} [o.onProgress]
 * @param {(msg:string)=>void} [o.log]
 * @param {(abs:string)=>Promise} [o.trashLocal]   default: permanent fs.rm
 * @param {(abs:string)=>Promise<string>} [o.hashFile]  md5 hex of a file (injectable for tests)
 * @param {()=>Date} [o.now]
 * @param {number} [o.saveEveryMs]  persist state at least this often during long runs
 * @param {boolean} [o.allowMassDelete]  see safety guard below
 */
async function syncLibrary({
  root, remote, statePath,
  skip = () => false, uploadOnly = () => false, onProgress = () => {}, log = () => {},
  caseInsensitive = process.platform === 'win32' || process.platform === 'darwin',
  trashLocal = (abs) => fsp.rm(abs, { force: true }),
  hashFile = md5File, now = () => new Date(), saveEveryMs = 5000, allowMassDelete = false,
}) {
  root = path.resolve(root);
  const summary = { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [], skipped: 0, deferred: 0, errors: [] };

  if (remote.init) await remote.init();
  const state = await loadState(statePath);

  // A different remote root (folder re-created, other account) invalidates the
  // state: falling back to first-run semantics means "compare, never delete".
  if (remote.rootId && state.remoteRoot && state.remoteRoot !== remote.rootId) {
    log('sync: remote root changed, starting from a clean state');
    state.files = {};
  }
  if (remote.rootId) state.remoteRoot = remote.rootId;

  let lastSave = Date.now();
  let dirty = false;
  const saveState = async () => { await atomicWrite(statePath, JSON.stringify(state)); lastSave = Date.now(); dirty = false; };
  const maybeSave = async () => { if (dirty && Date.now() - lastSave >= saveEveryMs) await saveState(); };
  const record = (rel, entry) => { state.files[rel] = entry; dirty = true; };
  const forget = (rel) => { if (state.files[rel]) { delete state.files[rel]; dirty = true; } };

  // --- gather the three sides
  // A missing library folder (unplugged drive, renamed folder) must never be
  // read as "the user deleted everything".
  const rootStat = await fsp.stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw Object.assign(new Error(`Library folder not found: ${root}`), { code: 'NO_LIBRARY' });
  }
  const local = await scanLocal(root, path.resolve(statePath));
  const remoteMap = new Map();
  const folded = new Map(); // lower-case path -> remote path
  const ignored = new Set(); // paths left completely alone this run
  for (const item of await remote.list()) {
    const rel = validRemotePath(item.path);
    if (!rel) { log(`sync: ignoring remote file with unsafe path ${JSON.stringify(item.path)}`); summary.skipped++; continue; }
    // "A.json" and "a.json" are the same file on Windows: never let two Drive
    // files fight over one local file. The first one wins, the other is left alone.
    if (caseInsensitive) {
      const other = folded.get(rel.toLowerCase());
      if (other !== undefined && other !== rel) { log(`sync: ${rel} differs from ${other} only in case, ignoring it`); ignored.add(rel); continue; }
      folded.set(rel.toLowerCase(), rel);
    }
    const prev = remoteMap.get(rel);
    if (prev) {
      // Two remote files claim the same path (concurrent first uploads). Prefer
      // the one we already know, else the newest; leave the other untouched.
      const known = state.files[rel] && state.files[rel].id;
      const keepNew = item.id === known || (prev.id !== known && String(item.modifiedTime) > String(prev.modifiedTime));
      log(`sync: duplicate remote path ${rel}, using ${keepNew ? item.id : prev.id}`);
      if (!keepNew) continue;
    }
    remoteMap.set(rel, item);
  }

  // Local md5 with cache: unchanged (size, mtime) since last sync -> reuse.
  const localMd5 = async (rel) => {
    const L = local.get(rel);
    if (L.md5) return L.md5;
    const S = state.files[rel];
    L.md5 = (S && S.size === L.size && S.mtimeMs === L.mtimeMs && S.md5) ? S.md5 : await hashFile(L.abs);
    return L.md5;
  };

  // --- plan
  const ops = []; // { kind, rel }
  const all = new Set([...local.keys(), ...remoteMap.keys(), ...Object.keys(state.files)]);
  for (const rel of all) {
    if (skip(rel) || ignored.has(rel)) { summary.skipped++; continue; }
    const L = local.get(rel), R = remoteMap.get(rel), S = state.files[rel];
    try {
      if (L && R) {
        const lm = await localMd5(rel);
        if (lm === R.md5) {
          // Same content on both sides: just (re)record, no transfer.
          if (!S || S.md5 !== lm || S.id !== R.id || S.size !== L.size || S.mtimeMs !== L.mtimeMs) {
            record(rel, { id: R.id, md5: lm, size: L.size, mtimeMs: L.mtimeMs });
          }
          continue;
        }
        const lc = !S || lm !== S.md5;
        const rc = !S || R.md5 !== S.md5;
        if (lc && rc) ops.push({ kind: 'conflict', rel });
        else if (lc) ops.push({ kind: 'update', rel });
        else ops.push({ kind: 'download', rel });
      } else if (L) {
        if (!S) ops.push({ kind: 'upload', rel });                       // new locally
        else if (await localMd5(rel) === S.md5) ops.push({ kind: 'trashLocal', rel }); // deleted remotely
        else ops.push({ kind: 'upload', rel });                          // deleted remotely but edited locally
      } else if (R) {
        if (!S) ops.push({ kind: 'download', rel });                     // new remotely
        else if (R.md5 === S.md5) ops.push({ kind: 'removeRemote', rel }); // deleted locally
        else ops.push({ kind: 'download', rel });                        // deleted locally but edited remotely
      } else {
        forget(rel);                                                     // gone on both sides
      }
    } catch (err) {
      summary.errors.push({ path: rel, message: err.message });
      log(`sync: ${rel}: ${err.message}`);
    }
  }

  // Safety guard: an empty remote that would make us trash local files almost
  // always means the wrong folder/account, not "everything was deleted elsewhere".
  if (!allowMassDelete && remoteMap.size === 0 && ops.some((o) => o.kind === 'trashLocal')) {
    throw Object.assign(new Error('Remote library is empty; refusing to delete local files (pass allowMassDelete to override)'), { code: 'MASS_DELETE' });
  }
  // Same the other way round: an empty local library must not empty the Drive.
  if (!allowMassDelete && local.size === 0 && ops.some((o) => o.kind === 'removeRemote')) {
    throw Object.assign(new Error('Local library is empty; refusing to delete files on Drive (pass allowMassDelete to override)'), { code: 'MASS_DELETE' });
  }

  // Order: deletions first (notebook.json first, so a half-deleted notebook is
  // no longer a notebook), then all other transfers, then notebook.json
  // transfers last, so a notebook never references page files that aren't there yet.
  const rank = (op) => {
    const nb = isNotebookJson(op.rel);
    if (op.kind === 'trashLocal' || op.kind === 'removeRemote') return nb ? 0 : 1;
    return nb ? 3 : 2;
  };
  ops.sort((a, b) => rank(a) - rank(b) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  // Has the local file changed since we scanned it? (user edited during the run)
  const localMoved = async (rel) => {
    const L = local.get(rel);
    const st = await fsp.stat(L ? L.abs : absInside(root, rel)).catch(() => null);
    if (!L) return !!st;
    return !st || st.size !== L.size || st.mtimeMs !== L.mtimeMs;
  };

  // Download R into `abs` (atomically, md5-verified). Returns the stat of the new file.
  const fetchInto = async (R, abs) => {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    if (remote.downloadToFile) {
      const tmp = `${abs}.${process.pid}.${newId()}.tmp`;
      try {
        await remote.downloadToFile(R.id, tmp);
        const got = await hashFile(tmp);
        if (R.md5 && got !== R.md5) throw new Error('download checksum mismatch');
        await renameRetry(tmp, abs);
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    } else {
      const bytes = await remote.download(R.id);
      if (R.md5 && md5Buffer(bytes) !== R.md5) throw new Error('download checksum mismatch');
      await atomicWrite(abs, bytes);
    }
    return fsp.stat(abs);
  };

  // --- execute
  let done = 0;
  for (const op of ops) {
    const { rel } = op;
    const L = local.get(rel), R = remoteMap.get(rel);
    onProgress({ done, total: ops.length, path: rel, action: op.kind });
    // Re-check: a notebook may have been opened in the editor since planning.
    if (skip(rel)) { summary.skipped++; done++; continue; }
    // Open notebooks: anything that would change the local file waits until
    // the notebook is closed (the editor holds it in memory).
    if (uploadOnly(rel) && op.kind !== 'upload' && op.kind !== 'update') { summary.deferred++; done++; continue; }
    // Never send a damaged notebook.json (cut off by a crash) to Drive.
    if ((op.kind === 'upload' || op.kind === 'update' || op.kind === 'conflict') && isNotebookJson(rel) && L) {
      let ok = true;
      try { JSON.parse(await fsp.readFile(L.abs, 'utf8')); } catch { ok = false; }
      if (!ok) { summary.skipped++; log(`sync: ${rel} is damaged, not uploaded`); done++; continue; }
    }
    try {
      if (op.kind === 'upload') {
        const lm = await localMd5(rel);
        const res = await remote.upload(rel, L.abs);
        record(rel, { id: res.id, md5: res.md5 || lm, size: L.size, mtimeMs: L.mtimeMs });
        summary.uploaded++;
      } else if (op.kind === 'update') {
        const lm = await localMd5(rel);
        const res = await remote.update(R.id, rel, L.abs);
        record(rel, { id: res.id || R.id, md5: res.md5 || lm, size: L.size, mtimeMs: L.mtimeMs });
        summary.uploaded++;
      } else if (op.kind === 'download') {
        if (await localMoved(rel)) { summary.skipped++; log(`sync: ${rel} changed locally during sync, retry later`); continue; }
        const abs = absInside(root, rel);
        const st = await fetchInto(R, abs);
        record(rel, { id: R.id, md5: R.md5, size: st.size, mtimeMs: st.mtimeMs });
        summary.downloaded++;
      } else if (op.kind === 'trashLocal') {
        if (await localMoved(rel)) { summary.skipped++; continue; }
        await trashLocal(L.abs);
        await pruneEmptyDirs(root, path.dirname(L.abs));
        forget(rel);
        summary.deletedLocal++;
      } else if (op.kind === 'removeRemote') {
        await remote.remove(R.id, rel);
        forget(rel);
        summary.deletedRemote++;
      } else if (op.kind === 'conflict') {
        if (await localMoved(rel)) { summary.skipped++; continue; }
        // Keep both: the remote version goes next to the local file under a
        // conflict name (the app ignores such names in pages/), the local
        // version overwrites the remote, and the copy is uploaded too so
        // every device ends up with both.
        const { dir, stem, ext } = conflictName(rel, now());
        let copyRel = `${dir}${stem}${ext}`;
        for (let i = 2; local.has(copyRel) || remoteMap.has(copyRel) || fs.existsSync(absInside(root, copyRel)); i++) {
          copyRel = `${dir}${stem} ${i}${ext}`;
        }
        const copyAbs = absInside(root, copyRel);
        const cst = await fetchInto(R, copyAbs);
        summary.downloaded++;
        const lm = await localMd5(rel);
        const res = await remote.update(R.id, rel, L.abs);
        record(rel, { id: res.id || R.id, md5: res.md5 || lm, size: L.size, mtimeMs: L.mtimeMs });
        const up = await remote.upload(copyRel, copyAbs);
        record(copyRel, { id: up.id, md5: up.md5 || R.md5, size: cst.size, mtimeMs: cst.mtimeMs });
        summary.uploaded += 2;
        summary.conflicts.push(rel);
        log(`sync: conflict on ${rel}, Drive version kept as ${copyRel}`);
      }
    } catch (err) {
      if (err && (err.code === 'NOT_SIGNED_IN' || err.code === 'AUTH_REVOKED')) { await saveState(); throw err; }
      summary.errors.push({ path: rel, message: err.message });
      log(`sync: ${op.kind} ${rel} failed: ${err.message}`);
    }
    done++;
    await maybeSave();
  }
  onProgress({ done, total: ops.length, path: null, action: 'done' });
  await saveState();
  return summary;
}

module.exports = { syncLibrary, validRemotePath, conflictName, md5File };
