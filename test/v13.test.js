'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const localBackup = require('../src/main/localbackup');
const { publish, notebookSignatures } = require('../src/main/publish');
const { exportNotebookArchive, importLibrary } = require('../src/main/backup');
const { syncLibrary } = require('../src/main/sync');
const { DriveRemote } = require('../src/main/drive');
const { FakeDriveApi } = require('./fake-drive-api');

const tmp = (p = 'sn13-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
function write(root, rel, content) {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
function bump(root, rel, content, secs) {
  write(root, rel, content);
  const t = new Date(Date.now() + secs * 1000);
  fs.utimesSync(path.join(root, ...rel.split('/')), t, t);
}
function library() {
  const root = path.join(tmp(), 'StudyNotes');
  write(root, 'Sem 1/Physik/notebook.json', '{"title":"Physik","pages":[{"id":"aaaaaa"}]}');
  write(root, 'Sem 1/Physik/pages/aaaaaa.json', '{"strokes":[1]}');
  write(root, 'Sem 1/Physik/source.pdf', '%PDF-1.4 big');
  write(root, 'Bio/notebook.json', '{"title":"Bio","pages":[]}');
  return root;
}

test('local backups: next to the library, only changed notebooks, hard-linked PDFs', async () => {
  const root = library();
  const backupDir = localBackup.backupRootFor(root);
  assert.strictEqual(backupDir, root + ' Backups');
  const t1 = new Date(2026, 9, 20, 10, 5);
  let r = await localBackup.snapshot({ root, backupDir, now: t1 });
  assert.deepStrictEqual(r.saved.sort(), ['Bio', 'Sem 1/Physik']);
  const snap = path.join(backupDir, '2026-10-20 10-00', 'Sem 1', 'Physik');
  assert.strictEqual(read(snap, 'pages/aaaaaa.json'), '{"strokes":[1]}');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(snap, 'source.pdf')).ino, fs.statSync(path.join(root, 'Sem 1/Physik/source.pdf')).ino);
  // nothing changed -> nothing saved
  r = await localBackup.snapshot({ root, backupDir, now: new Date(2026, 9, 20, 11, 5) });
  assert.deepStrictEqual(r.saved, []);
  // one notebook changed -> only that one in the new hour
  bump(root, 'Bio/notebook.json', '{"title":"Bio 2","pages":[]}', 10);
  r = await localBackup.snapshot({ root, backupDir, now: new Date(2026, 9, 20, 12, 5) });
  assert.deepStrictEqual(r.saved, ['Bio']);
  assert.ok(!fs.existsSync(path.join(backupDir, '2026-10-20 12-00', 'Sem 1')));
  const list = await localBackup.listSnapshots({ backupDir, root, rel: 'Bio' });
  assert.deepStrictEqual(list.map((s) => s.stamp), ['2026-10-20 12-00', '2026-10-20 10-00']);
});

test('local backups: keep today hourly, last of each day for 7 days, always the newest', () => {
  const ix = { notebooks: {
    A: { stamps: ['2026-10-01 09-00', '2026-10-15 08-00', '2026-10-15 17-00', '2026-10-19 10-00', '2026-10-20 09-00', '2026-10-20 10-00'] },
    Old: { stamps: ['2026-09-01 09-00', '2026-09-02 09-00'] },
  } };
  localBackup.prune(ix, new Date(2026, 9, 20, 12, 0));
  assert.deepStrictEqual(ix.notebooks.A.stamps, ['2026-10-15 17-00', '2026-10-19 10-00', '2026-10-20 09-00', '2026-10-20 10-00']);
  assert.deepStrictEqual(ix.notebooks.A.drop, ['2026-10-01 09-00', '2026-10-15 08-00']);
  assert.deepStrictEqual(ix.notebooks.Old.stamps, ['2026-09-02 09-00']); // unchanged for weeks: newest stays
});

