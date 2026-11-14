'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const localBackup = require('../../../src/main/localbackup');

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
