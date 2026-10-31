'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library } = require('../src/main/library');

const tmp = (p = 'sn14-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

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

test('a PDF opened with StudyNotes gets the notes written into it, and opens editable again', async () => {
  const { PDFDocument } = require('pdf-lib');
  const { exportNotebook } = require('../src/main/export');
  const ext = require('../src/main/external');
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
  const { exportNotebook } = require('../src/main/export');
  const ext = require('../src/main/external');
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

test('live stroke = finished stroke for normal pens (nothing jumps when the pen lifts)', () => {
  const ink = require('../src/shared/ink');
  const p = [];
  for (let i = 0; i < 40; i++) p.push(10 + i * 2, 20 + Math.sin(i / 4) * 6, 0.5 + 0.2 * Math.sin(i / 7));
  for (const ps of [undefined, 'fountain', 'pencil', 'marker']) {
    const st = { t: 'pen', ps, s: 3, c: '#000', p };
    assert.deepStrictEqual(ink.getLiveOutline(st), ink.getOutline({ ...st }), String(ps));
  }
});

test('Fill & sign: form fields are read with page positions and filled (also Cyrillic) into the PDF', async () => {
  const { PDFDocument } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const forms = require('../src/main/forms');
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField('name'); name.addToPage(page, { x: 100, y: 700, width: 200, height: 24 });
  const ok = form.createCheckBox('agree'); ok.addToPage(page, { x: 100, y: 650, width: 14, height: 14 });
  const bytes = await doc.save();
  const fields = await forms.readFormFields(bytes);
  const f = fields.find((x) => x.name === 'name');
  assert.deepStrictEqual([f.type, f.page], ['text', 0]);
  const near = (a, b) => Math.abs(a - b) <= 1; // the widget rectangle includes its 1 pt border
  assert.ok(near(f.x, 100) && near(f.y, 76) && near(f.w, 200) && near(f.h, 24), JSON.stringify(f));
  assert.ok(fields.find((x) => x.name === 'agree' && x.type === 'check'));
  const font = fs.readFileSync(path.join(__dirname, '..', 'assets', 'fonts', 'LiberationSans-Regular.ttf'));
  const out = await forms.fillForm(bytes, { name: 'Иван Петров', agree: true }, font, fontkit);
  const back = await PDFDocument.load(out);
  assert.strictEqual(back.getForm().getFields().length, 0, 'flattened: every reader shows the values');
  // signatures store
  const store = forms.signatures(tmp('sn15-sig-'));
  const id = await store.save(Buffer.from([1, 2, 3]));
  assert.strictEqual((await store.list()).length, 1);
  await store.remove(id);
  assert.strictEqual((await store.list()).length, 0);
});

test('Russian dictionary: patterns and plurals', () => {
  const ru = require('../src/shared/i18n-ru');
  const tr = (s) => { if (ru.words[s]) return ru.words[s]; for (const [re, rep] of ru.patterns) if (re.test(s)) return s.replace(re, rep); return s; };
  assert.strictEqual(tr('Import PDF'), 'Импорт PDF');
  assert.strictEqual(tr('Page 12'), 'Страница 12');
  assert.strictEqual(tr('1 page · 26.10.2026'), '1 страница · 26.10.2026');
  assert.strictEqual(tr('3 pages · x'), '3 страницы · x');
  assert.strictEqual(tr('11 pages · x'), '11 страниц · x');
  assert.strictEqual(tr('Could not save: disk full'), 'Не удалось сохранить: disk full');
  assert.strictEqual(tr('My own notebook title'), 'My own notebook title');
});

test('pen filter: removes tremor on slow lines, keeps small fast curls', () => {
  const { PenFilter } = require('../src/shared/pen-filter');
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 1.2; // ±0.6 px noise
  // slow straight line, 240 Hz, 60 px/s
  let f = new PenFilter(0.5), errRaw = 0, errF = 0;
  for (let i = 0; i < 240; i++) {
    const t = i * 1000 / 240, x = 100 + i * 0.25, n = rnd();
    const [, y] = f.push(x, 200 + n, t);
    if (i > 20) { errRaw += n * n; errF += (y - 200) ** 2; }
  }
  assert.ok(errF < errRaw * 0.35, `tremor ${Math.sqrt(errF).toFixed(2)} vs raw ${Math.sqrt(errRaw).toFixed(2)}`);
  // a small loop (radius 8 px) written in 0.2 s – the size of a letter "e"
  f = new PenFilter(0.5);
  let rmin = Infinity, rmax = 0;
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2, t = i * 1000 / 240;
    const [x, y] = f.push(300 + Math.cos(a) * 8, 300 + Math.sin(a) * 8, t);
    if (i > 12) { const r = Math.hypot(x - 300, y - 300); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
  }
  assert.ok(rmin > 6.4 && rmax < 9, `loop radius ${rmin.toFixed(2)}–${rmax.toFixed(2)} (8 drawn)`);
});
