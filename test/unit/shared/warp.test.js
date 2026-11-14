'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { homography, applyH, boxWarp, cssMatrix3d, colourAt } = require('../../../src/shared/warp');

test('warp: homography maps the 4 corners exactly', () => {
  const src = [[0, 0], [100, 0], [100, 20], [0, 20]], dst = [[2, 3], [110, -4], [112, 30], [-1, 22]];
  const H = homography(src, dst);
  src.forEach((p, k) => { const [x, y] = applyH(H, ...p); assert.ok(Math.abs(x - dst[k][0]) < 1e-6 && Math.abs(y - dst[k][1]) < 1e-6); });
  assert.match(cssMatrix3d(H), /^matrix3d\(/);
});

test('warp: boxWarp rejects broken or extreme quads, accepts mild ones', () => {
  assert.ok(boxWarp({ qw: 100, qh: 20, q: [0, 0, 100, -3, 101, 24, 0, 20] }));
  assert.strictEqual(boxWarp({ qw: 100, qh: 20, q: [0, 0, 100, 0, 0, 20, 100, 20] }), null); // corners swapped
  assert.strictEqual(boxWarp({ qw: 100, qh: 20, q: [0, 0, 100, 0, 100, 20] }), null);
  assert.strictEqual(boxWarp({ qw: 0, qh: 20, q: [0, 0, 1, 0, 1, 1, 0, 1] }), null);
});

test('warp: colour along the line', () => {
  const st = [[0, '#000000'], [100, '#646464']];
  assert.strictEqual(colourAt(st, -5), '#000000');
  assert.strictEqual(colourAt(st, 50), '#323232');
  assert.strictEqual(colourAt(st, 500), '#646464');
});
