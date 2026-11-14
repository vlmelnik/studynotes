'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bandFit, shearOf } = require('../../../src/shared/scan-fit');
const { linesFrom } = require('../../../src/shared/ocr-lines');

// ink mask of a "line of letters": vertical strokes 3 px wide every 8 px,
// body from y = top(x) to y = top(x) + 12
const mask = (w, h, top, lean = 0) => {
  const ink = new Uint8Array(w * h);
  for (let x = 10; x < w - 10; x++) {
    const t = Math.round(top(x));
    for (let y = t; y < t + 12; y++) {
      const sx = Math.round(x - lean * (y - t));
      if (sx % 8 < 3 && y >= 0 && y < h) ink[y * w + x] = 1;
    }
  }
  return ink;
};

test('bandFit: finds the slope of a tilted line of letters', () => {
  const w = 300, h = 40;
  const f = bandFit(mask(w, h, (x) => 8 + 0.03 * x), w, h);
  assert.ok(f, 'fitted');
  assert.ok(Math.abs(f.top.b - 0.03) < 0.01, `top slope ${f.top.b}`);
  assert.ok(Math.abs(f.bot.b - 0.03) < 0.01, `bottom slope ${f.bot.b}`);
  assert.ok(Math.abs(f.at(f.bot, 150) - f.at(f.top, 150) - 12) < 2);
});

test('bandFit: too short to fit → null', () => {
  const w = 40, h = 40;
  assert.strictEqual(bandFit(mask(w, h, () => 10), w, h), null);
});

test('shearOf: upright strokes have no lean, italic strokes lean', () => {
  const w = 200, h = 30;
  // (measured in steps of 0.02 on short strokes: a little play)
  assert.ok(Math.abs(shearOf(mask(w, h, () => 8), w, h)) <= 0.1);
  const lean = shearOf(mask(w, h, () => 8, 0.25), w, h);
  assert.ok(lean > 0.15 && lean < 0.35, `lean ${lean}`);
});

test('linesFrom: words in page units, low-confidence and empty words dropped, sorted left to right', () => {
  const got = [{ words: [
    { text: 'world', conf: 90, bbox: { x0: 100, y0: 20, x1: 160, y1: 40 } },
    { text: 'hello', conf: 90, bbox: { x0: 20, y0: 22, x1: 80, y1: 42 } },
    { text: 'x', conf: 10, bbox: { x0: 200, y0: 20, x1: 210, y1: 40 } },
    { text: '  ', conf: 90, bbox: { x0: 220, y0: 20, x1: 230, y1: 40 } },
  ] }, { words: [] }];
  const out = linesFrom(got, 2);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].words.map((x) => x.t), ['hello', 'world']);
  assert.deepStrictEqual([out[0].y0, out[0].y1, out[0].words[0].x0], [10, 21, 10]);
});
