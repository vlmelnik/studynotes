'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PDFDocument, degrees } = require('pdf-lib');
const { exportNotebook, makeMapper, wrapText } = require('../src/main/export');

const FONT = fs.readFileSync(path.join(__dirname, '..', 'assets', 'DejaVuSans.ttf'));

async function makeSourcePdf() {
  const doc = await PDFDocument.create();
  for (const rot of [0, 90, 180, 270]) {
    const p = doc.addPage([400, 600]);
    p.setRotation(degrees(rot));
    p.setCropBox(20, 30, 300, 500);
  }
  return doc.save();
}

test('point mapping matches pdf.js viewport for every rotation and crop box', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = await makeSourcePdf();
  const js = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const lib = await PDFDocument.load(bytes);
  for (let i = 0; i < 4; i++) {
    const vp = (await js.getPage(i + 1)).getViewport({ scale: 1 });
    const pg = lib.getPage(i);
    const map = makeMapper(pg.getCropBox(), pg.getRotation().angle);
    for (const [x, y] of [[0, 0], [10, 20], [vp.width, vp.height], [123.4, 56.7]]) {
      const expected = vp.convertToPdfPoint(x, y);
      const got = map(x, y);
      assert.ok(Math.abs(expected[0] - got[0]) < 1e-6 && Math.abs(expected[1] - got[1]) < 1e-6,
        `rot ${i * 90}: (${x},${y}) expected ${expected} got ${got}`);
    }
  }
});

test('wrapText wraps words and breaks long words', () => {
  const font = { widthOfTextAtSize: (s, size) => s.length * size * 0.5 };
  assert.deepStrictEqual(wrapText('aa bb cc', font, 10, 20), ['aa', 'bb', 'cc']);
  assert.deepStrictEqual(wrapText('aaaaaaaaaa', font, 10, 25), ['aaaaa', 'aaaaa']);
  assert.deepStrictEqual(wrapText('line1\nline2', font, 10, 100), ['line1', 'line2']);
});

test('export: pdf pages, paper pages, duplicates, ink and unicode text', async () => {
  const pdfBytes = await makeSourcePdf();
  const notebook = {
    title: 'Test',
    pages: [
      { id: 'a', kind: 'pdf', pdfPage: 2, w: 500, h: 300 },
      { id: 'b', kind: 'paper', paper: 'grid', w: 595.28, h: 841.89 },
      { id: 'c', kind: 'pdf', pdfPage: 2, w: 500, h: 300 }, // duplicate of the same PDF page
      { id: 'd', kind: 'pdf', pdfPage: 1, w: 300, h: 500 },
    ],
  };
  const stroke = { id: 's', t: 'pen', c: '#1a4fd6', s: 3, p: [10, 10, 0.5, 100, 50, 0.6, 200, 30, 0.4] };
  const hl = { id: 'h', t: 'hl', c: '#ffe14d', s: 14, p: [10, 80, 0.5, 200, 80, 0.5] };
  const pages = {
    a: { strokes: [stroke, hl], texts: [{ id: 't', x: 20, y: 120, w: 200, fs: 14, c: '#000000', text: 'Привет Übung ≈ 1,12 eV' }] },
    b: { strokes: [stroke], texts: [] },
  };
  const out = await exportNotebook({ notebook, pdfBytes, pages, fontBytes: FONT });
  const doc = await PDFDocument.load(out);
  assert.strictEqual(doc.getPageCount(), 4);
  assert.strictEqual(doc.getPage(0).getRotation().angle, 90);
  assert.deepStrictEqual(doc.getPage(1).getSize(), { width: 595.28, height: 841.89 });

  const subset = await exportNotebook({ notebook, pdfBytes, pages, pageIds: ['b', 'd'], fontBytes: FONT });
  assert.strictEqual((await PDFDocument.load(subset)).getPageCount(), 2);
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'export-sample.pdf'), out);
});

test('export: ligatures are not used, so "ti"/"fi" stay searchable and copyable', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets = path.join(__dirname, '..', 'assets');
  const readFont = async (f) => fs.readFileSync(fs.existsSync(path.join(assets, 'fonts', f)) ? path.join(assets, 'fonts', f) : path.join(assets, f));
  const notebook = { title: 't', pages: [{ id: 'p', kind: 'paper', paper: 'plain', w: 595, h: 842 }] };
  const texts = [{ id: 'a', x: 50, y: 100, w: 400, fs: 14, c: '#000000', ff: 'carlito', text: 'Wichtig finden', html: '<b><u>Wichtig</u></b> finden' }];
  const bytes = await exportNotebook({ notebook, pages: { p: { strokes: [], texts, items: [] } }, readFont });
  const js = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const content = await (await js.getPage(1)).getTextContent();
  const str = content.items.map((i) => i.str).join('').replace(/\s+/g, ' ');
  assert.match(str, /Wichtig/);
  assert.match(str, /finden/);
});

