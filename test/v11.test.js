'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PDFDocument, degrees } = require('pdf-lib');
const { parseRich, richToPlain, layoutRich, plainToHtml } = require('../src/shared/richtext');
const { migrateNotebook, migratePage, pageIsEmpty, makeSettingsExport, readSettingsImport } = require('../src/shared/format');
const { exportNotebook, contentBBox } = require('../src/main/export');
const { exportLibrary, importLibrary } = require('../src/main/backup');
const { outlookScript, thunderbirdArgs, psQuote } = require('../src/main/send');
const { Library } = require('../src/main/library');
const { paperGeometry, PAPERS } = require('../src/shared/paper');
const { fontFile, FONTS } = require('../src/shared/fonts');

const ROOT = path.join(__dirname, '..');
const readFont = async (f) => fs.readFileSync(f === 'DejaVuSans.ttf' ? path.join(ROOT, 'assets', f) : path.join(ROOT, 'assets', 'fonts', f));

test('rich text: parse, plain text, wrapping', () => {
  const p = parseRich('Hello <b>bold <i>both</i></b> <u>u</u><div>second</div><div><br></div><div>x &amp; y</div>');
  assert.strictEqual(richToPlain('a<br>b<div>c</div>'), 'a\nb\nc');
  assert.deepStrictEqual(p[0].map((r) => [r.t, r.b, r.i, r.u]), [['Hello ', false, false, false], ['bold ', true, false, false], ['both', true, true, false], [' ', false, false, false], ['u', false, false, true]]);
  assert.strictEqual(p[1][0].t, 'second');
  assert.strictEqual(richToPlain(plainToHtml('a < b\nc')), 'a < b\nc');
  const lines = layoutRich(parseRich('aaa bbb ccc'), 6, (t) => t.length);
  assert.deepStrictEqual(lines.map((l) => l.runs.map((r) => r.t).join('')), ['aaa', 'bbb', 'ccc']);
  const long = layoutRich(parseRich('abcdefghij'), 4, (t) => t.length);
  assert.deepStrictEqual(long.map((l) => l.runs.map((r) => r.t).join('')), ['abcd', 'efgh', 'ij']);
});

test('format: v1 notebooks migrate, unknown fields survive', () => {
  const nb = migrateNotebook({ version: 1, hasPdf: true, pages: [], futureField: 42 });
  assert.strictEqual(nb.version, 2);
  assert.deepStrictEqual(nb.sources, { main: { file: 'source.pdf' } });
  assert.strictEqual(nb.futureField, 42);
  assert.strictEqual(migrateNotebook({ version: 9, pages: [] }).newerVersion, 9);
  const pg = migratePage({ strokes: [], future: [1] });
  assert.deepStrictEqual(pg.items, []);
  assert.strictEqual(pageIsEmpty(pg), false, 'unknown data keeps the page file');
  assert.strictEqual(pageIsEmpty({ strokes: [], texts: [], items: [] }), true);
  const exp = makeSettingsExport({ a: 1 }, '1.1.0');
  assert.deepStrictEqual(readSettingsImport(JSON.parse(JSON.stringify(exp))), { a: 1 });
  assert.throws(() => readSettingsImport({ format: 'other' }));
});

test('every paper template produces finite geometry', () => {
  for (const [k] of PAPERS) {
    const g = paperGeometry(k, 595, 842);
    for (const l of g.lines) assert.ok(l.slice(0, 4).every(Number.isFinite), k);
    for (const d of g.dots) assert.ok(d.slice(0, 2).every(Number.isFinite), k);
  }
  assert.ok(paperGeometry('board', 0, 0, [-100, -100, 100, 100]).dots.length > 0);
});

test('fonts: every font file exists, variants resolve', () => {
  for (const f of Object.values(FONTS)) for (const file of Object.values(f.files)) assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'fonts', file)), file);
  assert.deepStrictEqual(fontFile('hand', true, true), { file: 'Neucha-Regular.ttf', synthBold: true, synthItalic: true, subset: true });
  assert.strictEqual(fontFile('serif', true, false).file, 'LiberationSerif-Bold.ttf');
});

async function pngBytes() {
  // 2x2 red PNG
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
}