test('crash repair: damaged page restored from the newest intact backup, unrepairable kept aside', async () => {
  const root = library();
  const backupDir = localBackup.backupRootFor(root);
  await localBackup.snapshot({ root, backupDir, now: new Date(2026, 9, 20, 10, 0) });
  write(root, 'Sem 1/Physik/pages/aaaaaa.json', ''); // power cut: empty file
  write(root, 'Sem 1/Physik/pages/bbbbbb.json', '{"strokes":['); // new page, cut off, no backup
  const r = await localBackup.repairLibrary({ root, backupDir });
  assert.deepStrictEqual(r.repaired, ['Sem 1/Physik/pages/aaaaaa.json']);
  assert.deepStrictEqual(r.unrepairable, ['Sem 1/Physik/pages/bbbbbb.json']);
  assert.strictEqual(read(root, 'Sem 1/Physik/pages/aaaaaa.json'), '{"strokes":[1]}');
  assert.ok(fs.existsSync(path.join(root, 'Sem 1/Physik/pages/bbbbbb.json.damaged')));
  assert.ok(!fs.existsSync(path.join(root, 'Sem 1/Physik/pages/bbbbbb.json')));
});

test('one-notebook .studynotes archive imports back as a notebook', async () => {
  const root = library();
  const out = path.join(tmp(), 'Physik.studynotes');
  await exportNotebookArchive(path.join(root, 'Sem 1', 'Physik'), out, '1.3.0');
  const dest = path.join(tmp(), 'restored');
  const r = await importLibrary(out, dest);
  assert.strictEqual(r.files, 3);
  assert.strictEqual(read(dest, 'Physik/pages/aaaaaa.json'), '{"strokes":[1]}');
});

test('publish: PDF + daily backup per notebook in their Drive folders, not repeated when unchanged', async () => {
  const api = new FakeDriveApi();
  const remote = new DriveRemote({ auth: { async getAccessToken() { return 'T'; } }, fetch: api.fetch, state: {}, sleep: async () => {} });
  const root = library();
  const statePath = path.join(tmp(), 'state.json');
  await syncLibrary({ root, remote, statePath });
  const exported = [];
  const deps = {
    exists: (rel) => fs.existsSync(path.join(root, rel, 'notebook.json')),
    exportPdf: async (rel, out) => { exported.push(rel); fs.writeFileSync(out, '%PDF ' + rel); },
    exportArchive: (rel, out) => exportNotebookArchive(path.join(root, rel), out, '1.3.0'),
    now: () => new Date(2026, 9, 20, 10, 0),
  };
  const state = () => JSON.parse(fs.readFileSync(statePath, 'utf8')).files;
  let s = await publish({ remote, stateFiles: state(), ...deps });
  assert.deepStrictEqual([s.pdfs, s.backups], [2, 2]);
  const pdf = api.byPath('Sem 1/Physik.pdf', 'pdf');
  assert.strictEqual(api.folderPath(pdf.parents[0]), 'StudyNotes Library/PDF/Sem 1');
  const bk = api.byPath('Sem 1/Physik 2026-10-20.studynotes', 'backups');
  assert.strictEqual(api.folderPath(bk.parents[0]), 'StudyNotes Library/Backups/Sem 1');

  // unchanged -> nothing new
  s = await publish({ remote, stateFiles: state(), ...deps });
  assert.deepStrictEqual([s.pdfs, s.backups], [0, 0]);

  // a change the same day updates the PDF and today's backup (no second file)
  bump(root, 'Sem 1/Physik/pages/aaaaaa.json', '{"strokes":[1,2]}', 10);
  await syncLibrary({ root, remote, statePath });
  s = await publish({ remote, stateFiles: state(), ...deps });
  assert.deepStrictEqual([s.pdfs, s.backups], [1, 1]);
  assert.strictEqual(api.live().filter((f) => f.appProperties.snRole === 'backups' && f.mimeType !== 'application/vnd.google-apps.folder').length, 2);

  // next day: new backup file; 8 days later the old one is removed, the newest stays
  bump(root, 'Sem 1/Physik/pages/aaaaaa.json', '{"strokes":[3]}', 20);
  await syncLibrary({ root, remote, statePath });
  await publish({ remote, stateFiles: state(), ...deps, now: () => new Date(2026, 9, 21, 9, 0) });
  assert.ok(api.byPath('Sem 1/Physik 2026-10-21.studynotes', 'backups'));
  await publish({ remote, stateFiles: state(), ...deps, now: () => new Date(2026, 9, 29, 9, 0) });
  assert.ok(!api.byPath('Sem 1/Physik 2026-10-20.studynotes', 'backups'));
  assert.ok(api.byPath('Sem 1/Physik 2026-10-21.studynotes', 'backups'));
  assert.ok(api.byPath('Bio 2026-10-20.studynotes', 'backups')); // only backup of Bio: kept

  // deleted notebook: PDF goes, backup stays
  fs.rmSync(path.join(root, 'Bio'), { recursive: true });
  await syncLibrary({ root, remote, statePath });
  await publish({ remote, stateFiles: state(), ...deps });
  assert.ok(!api.byPath('Bio.pdf', 'pdf'));
  assert.ok(api.byPath('Bio 2026-10-20.studynotes', 'backups'));
});

