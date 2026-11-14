'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('1.7: scan cleaning removes dark text and keeps the paper colour', () => {
  const { cleanLines } = require('../../../src/shared/scan-clean');
  const W = 120, H = 40, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 240; data[i * 4 + 1] = 232; data[i * 4 + 2] = 215; data[i * 4 + 3] = 255; }
  // "letters": dark blue bars
  for (let y = 12; y < 28; y++) for (let x = 20; x < 100; x++) if ((x % 6) < 3) { const i = (y * W + x) * 4; data[i] = 20; data[i + 1] = 40; data[i + 2] = 130; }
  const img = { width: W, height: H, data };
  const [look] = cleanLines(img, [{ bbox: { x0: 20, y0: 12, x1: 100, y1: 28 } }]);
  const rgb = [1, 3, 5].map((k) => parseInt(look.color.slice(k, k + 2), 16));
  assert.ok(Math.abs(rgb[0] - 20) < 15 && Math.abs(rgb[2] - 130) < 15, look.color);
  let min = 255;
  for (let i = 0; i < W * H; i++) min = Math.min(min, data[i * 4]);
  assert.ok(min > 200, `darkest red ${min}`);
});