test('export: rotated and semi-transparent pictures look like on screen', { skip: !require('fs').existsSync('/usr/bin/pdftoppm') && 'pdftoppm not installed' }, async () => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  // 40x20 PNG: left half red, right half blue
  const doc = await PDFDocument.create();
  void doc;
  const zlib = require('zlib');
  const W = 40, H = 20;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; if (x < W / 2) raw[o] = 255; else raw[o + 2] = 255; }
  const chunk = (t, d) => { const b = Buffer.alloc(4); b.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(require('zlib').crc32 ? zlib.crc32(td) >>> 0 : 0); return Buffer.concat([b, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const notebook = { title: 't', pages: [{ id: 'p', kind: 'paper', paper: 'plain', w: 200, h: 200 }] };
  const items = [{ id: 'i', type: 'img', src: 'a.png', x: 60, y: 80, w: 80, h: 40, r: 90 }];
  const bytes = await exportNotebook({ notebook, pages: { p: { strokes: [], texts: [], items } }, readAsset: async () => png, readFont: async (f) => FONT });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-exp-'));
  fs.writeFileSync(path.join(dir, 'r.pdf'), bytes);
  execFileSync('pdftoppm', ['-r', '72', path.join(dir, 'r.pdf'), path.join(dir, 'r')]);
  const ppm = fs.readFileSync(fs.readdirSync(dir).filter((f) => f.endsWith('.ppm')).map((f) => path.join(dir, f))[0]);
  // P6 header "P6\n200 200\n255\n"
  const hdrEnd = ppm.indexOf('255\n') + 4;
  const px = (x, y) => { const o = hdrEnd + (y * 200 + x) * 3; return [ppm[o], ppm[o + 1], ppm[o + 2]]; };
  // rotated 90° clockwise about its centre (100,100): now 40 wide x 80 tall,
  // the left (red) half is on top, the right (blue) half at the bottom.
  const top = px(100, 75), bottom = px(100, 125), outside = px(70, 100);
  assert.ok(top[0] > 200 && top[2] < 60, 'top red ' + top);
  assert.ok(bottom[2] > 200 && bottom[0] < 60, 'bottom blue ' + bottom);
  assert.ok(outside[0] > 240 && outside[1] > 240 && outside[2] > 240, 'outside white ' + outside);
});

test('1.7: export adds recognised handwriting as invisible, copyable text (also Cyrillic)', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets = path.join(__dirname, '..', 'assets');
  const readFont = async (f) => fs.readFileSync(fs.existsSync(path.join(assets, 'fonts', f)) ? path.join(assets, 'fonts', f) : path.join(assets, f));
  const notebook = { title: 't', pages: [{ id: 'p', kind: 'paper', paper: 'plain', w: 595, h: 842 }] };
  const strokes = [{ id: 's', t: 'pen', c: '#000', s: 2, p: [100, 100, 0.5, 160, 110, 0.5, 200, 100, 0.5] }, { id: 'h', t: 'pen', sh: 1, c: '#000', s: 2, p: [0, 0, 0.5, 10, 10, 0.5] }];
  let got = null;
  const inkTextAll = async (groups) => { got = groups; return [{ words: [{ text: 'Hallo', x: 100, y: 95, w: 60, h: 20 }, { text: 'мир', x: 170, y: 95, w: 30, h: 20 }] }]; };
  const bytes = await exportNotebook({ notebook, pages: { p: { strokes, texts: [], items: [] } }, readFont, inkTextAll });
  assert.strictEqual(got.length, 1, 'one call for all pages');
  assert.strictEqual(got[0].length, 1, 'shapes are not handwriting');
  assert.deepStrictEqual(got[0][0], [100, 100, 160, 110, 200, 100]);
  const js = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const content = await (await js.getPage(1)).getTextContent();
  const str = content.items.map((i) => i.str).join(' ');
  assert.match(str, /Hallo/);
  assert.match(str, /мир/);
  // a recognizer that fails does not break the export
  const ok = await exportNotebook({ notebook, pages: { p: { strokes, texts: [], items: [] } }, readFont, inkTextAll: async () => { throw new Error('no'); } });
  assert.ok(ok.length > 100);
});

