'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { narrowLangs, fixUmlauts, mergeLines, skewOf, invertHex, paperColor, isDark, darkShare, invert, dilateMask } = require('../../../src/shared/scan-text');

const w = (text, conf = 90) => ({ text, conf });
const img = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); data.set([r, g, b, 255], (y * w + x) * 4); }
  return { width: w, height: h, data };
};

test('narrowLangs: a German page with stray Cyrillic look-alikes is read again without Russian', () => {
  const lines = [{ words: [w('Der'), w('Mieter'), w('zahlt'), w('die'), w('Kaution'), w('Рог', 40), w('pünktlich')] }];
  assert.deepStrictEqual(narrowLangs(lines), ['deu', 'eng']);
});

test('narrowLangs: a real quote in the other script (read with confidence) keeps all languages', () => {
  const lines = [{ words: [w('Der'), w('Mieter'), w('zahlt'), w('die'), w('Kaution'), w('пожалуйста', 92), w('pünktlich')] }];
  assert.strictEqual(narrowLangs(lines), null);
});

test('narrowLangs: too little text to tell → keep all', () => {
  assert.strictEqual(narrowLangs([{ words: [w('Hi'), w('du')] }]), null);
});

test('fixUmlauts: a word read without its dots takes the spelling used elsewhere', () => {
  const out = fixUmlauts([{ text: 'Übung macht den Meister', words: [w('Übung')] }, { text: 'Die Ubung ist leicht', words: [w('Die'), w('Ubung')] }]);
  assert.strictEqual(out[1].text, 'Die Übung ist leicht');
  assert.strictEqual(out[1].words[1].text, 'Übung');
  // nothing to learn from: unchanged (same object)
  const plain = [{ text: 'Ubung', words: [] }];
  assert.strictEqual(fixUmlauts(plain), plain);
});

test('mergeLines: a second reading fills gaps and replaces clearly better lines only', () => {
  const a = [{ text: 'first', conf: 80, bbox: { x0: 0, y0: 0, x1: 100, y1: 10 } }, { text: 'bad', conf: 40, bbox: { x0: 0, y0: 20, x1: 100, y1: 30 } }];
  const b = [
    { text: 'better', conf: 90, bbox: { x0: 0, y0: 20, x1: 100, y1: 30 } }, // replaces "bad"
    { text: 'same', conf: 82, bbox: { x0: 0, y0: 0, x1: 100, y1: 10 } }, // not clearly better than "first"
    { text: 'new', conf: 70, bbox: { x0: 0, y0: 40, x1: 100, y1: 50 } }, // fills a gap
    { text: 'noise', conf: 30, bbox: { x0: 0, y0: 60, x1: 100, y1: 70 } }, // too unsure
  ];
  assert.deepStrictEqual(mergeLines(a, b).map((l) => l.text), ['first', 'better', 'new']);
});

test('skewOf: median tilt of the long baselines in degrees, short lines ignored', () => {
  const line = (deg, len = 200) => ({ baseline: { x0: 0, y0: 0, x1: len, y1: Math.tan((deg * Math.PI) / 180) * len } });
  assert.ok(Math.abs(skewOf([line(2), line(2.2), line(1.8), line(15, 50)]) - 2) < 0.01);
  assert.strictEqual(skewOf([]), 0);
});

test('colours: paper, dark pages, inverted colours', () => {
  const paper = img(40, 40, (x, y) => (y % 10 === 5 ? [20, 20, 20] : [250, 245, 235]));
  assert.deepStrictEqual(paperColor(paper), [250, 245, 235]);
  assert.strictEqual(isDark(paper), false);
  assert.ok(darkShare(paper) > 0.05 && darkShare(paper) < 0.2);
  const dark = img(40, 40, () => [30, 30, 30]);
  assert.strictEqual(isDark(dark), true);
  invert(dark);
  assert.deepStrictEqual([...dark.data.slice(0, 4)], [225, 225, 225, 255]);
  assert.strictEqual(invertHex('#102030'), '#efdfcf');
});

test('dilateMask grows a mask by the radius', () => {
  const m = new Uint8Array(25); m[12] = 1; // centre of 5×5
  const g = dilateMask(m, 5, 5, 1);
  assert.strictEqual(g.reduce((s, v) => s + (v ? 1 : 0), 0), 9);
  assert.strictEqual(g[0], 0);
});