test('notebook signature only depends on content (same on every PC)', () => {
  const a = notebookSignatures({ 'N/notebook.json': { md5: '1' }, 'N/pages/p.json': { md5: '2' }, 'N/Sub/notebook.json': { md5: '3' } });
  const b = notebookSignatures({ 'N/pages/p.json': { md5: '2', mtimeMs: 5 }, 'N/notebook.json': { md5: '1', mtimeMs: 9 } });
  assert.strictEqual(a.N, b.N);
});

test('sync: open notebooks only upload, changes from Drive wait until closed', async () => {
  const api = new FakeDriveApi();
  const mk = () => ({ root: tmp(), statePath: path.join(tmp(), 's.json'), remote: new DriveRemote({ auth: { async getAccessToken() { return 'T'; } }, fetch: api.fetch, state: {}, sleep: async () => {} }) });
  const A = mk(), B = mk();
  write(A.root, 'NB/notebook.json', '{"pages":[]}');
  write(A.root, 'NB/pages/p1.json', '1');
  await syncLibrary(A);
  await syncLibrary(B);
  bump(B.root, 'NB/pages/p1.json', '2-from-B', 10);
  await syncLibrary(B);
  // A has NB open: its own new page goes up, B's change does not come down yet
  write(A.root, 'NB/pages/p2.json', 'new-on-A');
  const r = await syncLibrary({ ...A, uploadOnly: (rel) => rel.startsWith('NB/') });
  assert.strictEqual(read(A.root, 'NB/pages/p1.json'), '1');
  assert.strictEqual(r.deferred, 1);
  assert.ok(api.byPath('NB/pages/p2.json'));
  // closed: now it arrives
  await syncLibrary(A);
  assert.strictEqual(read(A.root, 'NB/pages/p1.json'), '2-from-B');
});

test('shapes: corners and the closing point are fully covered (no notches or gaps)', () => {
  const { shapeOutline, isClosedShape } = require('../src/shared/ink');
  const { shapeStrokes } = require('../src/shared/geometry');
  const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const covered = (polys, x, y) => polys.some((p) => inPoly(x, y, p));
  const [pts] = shapeStrokes('rect', [100, 100, 300, 200]);
  const st = { t: 'pen', s: 6, sh: 1, np: 1, c: '#000', p: pts.flatMap(([x, y]) => [x, y, 0.5]) };
  const o = shapeOutline(st);
  assert.ok(o.multi && isClosedShape(st));
  // every corner: points within the pen radius all around it are ink
  for (const [cx, cy] of [[100, 100], [300, 100], [300, 200], [100, 200]]) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      assert.ok(covered(o, cx + 2.6 * Math.cos(t), cy + 2.6 * Math.sin(t)), `corner ${cx},${cy} angle ${a}`);
    }
  }
  // edges are exactly pen-wide, inside stays empty
  assert.ok(covered(o, 200, 102.9) && !covered(o, 200, 103.2) && !covered(o, 200, 150));
  // all polygons wound the same way (non-zero fill = union)
  const area = (p) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0);
  assert.ok(o.every((p) => area(p) > 0));
  // an open line is not "closed" (no fill)
  const [ln] = shapeStrokes('line', [[0, 0], [100, 0]]);
  assert.ok(!isClosedShape({ s: 2, sh: 1, p: ln.flatMap(([x, y]) => [x, y, 0.5]) }));
});

