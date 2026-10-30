'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { Library, sanitizeName } = require('../src/main/library');
const { searchLibrary } = require('../src/main/search');

async function tmpLib() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-lib-'));
  const lib = new Library(dir);
  await lib.ensureRoot();
  return lib;
}

test('sanitizeName strips illegal Windows characters', () => {
  assert.strictEqual(sanitizeName('a/b:c*?'), 'a b c');
  assert.strictEqual(sanitizeName('CON'), '_CON');
  assert.strictEqual(sanitizeName('name. '), 'name');
  assert.strictEqual(sanitizeName(''), 'Untitled');
});

test('folders and notebooks', async () => {
  const lib = await tmpLib();
  const f = await lib.createFolder('', 'Semester 1');
  const f2 = await lib.createFolder('', 'Semester 1');
  assert.strictEqual(f, 'Semester 1');
  assert.strictEqual(f2, 'Semester 1 (2)');
  const nb = await lib.createNotebook(f, { title: 'Halbleiter', paper: 'grid' });
  assert.strictEqual(nb, 'Semester 1/Halbleiter');
  const list = await lib.listFolder(f);
  assert.strictEqual(list.notebooks.length, 1);
  assert.strictEqual(list.notebooks[0].pageCount, 1);
  const root = await lib.listFolder('');
  assert.deepStrictEqual(root.folders.map((x) => x.name), ['Semester 1', 'Semester 1 (2)']);
  assert.strictEqual(root.notebooks.length, 0);

  // notebooks can't be created inside notebooks
  await assert.rejects(lib.createNotebook(nb, { title: 'x' }));
});

test('page data round trip, empty pages delete file, cleanup', async () => {
  const lib = await tmpLib();
  const nbRel = await lib.createNotebook('', { title: 'N' });
  const nb = await lib.readNotebook(nbRel);
  const id = nb.pages[0].id;
  const data = { strokes: [{ id: 's1', t: 'pen', c: '#000000', s: 2, p: [1, 2, 0.5, 3, 4, 0.5] }], texts: [] };
  await lib.writePage(nbRel, id, data);
  assert.deepStrictEqual(await lib.readPage(nbRel, id), { ...data, items: [] });
  assert.deepStrictEqual(await lib.listPageFiles(nbRel), [id]);
  await lib.writePage(nbRel, id, { strokes: [], texts: [] });
  assert.deepStrictEqual(await lib.listPageFiles(nbRel), []);

  await lib.writePage(nbRel, 'orphan1x', data);
  await lib.writePage(nbRel, id, data);
  // sync-conflict copies are never listed nor deleted
  fs.writeFileSync(path.join(lib.abs(nbRel), 'pages', id + ' (1).json'), '{}');
  fs.writeFileSync(path.join(lib.abs(nbRel), 'pages', id + '-LAPTOP.json'), '{}');
  // an orphan only counts once it is older than notebook.json (newer files may be arriving from sync)
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lib.pageFile(nbRel, 'orphan1x'), old, old);
  assert.deepStrictEqual(await lib.cleanupPages(nbRel), ['orphan1x']);
  assert.ok(fs.existsSync(path.join(lib.abs(nbRel), 'pages', id + ' (1).json')));
  assert.ok(fs.existsSync(path.join(lib.abs(nbRel), 'pages', id + '-LAPTOP.json')));
  assert.deepStrictEqual(await lib.listPageFiles(nbRel), [id]);
  assert.throws(() => lib.pageFile(nbRel, '../evil'));
});

test('rejects paths outside the library and the root itself', async () => {
  const lib = await tmpLib();
  assert.throws(() => lib.abs('../outside'));
  assert.throws(() => lib.abs('a/../../outside'));
  assert.ok(lib.isRoot('.') && lib.isRoot('a/..') && lib.isRoot(''));
  await assert.rejects(lib.remove('.'));
  await assert.rejects(lib.rename('a/..', 'x'));
  await assert.rejects(lib.move('.', 'a'));
  assert.doesNotThrow(() => lib.abs('a/b'));
});

test('rename, move, duplicate', async () => {
  const lib = await tmpLib();
  const a = await lib.createFolder('', 'A');
  const b = await lib.createFolder('', 'B');
  const nbRel = await lib.createNotebook(a, { title: 'Notes' });
  const renamed = await lib.rename(nbRel, 'Better Notes');
  assert.strictEqual(renamed, 'A/Better Notes');
  assert.strictEqual((await lib.readNotebook(renamed)).title, 'Better Notes');
  const moved = await lib.move(renamed, b);
  assert.strictEqual(moved, 'B/Better Notes');
  await assert.rejects(lib.move(a, a));
  const dup = await lib.duplicateNotebook(moved);
  assert.strictEqual(dup, 'B/Better Notes copy');
  assert.notStrictEqual((await lib.readNotebook(dup)).id, (await lib.readNotebook(moved)).id);
  const all = await lib.listAllFolders();
  assert.deepStrictEqual(all.map((f) => f.path), ['', 'A', 'B']);
});

test('import pdf + library search', async () => {
  const lib = await tmpLib();
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  const src = path.join(lib.root, '..', `src-${Date.now()}.pdf`);
  fs.writeFileSync(src, await doc.save());
  const rel = await lib.importPdf('', src, 'Skript Halbleiter');
  const nb = await lib.readNotebook(rel);
  assert.strictEqual(nb.hasPdf, true);
  assert.strictEqual(nb.needsInit, true);
  assert.ok(fs.existsSync(path.join(lib.abs(rel), 'source.pdf')));
  nb.needsInit = false;
  nb.pages = [{ id: 'pg1abcdef', kind: 'pdf', pdfPage: 1, w: 300, h: 400 }];
  await lib.writeNotebook(rel, nb);
  await lib.writeText(rel, { pages: { 1: 'Die Bandlücke von Silizium beträgt 1,12 eV.' } });
  await lib.writePage(rel, 'pg1abcdef', { strokes: [], texts: [{ id: 't', x: 0, y: 0, w: 100, fs: 12, c: '#000000', text: 'Prüfung am Freitag' }] });

  let res = await searchLibrary(lib, 'bandlucke');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].hits[0].source, 'pdf');
  res = await searchLibrary(lib, 'PRÜFUNG');
  assert.strictEqual(res[0].hits[0].source, 'note');
  res = await searchLibrary(lib, 'skript');
  assert.ok(res[0].titleMatch);
  res = await searchLibrary(lib, 'nothing-here');
  assert.strictEqual(res.length, 0);
});

test('search folding keeps indices aligned with the original text', () => {
  const { fold, searchNotebook } = require('../src/main/search');
  for (const s of ['Bandlücke Übung', 'ÄÖÜ ß café', 'Привет МИР', 'ﬁx']) assert.strictEqual(fold(s).length, s.length, s);
  const nb = { pages: [{ id: 'a', kind: 'pdf', pdfPage: 1 }] };
  const hits = searchNotebook(nb, { pages: { 1: 'Die   Bandlücke von\nSilizium' } }, {}, 'bandlucke');
  const sn = hits[0].snippet;
  const i = fold(sn).indexOf('bandlucke');
  assert.strictEqual(sn.slice(i, i + 9), 'Bandlücke');
});