test('1.7: "Match the document" text is drawn soft (outlines) and stays searchable once', { skip: !require('fs').existsSync('/usr/bin/pdftoppm') && 'pdftoppm not installed' }, async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { execFileSync } = require('child_process');
  const os = require('os');
  const assets = path.join(__dirname, '..', 'assets');
  const readFont = async (f) => fs.readFileSync(fs.existsSync(path.join(assets, 'fonts', f)) ? path.join(assets, 'fonts', f) : path.join(assets, f));
  const notebook = { title: 't', pages: [{ id: 'p', kind: 'paper', paper: 'plain', w: 400, h: 200 }] };
  const base = { x: 20, y: 40, w: 300, fs: 24, c: '#000000', ff: 'opensans', text: 'Soft letters', r: 3 };
  const render = async (t) => {
    const bytes = await exportNotebook({ notebook, pages: { p: { strokes: [], texts: [t], items: [] } }, readFont });
    const js = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
    const str = (await (await js.getPage(1)).getTextContent()).items.map((i) => i.str).join('');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-soft-'));
    fs.writeFileSync(path.join(dir, 'a.pdf'), bytes);
    execFileSync('pdftoppm', ['-r', '72', '-gray', path.join(dir, 'a.pdf'), path.join(dir, 'o')]);
    const pgm = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.pgm'))));
    fs.rmSync(dir, { recursive: true, force: true });
    // pixels that are neither paper nor full ink: the soft edge
    let mid = 0, ink = 0;
    const px = pgm.subarray(pgm.length - 400 * 200);
    for (const v of px) { if (v < 60) ink++; else if (v < 220) mid++; }
    return { str, mid, ink };
  };
  const sharp = await render(base);
  const soft = await render({ ...base, fx: 0.8 });
  assert.strictEqual(soft.str.replace(/\s+/g, ' ').trim(), 'Soft letters', 'the text is there exactly once');
  assert.ok(soft.mid > sharp.mid * 1.5, `soft edges: ${soft.mid} vs ${sharp.mid}`);
  assert.ok(soft.ink > sharp.ink * 0.3, 'still dark letters');
});

test('1.7: every font exports all its letters (pdf-lib subsetting can drop glyphs)', { skip: !require('fs').existsSync('/usr/bin/pdftoppm') && 'pdftoppm not installed' }, async () => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const { FONTS } = require('../src/shared/fonts');
  const assets = path.join(__dirname, '..', 'assets');
  const readFont = async (f) => fs.readFileSync(fs.existsSync(path.join(assets, 'fonts', f)) ? path.join(assets, 'fonts', f) : path.join(assets, f));
  const ids = Object.keys(FONTS).filter((f) => FONTS[f].kind);
  const ROW = 40, W = 600;
  const notebook = { title: 't', pages: [{ id: 'p', kind: 'paper', paper: 'plain', w: W, h: ids.length * ROW * 2 }] };
  const texts = [];
  ids.forEach((ff, k) => {
    const text = FONTS[ff].cyr === false ? 'Größe fifty Wohnung' : 'Größe fifty Привет';
    texts.push({ id: `r${k}`, x: 10, y: k * 2 * ROW + 5, w: 580, fs: 24, c: '#000000', ff, text });
    texts.push({ id: `b${k}`, x: 10, y: (k * 2 + 1) * ROW + 5, w: 580, fs: 24, c: '#000000', ff, b: true, i: true, text });
  });
  const bytes = await exportNotebook({ notebook, pages: { p: { strokes: [], texts, items: [] } }, readFont });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-fonts-'));
  fs.writeFileSync(path.join(dir, 'a.pdf'), bytes);
  execFileSync('pdftoppm', ['-r', '72', '-gray', path.join(dir, 'a.pdf'), path.join(dir, 'o')]);
  const pgm = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.pgm'))));
  fs.rmSync(dir, { recursive: true, force: true });
  const H = ids.length * ROW * 2;
  const px = pgm.subarray(pgm.length - W * H);
  const ink = [];
  for (let r = 0; r < ids.length * 2; r++) {
    let n = 0;
    for (let y = r * ROW; y < (r + 1) * ROW; y++) for (let x = 0; x < W; x++) if (px[y * W + x] < 128) n++;
    ink.push(n);
  }
  const med = ink.slice().sort((a, b) => a - b)[ink.length >> 1];
  const bad = ink.map((n, r) => [ids[r >> 1] + (r & 1 ? ' bold italic' : ''), n]).filter(([, n]) => n < med * 0.45); // (thin fonts like Garamond have less ink)
  assert.deepStrictEqual(bad, [], 'fonts with missing letters');
});