test('local backups follow a renamed notebook (keyed by id); one failing notebook does not stop the others', async () => {
  const root = path.join(tmp(), 'StudyNotes');
  write(root, 'A/notebook.json', '{"id":"nbA","title":"A","pages":[]}');
  write(root, 'B/notebook.json', '{"id":"nbB","title":"B","pages":[]}');
  const backupDir = localBackup.backupRootFor(root);
  await localBackup.snapshot({ root, backupDir, now: new Date(2026, 9, 20, 10, 0) });
  fs.renameSync(path.join(root, 'A'), path.join(root, 'Physik'));
  const list = await localBackup.listSnapshots({ backupDir, root, rel: 'Physik' });
  assert.deepStrictEqual(list.map((x) => x.stamp), ['2026-10-20 10-00']);
  const dir = await localBackup.snapshotDir({ backupDir, root, rel: 'Physik', stamp: list[0].stamp });
  assert.ok(fs.existsSync(path.join(dir, 'notebook.json')) && dir.endsWith(path.join('2026-10-20 10-00', 'A')));
  // a notebook whose folder can't be read is skipped, B is still saved, index written
  bump(root, 'B/notebook.json', '{"id":"nbB","title":"B2","pages":[]}', 10);
  write(root, 'Locked/notebook.json', '{"id":"nbL","pages":[]}');
  if (process.getuid && process.getuid() !== 0) fs.chmodSync(path.join(root, 'Locked'), 0o000);
  const r = await localBackup.snapshot({ root, backupDir, now: new Date(2026, 9, 20, 11, 0) });
  if (process.getuid && process.getuid() !== 0) fs.chmodSync(path.join(root, 'Locked'), 0o755);
  assert.ok(r.saved.includes('B'));
  const ix = JSON.parse(fs.readFileSync(path.join(backupDir, 'index.json'), 'utf8'));
  assert.strictEqual(ix.version, 2);
  assert.deepStrictEqual(ix.notebooks.nbB.stamps, ['2026-10-20 10-00', '2026-10-20 11-00']);
  assert.strictEqual(ix.notebooks.nbA.rel, 'Physik');
});

test('cleanupPages keeps page files newer than notebook.json (just arrived from the other PC)', async () => {
  const { Library } = require('../src/main/library');
  const root = tmp();
  const lib = new Library(root);
  write(root, 'N/notebook.json', '{"id":"n","title":"N","pages":[{"id":"aaaaaa","kind":"paper","w":10,"h":10}]}');
  write(root, 'N/pages/aaaaaa.json', '{}');
  write(root, 'N/pages/oldorph.json', '{}');
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(root, 'N/pages/oldorph.json'), past, past);
  bump(root, 'N/pages/newpage.json', '{}', 30); // newer than notebook.json
  const removed = await lib.cleanupPages('N');
  assert.deepStrictEqual(removed, ['oldorph']);
  assert.ok(fs.existsSync(path.join(root, 'N/pages/newpage.json')));
});

test('sync never uploads a damaged notebook.json', async () => {
  const api = new FakeDriveApi();
  const A = { root: tmp(), statePath: path.join(tmp(), 's.json'), remote: new DriveRemote({ auth: { async getAccessToken() { return 'T'; } }, fetch: api.fetch, state: {}, sleep: async () => {} }) };
  write(A.root, 'NB/notebook.json', '{"pages":[]}');
  await syncLibrary(A);
  bump(A.root, 'NB/notebook.json', '{"pages":[', 10);
  const r = await syncLibrary(A);
  assert.strictEqual(r.uploaded, 0);
  assert.strictEqual(api.byPath('NB/notebook.json').bytes.toString(), '{"pages":[]}');
});

test('Drive: a manually trashed area folder is recreated, new files never go into the trash', async () => {
  const api = new FakeDriveApi();
  const remote = new DriveRemote({ auth: { async getAccessToken() { return 'T'; } }, fetch: api.fetch, state: {}, sleep: async () => {} });
  await remote.putOutput('pdf', 'F/A.pdf', Buffer.from('%PDF'));
  const pdfArea = remote.areas.pdf;
  const folderF = api.live().find((f) => f.name === 'F');
  api.files.get(pdfArea).trashed = true; // user deleted the PDF folder in Drive
  folderF.trashed = true;
  await remote.init(); // every sync starts with init()
  const res = await remote.putOutput('pdf', 'F/B.pdf', Buffer.from('%PDF'));
  const f = api.files.get(res.id);
  let p = api.files.get(f.parents[0]);
  while (p) { assert.ok(!p.trashed, 'parent folder ' + p.name + ' is trashed'); p = api.files.get(p.parents[0]); }
  assert.notStrictEqual(remote.areas.pdf, pdfArea);
});
