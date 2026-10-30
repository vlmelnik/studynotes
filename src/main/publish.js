'use strict';
// After a sync: keep the human-readable copies on Drive up to date.
//   PDF/<notebook>.pdf                      every notebook as a PDF (read-only view)
//   Backups/<notebook> <YYYY-MM-DD>.studynotes   one per day it changed; 7 days kept
//
// A notebook's "signature" is built from the md5 of its files in the sync
// state, which is identical on every device after a sync, so a PDF made on one
// PC is not made again on the other. The signature is stored on the Drive file
// (appProperties.snSig).

const path = require('path');
const os = require('os');
const fsp = require('fs').promises;
const crypto = require('crypto');

const KEEP_DAYS = 7;
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// { notebookRel: signature } from the sync state's file list.
function notebookSignatures(stateFiles) {
  const nbs = Object.keys(stateFiles).filter((r) => r === 'notebook.json' || r.endsWith('/notebook.json')).map((r) => r.slice(0, -'/notebook.json'.length));
  const out = {};
  for (const nb of nbs) {
    if (!nb) continue;
    const files = Object.keys(stateFiles).filter((r) => r.startsWith(nb + '/') && !nbs.some((o) => o !== nb && o.startsWith(nb + '/') && r.startsWith(o + '/'))).sort();
    out[nb] = crypto.createHash('md5').update(files.map((r) => `${r}:${stateFiles[r].md5}`).join('\n')).digest('hex');
  }
  return out;
}

/**
 * @param {object} o
 * @param {object} o.remote        DriveRemote (listOutputs, putOutput, remove)
 * @param {object} o.stateFiles    sync state `files` after a successful sync
 * @param {(rel:string)=>boolean} o.exists  notebook still in the local library?
 * @param {(rel, outFile)=>Promise} o.exportPdf
 * @param {(rel, outFile)=>Promise} o.exportArchive
 * @param {(rel:string)=>boolean} [o.skip]
 * @param {(msg:string)=>void} [o.onProgress]
 * @param {()=>Date} [o.now]
 */
async function publish({ remote, stateFiles, exists, exportPdf, exportArchive, skip = () => false, onProgress = () => {}, log = () => {}, now = () => new Date() }) {
  const sigs = notebookSignatures(stateFiles);
  const summary = { pdfs: 0, backups: 0, removed: 0, errors: [] };
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'studynotes-publish-'));
  try {
    // ---- PDFs
    const pdfs = await remote.listOutputs('pdf');
    const pdfByNb = new Map(pdfs.map((f) => [f.path.replace(/\.pdf$/, ''), f]));
    const todo = Object.entries(sigs).filter(([rel, sig]) => !skip(rel) && exists(rel) && (!pdfByNb.has(rel) || pdfByNb.get(rel).props.snSig !== sig));
    let i = 0;
    for (const [rel, sig] of todo) {
      onProgress(`Updating PDFs ${++i} / ${todo.length}…`);
      try {
        const out = path.join(tmpDir, `pdf-${i}.pdf`);
        await exportPdf(rel, out);
        const prev = pdfByNb.get(rel);
        await remote.putOutput('pdf', rel + '.pdf', out, { id: prev ? prev.id : null, props: { snSig: sig } });
        summary.pdfs++;
      } catch (err) {
        summary.errors.push({ path: rel, message: err.message });
        log(`publish: PDF of ${rel} failed: ${err.message}`);
      }
    }
    // PDFs of deleted notebooks go too (the backups stay).
    for (const [rel, f] of pdfByNb) {
      if (!sigs[rel] && !exists(rel)) { await remote.remove(f.id, f.path, 'pdf'); summary.removed++; }
    }

    // ---- daily backups
    const today = dayOf(now());
    const backups = await remote.listOutputs('backups');
    const byNb = new Map();
    for (const f of backups) {
      // "<notebook> 2026-10-20.studynotes" (the notebook path may be too long for a property)
      const m = /^(.*) (\d{4}-\d{2}-\d{2})\.studynotes$/.exec(f.path);
      if (!m) continue;
      const nb = m[1];
      f.props.snDay = f.props.snDay || m[2];
      if (!byNb.has(nb)) byNb.set(nb, []);
      byNb.get(nb).push(f);
    }
    const due = Object.entries(sigs).filter(([rel, sig]) => !skip(rel) && exists(rel) && !(byNb.get(rel) || []).some((f) => f.props.snSig === sig));
    i = 0;
    for (const [rel, sig] of due) {
      onProgress(`Saving backups ${++i} / ${due.length}…`);
      try {
        const out = path.join(tmpDir, `backup-${i}.studynotes`);
        await exportArchive(rel, out);
        const same = (byNb.get(rel) || []).find((f) => f.props.snDay === today);
        const res = await remote.putOutput('backups', `${rel} ${today}.studynotes`, out, { id: same ? same.id : null, props: { snSig: sig, snDay: today } });
        if (!same) { if (!byNb.has(rel)) byNb.set(rel, []); byNb.get(rel).push({ id: res.id, path: `${rel} ${today}.studynotes`, props: { snSig: sig, snDay: today } }); }
        else same.props.snSig = sig;
        summary.backups++;
      } catch (err) {
        summary.errors.push({ path: rel, message: err.message });
        log(`publish: backup of ${rel} failed: ${err.message}`);
      }
    }
    // Keep 7 days, but always the newest backup of every notebook.
    const d = now();
    const oldest = dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - KEEP_DAYS));
    for (const list of byNb.values()) {
      list.sort((a, b) => (a.props.snDay < b.props.snDay ? -1 : 1));
      for (const f of list.slice(0, -1)) {
        if (f.props.snDay < oldest) { await remote.remove(f.id, f.path, 'backups'); summary.removed++; }
      }
    }
    if (remote.cleanup) await remote.cleanup();
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
  return summary;
}

module.exports = { publish, notebookSignatures, dayOf };
