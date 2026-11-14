'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('pen filter: removes tremor on slow lines, keeps small fast curls', () => {
  const { PenFilter } = require('../../../src/shared/pen-filter');
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

test('1.6.1: the pen filter ignores uneven timing and removes small shaking', () => {
  const { PenFilter } = require('../../../src/shared/pen-filter');
  const a = new PenFilter(0.5), b = new PenFilter(0.5);
  let t = 0;
  for (let i = 0; i < 40; i++) {
    const x = i * 3, y = (i % 2 ? 0.6 : -0.6); // 1.2 px zig-zag = digitiser jitter
    const ra = a.push(x, y, i * 8), rb = b.push(x, y, (t += 1 + (i % 3) * 20));
    assert.deepStrictEqual(ra, rb);
    if (i > 2) assert.ok(Math.abs(ra[1]) < 0.35, `y ${ra[1]}`);
  }
});
