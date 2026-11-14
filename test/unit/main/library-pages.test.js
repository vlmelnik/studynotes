'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library } = require('../../../src/main/library');

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

test('cleanupPages keeps page files newer than notebook.json (just arrived from the other PC)', async () => {
  const { Library } = require('../../../src/main/library');
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

test('opening/closing a notebook (only the view changes) does not rewrite notebook.json', async () => {
  const lib = new Library(tmp());
  await lib.ensureRoot();
  const rel = await lib.createNotebook('', { title: 'N' });
  const file = path.join(lib.abs(rel), 'notebook.json');
  const nb = await lib.readNotebook(rel);
  await lib.writeNotebook(rel, nb);
  const t0 = fs.statSync(file).mtimeMs;
  const md0 = fs.readFileSync(file, 'utf8');
  await new Promise((r) => setTimeout(r, 30));
  nb.view = { page: 3, y: 120, zoom: 1.4 };
  await lib.writeNotebook(rel, { ...nb });
  assert.strictEqual(fs.statSync(file).mtimeMs, t0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), md0);
  assert.ok(!JSON.parse(md0).view);
  const back = await lib.readNotebook(rel);
  assert.deepStrictEqual(back.view, { page: 3, y: 120, zoom: 1.4 });
  // a real change is written
  await lib.writeNotebook(rel, { ...back, title: 'N2' });
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).title, 'N2');
  // file changed by someone else (sync): the cache is not trusted
  const other = JSON.parse(fs.readFileSync(file, 'utf8'));
  other.title = 'From laptop';
  await new Promise((r) => setTimeout(r, 30));
  fs.writeFileSync(file, JSON.stringify(other));
  await lib.writeNotebook(rel, { ...back, title: 'N2' });
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).title, 'N2');
});
