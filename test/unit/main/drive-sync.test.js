'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { syncLibrary } = require('../../../src/main/sync');
const { DriveRemote } = require('../../../src/main/drive');
const { FakeDriveApi } = require('../../fake-drive-api');

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
