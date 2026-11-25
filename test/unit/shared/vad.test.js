'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { phrases } = require('../../../src/shared/vad');

const R = 16000, F = 4096;
const frame = (amp, f = 220, t0 = 0) => { const a = new Float32Array(F); for (let i = 0; i < F; i++) a[i] = amp * Math.sin(2 * Math.PI * f * (t0 + i) / R) + (Math.random() - 0.5) * 0.004; return a; };
const run = (plan) => { const v = phrases({ rate: R }); const out = []; for (const [amp, n] of plan) for (let k = 0; k < n; k++) out.push(...v.push(frame(amp)).done); const last = v.flush(); if (last) out.push(last); return out; };

test('vad: two phrases with a pause between become two pieces', () => {
  const out = run([[0, 6], [0.2, 8], [0, 5], [0.2, 6], [0, 6]]);
  assert.strictEqual(out.length, 2);
  // each piece: the speech, one frame before it and the pause after it
  assert.ok(out[0].length >= 8 * F && out[0].length <= 13 * F, String(out[0].length / F));
});

test('vad: a click is dropped, silence gives nothing, a long talk is cut at 20 s', () => {
  assert.strictEqual(run([[0, 10], [0.3, 1], [0, 10]]).length, 0);
  assert.strictEqual(run([[0, 40]]).length, 0);
  const long = run([[0.2, Math.ceil(45 * R / F)]]);
  assert.strictEqual(long.length, 3);
  assert.ok(long[0].length / R <= 20.3);
});

test('vad: a talk that is still going comes out on flush', () => {
  const v = phrases({ rate: R });
  for (let k = 0; k < 5; k++) v.push(frame(0.2));
  const p = v.flush();
  assert.ok(p && p.length === 5 * F);
  assert.strictEqual(v.flush(), null);
});
