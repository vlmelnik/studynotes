'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PDFDocument, degrees } = require('pdf-lib');
const { exportNotebook, contentBBox } = require('../../../src/main/export');
const { FONTS } = require('../../../src/shared/fonts');

const ROOT = path.join(__dirname, '..', '..', '..');
const readFont = async (f) => fs.readFileSync(f === 'DejaVuSans.ttf' ? path.join(ROOT, 'assets', f) : path.join(ROOT, 'assets', 'fonts', f));
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
  fs.mkdirSync(path.join(__dirname, '..', '..', 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', '..', 'out', 'export-v11.pdf'), out);
  const txt = execFileSync('pdftotext', ['-enc', 'UTF-8', '-f', '1', '-l', '1', path.join(__dirname, '..', '..', 'out', 'export-v11.pdf'), '-']).toString();
  assert.ok(txt.includes('Привет') && txt.includes('Übung') && txt.includes('Wert'), txt.slice(0, 200));
});

test('contentBBox covers strokes, texts and items', () => {
  const b = contentBBox({ strokes: [{ s: 2, p: [0, 0, 0.5, 10, 10, 0.5] }], texts: [{ x: -50, y: 5, w: 20, fs: 10 }], items: [{ type: 'img', x: 0, y: 0, w: 5, h: 100 }] });
  assert.deepStrictEqual(b.map((v) => Math.round(v * 100) / 100), [-50, -1.3, 11.3, 100]); // 1.6.1: a ballpoint can get 0.65·s wide with pressure
});
