'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library } = require('../../../src/main/library');

const tmp = (p = 'sn14-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('a PDF opened with StudyNotes gets the notes written into it, and opens editable again', async () => {
  const { PDFDocument } = require('pdf-lib');
  const { exportNotebook } = require('../../../src/main/export');
  const ext = require('../../../src/main/external');
  const lib = new Library(tmp());
  await lib.ensureRoot();
  const docsDir = tmp('sn14-docs-');
  const file = path.join(docsDir, 'Lecture 3.pdf');
  const src = await PDFDocument.create();
  src.addPage([400, 600]); src.addPage([400, 600]);
  const original = Buffer.from(await src.save());
  fs.writeFileSync(file, original);
  const exportPdf = async (rel, notebook, beforeSave) => exportNotebook({
    notebook, pages: await lib.readPages(rel, await lib.listPageFiles(rel)), beforeSave,
    readSource: async () => fs.readFileSync(path.join(lib.abs(rel), 'source.pdf')),
  });

  // 1. first open: plain PDF → new working notebook (not in the library list)
  const { rel } = await ext.openExternal(lib, file);
  assert.ok(ext.isExternal(rel));
  const listed = await lib.listFolder('');
  assert.deepStrictEqual([listed.folders.length, listed.notebooks.length], [0, 0]);
  const nb = await lib.readNotebook(rel);
  assert.ok(nb.needsInit && nb.hasPdf);
  assert.strictEqual(await ext.writeBack(lib, rel, exportPdf), null, 'nothing written before the pages exist');
  nb.pages = [1, 2].map((n) => ({ id: 'pg' + n + 'aaaa', kind: 'pdf', pdfPage: n, w: 400, h: 600 }));
  delete nb.needsInit;
  await lib.writeNotebook(rel, nb);
  const stroke = { id: 's1', t: 'pen', c: '#ff0000', s: 3, p: [50, 50, 0.5, 150, 80, 0.5, 250, 60, 0.5] };
  await lib.writePage(rel, 'pg1aaaa', { strokes: [stroke], texts: [], items: [] });
  await ext.writeBack(lib, rel, exportPdf);

  // the file is a normal 2-page PDF with the ink on it, plus the hidden data
  const written = fs.readFileSync(file);
  assert.notDeepStrictEqual(written, original);
  assert.strictEqual((await PDFDocument.load(written)).getPageCount(), 2);
  const emb = await ext.readEmbedded(written);
  assert.ok(emb);
  assert.deepStrictEqual(emb.original, original);
  assert.strictEqual(emb.data.pages.pg1aaaa.strokes[0].c, '#ff0000');

  // 2. unchanged on disk → the working copy is reused as is
  await lib.writePage(rel, 'pg2aaaa', { strokes: [stroke], texts: [], items: [] }); // not yet in the file
  assert.strictEqual((await ext.openExternal(lib, file)).rel, rel);
  assert.ok(fs.existsSync(path.join(lib.abs(rel), 'pages', 'pg2aaaa.json')));

  // 3. changed on disk (e.g. copied to another PC) → rebuilt from the file itself
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(file, written);
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  const third = await ext.openExternal(lib, file);
  assert.ok(!fs.existsSync(path.join(lib.abs(rel), 'pages', 'pg2aaaa.json')));
  // …but the notes that never reached the file are kept in the library
  assert.ok(third.recovered && /notes not saved into the file/.test(third.recovered), JSON.stringify(third));
  const kept = (await lib.listFolder('')).notebooks.map((n) => n.title || n.name);
  assert.ok(kept.some((t) => /notes not saved/.test(t)), JSON.stringify(kept));
  const back = await lib.readPage(rel, 'pg1aaaa');
  assert.strictEqual(back.strokes[0].c, '#ff0000');
  assert.deepStrictEqual(fs.readFileSync(path.join(lib.abs(rel), 'source.pdf')), original, 'notes are not baked into the base');
  const nb2 = await lib.readNotebook(rel);
  assert.strictEqual(nb2.pages.length, 2);
  assert.strictEqual(nb2.title, 'Lecture 3');

  // 4. saving again does not stack copies: the hidden original stays the first one
  await ext.writeBack(lib, rel, exportPdf);
  const again = await ext.readEmbedded(fs.readFileSync(file));
  assert.deepStrictEqual(again.original, original);
});

test('write-back never overwrites a PDF that another program changed meanwhile', async () => {
  const { PDFDocument } = require('pdf-lib');
  const { exportNotebook } = require('../../../src/main/export');
  const ext = require('../../../src/main/external');
  const lib = new Library(tmp());
  await lib.ensureRoot();
  const file = path.join(tmp('sn14-docs-'), 'Sheet.pdf');
  const src = await PDFDocument.create();
  src.addPage([300, 400]);
  fs.writeFileSync(file, await src.save());
  const { rel } = await ext.openExternal(lib, file);
  const nb = await lib.readNotebook(rel);
  nb.pages = [{ id: 'pg1aaaa', kind: 'pdf', pdfPage: 1, w: 300, h: 400 }];
  delete nb.needsInit;
  await lib.writeNotebook(rel, nb);
  const exportPdf = async (r, notebook, beforeSave) => exportNotebook({
    notebook, pages: await lib.readPages(r, await lib.listPageFiles(r)), beforeSave,
    readSource: async () => fs.readFileSync(path.join(lib.abs(r), 'source.pdf')),
  });
  // someone else saves the file (e.g. Acrobat added a comment)
  fs.writeFileSync(file, Buffer.concat([fs.readFileSync(file), Buffer.from('\n%edited elsewhere\n')]));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  const theirs = fs.readFileSync(file);
  const res = await ext.writeBack(lib, rel, exportPdf);
  assert.ok(res.conflict && /Sheet \(StudyNotes\)\.pdf$/.test(res.path), JSON.stringify(res));
  assert.deepStrictEqual(fs.readFileSync(file), theirs, 'their file is untouched');
  assert.ok(await ext.readEmbedded(fs.readFileSync(res.path)));
  // later saves go to the copy, no new copies
  const res2 = await ext.writeBack(lib, rel, exportPdf);
  assert.strictEqual(res2.path, res.path);
  assert.ok(!res2.conflict);
  // working copies whose notes are all in their file are cleaned up after a while
  await ext.cleanupExternal(lib, new Set(), 0);
  assert.ok(!fs.existsSync(lib.abs(rel)));
});
