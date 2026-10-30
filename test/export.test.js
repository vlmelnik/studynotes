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
