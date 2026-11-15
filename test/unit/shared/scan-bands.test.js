'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bandCuts } = require(process.env.BANDS || '../../../src/shared/scan-bands');

// a page of text lines: dark rows of `lh` px every `pitch` px
const page = (W, H, { pitch = 60, lh = 36, top = 40, paper = () => 250, tilt = 0 } = {}) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const yy = y - tilt * x;
    const k = Math.floor((yy - top) / pitch), inLine = yy >= top && (yy - top) - k * pitch < lh && x > 30 && x < W - 30 && x % 7 < 4;
    const v = inLine ? 30 : paper(x, y);
    data.set([v, v, v, 255], (y * W + x) * 4);
  }
  return { width: W, height: H, data };
};
const rowHasInk = (im, y) => { for (let x = 0; x < im.width; x++) if (im.data[(y * im.width + x) * 4] < 100) return true; return false; };

test('bandCuts: a tall page is cut between lines, about evenly', () => {
  const im = page(400, 2400);
  const b = bandCuts(im, 3);
  assert.strictEqual(b.length, 3);
  assert.deepStrictEqual([b[0][0], b[2][1]], [0, 2400]);
  for (let i = 0; i + 1 < b.length; i++) {
    assert.strictEqual(b[i][1], b[i + 1][0]);
    assert.ok(!rowHasInk(im, b[i][1]), `cut ${b[i][1]} goes through a line`);
    assert.ok(Math.abs(b[i][1] - (2400 * (i + 1)) / 3) < 100, `cut ${b[i][1]} far from an even split`);
  }
});

test('bandCuts: a short page, one worker, or a tilted page (no empty rows across) is not cut', () => {
  assert.deepStrictEqual(bandCuts(page(400, 450), 3), [[0, 450]]);
  assert.deepStrictEqual(bandCuts(page(400, 2400), 1), [[0, 2400]]);
  assert.deepStrictEqual(bandCuts(page(400, 2400, { tilt: 0.08 }), 3), [[0, 2400]]);
});

test('bandCuts: uneven light (a photo) does not hide the gaps between lines', () => {
  const im = page(400, 2400, { paper: (x, y) => 150 + Math.round((x / 400) * 60 + (y / 2400) * 40) });
  const b = bandCuts(im, 2);
  assert.strictEqual(b.length, 2);
  assert.ok(!rowHasInk(im, b[0][1]));
});

test('bandCuts: fewer bands when the page is not tall enough for all', () => {
  assert.strictEqual(bandCuts(page(400, 1100), 4).length, 2);
});