test('export: images, tables, rich text in all fonts, pen styles, board, two PDF sources, rotated page', async () => {
  const mk = async (n, rot = 0) => {
    const d = await PDFDocument.create();
    for (let i = 0; i < n; i++) { const p = d.addPage([400, 600]); if (rot) p.setRotation(degrees(rot)); }
    return d.save();
  };
  const sources = { main: await mk(2), extra: await mk(3, 90) };
  const notebook = {
    title: 'v11',
    sources: { main: { file: 'source.pdf' }, extra: { file: 'sources/extra.pdf' } },
    pages: [
      { id: 'a', kind: 'pdf', pdfPage: 1 },
      { id: 'b', kind: 'pdf', src: 'extra', pdfPage: 2 },
      { id: 'c', kind: 'paper', paper: 'cornell', w: 595.28, h: 841.89 },
      { id: 'd', kind: 'board', paper: 'board', ox: -1000, oy: -1000, w: 2000, h: 2000 },
    ],
  };
  const pens = ['ball', 'fountain', 'pencil', 'marker', 'brush', 'neon'].map((ps, i) => ({ id: 's' + i, t: 'pen', ps, c: '#1a4fd6', s: 3, p: [20, 40 + i * 20, 0.5, 120, 45 + i * 20, 0.7, 220, 40 + i * 20, 0.4] }));
  const texts = Object.keys(FONTS).map((ff, i) => ({
    id: 't' + i, x: 20, y: 200 + i * 40, w: 300, fs: 14, c: '#000000', ff,
    text: 'x', html: `Привет <b>Übung</b> <i>kursiv</i> <u>unter</u> ≈ €`, b: i === 0, u: i === 1,
  }));
  const items = [
    { id: 'i1', type: 'img', x: 300, y: 40, w: 80, h: 80, src: 'assets/00000000000000000000.png' },
    { id: 'i2', type: 'table', x: 20, y: 470, cw: [100, 140], rh: [24, 40], fs: 11, c: '#111111', ff: 'sans', hdr: true,
      cells: [[{ t: 'Name' }, { t: 'Wert' }], [{ h: 'E<sub>g</sub> <b>Si</b>' }, { t: 'eine sehr lange Zelle die umbricht', bg: '#fff3b0' }]] },
    { id: 'i3', type: 'future-thing', x: 0, y: 0 },
  ];
  const content = { strokes: pens, texts, items };
  const pages = { a: content, b: content, c: content, d: { ...content, strokes: [{ ...pens[0], p: [-900, -800, 0.5, 900, 700, 0.5] }] } };
  const out = await exportNotebook({
    notebook, pages,
    readSource: async (s) => sources[s],
    readAsset: async () => pngBytes(),
    readFont,
  });
  const doc = await PDFDocument.load(out);
  assert.strictEqual(doc.getPageCount(), 4);
  assert.strictEqual(doc.getPage(1).getRotation().angle, 90);
  const board = doc.getPage(3).getSize();
  // stroke from x -900 to 900 (+1.5 half width each side) + 36 margin each side
  assert.ok(Math.abs(board.width - (1803 + 72)) < 1, JSON.stringify(board));
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'export-v11.pdf'), out);
  const txt = execFileSync('pdftotext', ['-f', '1', '-l', '1', path.join(__dirname, 'out', 'export-v11.pdf'), '-']).toString();
  assert.ok(txt.includes('Привет') && txt.includes('Übung') && txt.includes('Wert'), txt.slice(0, 200));
});

test('contentBBox covers strokes, texts and items', () => {
  const b = contentBBox({ strokes: [{ s: 2, p: [0, 0, 0.5, 10, 10, 0.5] }], texts: [{ x: -50, y: 5, w: 20, fs: 10 }], items: [{ type: 'img', x: 0, y: 0, w: 5, h: 100 }] });
  assert.deepStrictEqual(b, [-50, -1, 11, 100]);
});

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

test('library: assets deduplicate, sources copy, board notebooks', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-as-'));
  const lib = new Library(tmp);
  const nb = await lib.createNotebook('', { title: 'Board', kind: 'board' });
  const n = await lib.readNotebook(nb);
  assert.strictEqual(n.kind, 'board');
  assert.strictEqual(n.pages[0].kind, 'board');
  const a1 = await lib.writeAsset(nb, await pngBytes(), 'png');
  const a2 = await lib.writeAsset(nb, await pngBytes(), 'PNG');
  assert.strictEqual(a1, a2);
  assert.ok((await lib.readAsset(nb, a1)).length > 10);
  await assert.rejects(lib.readAsset(nb, '../notebook.json'));
  await assert.rejects(lib.writeAsset(nb, Buffer.from('x'), 'exe'));
  const pdf = path.join(tmp, 'x.pdf');
  fs.writeFileSync(pdf, await (await PDFDocument.create()).save());
  const s = await lib.addSource(nb, pdf);
  assert.ok(fs.existsSync(path.join(lib.abs(nb), s.file)));
  await lib.writeText(nb, { pages: { 1: 'hi' } }, s.id);
  assert.strictEqual((await lib.readText(nb, s.id)).pages[1], 'hi');
});

test('send: PowerShell / Thunderbird arguments are quoted safely', () => {
  assert.strictEqual(psQuote("it's"), "'it''s'");
  const script = outlookScript("C:\\Temp\\a'b.pdf", "Notes ' ; Remove-Item");
  assert.ok(script.includes("'C:\\Temp\\a''b.pdf'"));
  assert.ok(script.includes("'Notes '' ; Remove-Item'"));
  const args = thunderbirdArgs('C:\\Temp\\x y.pdf', "Sub'ject");
  assert.strictEqual(args[0], '-compose');
  assert.ok(args[1].includes("attachment='file:///C:/Temp/x y.pdf'") && !args[1].includes("Sub'ject"));
});
