'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { publish, notebookSignatures } = require('../../../src/main/publish');
const { exportNotebookArchive } = require('../../../src/main/backup');
const { syncLibrary } = require('../../../src/main/sync');
const { DriveRemote } = require('../../../src/main/drive');
const { FakeDriveApi } = require('../../fake-drive-api');

const tmp = (p = 'sn13-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
function write(root, rel, content) {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
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
