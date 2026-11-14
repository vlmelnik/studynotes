'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { exportLibrary, importLibrary, exportNotebookArchive } = require('../../../src/main/backup');
const { Library } = require('../../../src/main/library');

async function pngBytes() {
  // 2x2 red PNG
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
}
const tmp = (p = 'sn13-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
function write(root, rel, content) {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
function library() {
  const root = path.join(tmp(), 'StudyNotes');
  write(root, 'Sem 1/Physik/notebook.json', '{"title":"Physik","pages":[{"id":"aaaaaa"}]}');
  write(root, 'Sem 1/Physik/pages/aaaaaa.json', '{"strokes":[1]}');
  write(root, 'Sem 1/Physik/source.pdf', '%PDF-1.4 big');
  write(root, 'Bio/notebook.json', '{"title":"Bio","pages":[]}');
  return root;
}

test('backup round trip and zip-slip protection', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-bk-'));
  const lib = new Library(path.join(tmp, 'lib'));
  await lib.ensureRoot();
  const f = await lib.createFolder('', 'Semester');
  const nb = await lib.createNotebook(f, { title: 'Notes' });
  const n = await lib.readNotebook(nb);
  await lib.writePage(nb, n.pages[0].id, { strokes: [{ id: 'x', t: 'pen', c: '#000', s: 2, p: [1, 1, 0.5, 2, 2, 0.5] }], texts: [], items: [] });
  await lib.writeAsset(nb, await pngBytes(), 'png');
  const file = path.join(tmp, 'b.studynotes');
  const res = await exportLibrary(lib.root, file, 'test');
  assert.ok(res.files >= 3);
  const dest = path.join(tmp, 'restored');
  const imp = await importLibrary(file, dest);
  assert.strictEqual(imp.manifest.format, 'studynotes-backup');
  const restored = new Library(dest);
  const page = await restored.readPage('Semester/Notes', n.pages[0].id);
  assert.strictEqual(page.strokes.length, 1);
  await assert.rejects(importLibrary(file, dest), 'destination must not exist');

  // A malicious archive with ../ must be rejected.
  const evil = path.join(tmp, 'evil.studynotes');
  execFileSync('python3', ['-c', `import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1],'w')
z.writestr('manifest.json', json.dumps({'format':'studynotes-backup','version':1}))
z.writestr('library/../../evil.txt','x')
z.close()`, evil]);
  await assert.rejects(importLibrary(evil, path.join(tmp, 'x')));
  assert.ok(!fs.existsSync(path.join(tmp, 'evil.txt')));
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
