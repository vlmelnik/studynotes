'use strict';
// The real Windows recognizer script (CI runs this on Windows): it starts,
// reads every stroke – also a single one, which ConvertFrom-Json used to
// unroll – and says what it did.
const test = require('node:test');
const assert = require('node:assert');
const hw = require('../../../src/main/handwriting');

const win = process.platform === 'win32' && !process.env.STUDYNOTES_FAKE_INK;

test('Windows recognizer: lists recognizers and reads one stroke and several strokes', { skip: !win && 'needs Windows', timeout: 120000 }, async () => {
  const names = await hw.recognizers();
  assert.ok(Array.isArray(names));
  // a big "L" and an "O" in page units
  const L = [100, 100, 100, 160, 140, 160];
  const O = [];
  for (let a = 0; a <= Math.PI * 2; a += 0.2) O.push(200 + 25 * Math.cos(a), 130 + 30 * Math.sin(a));
  const one = await hw.recognize([L]);
  assert.strictEqual(one.info.strokes, 1, JSON.stringify(one.info));
  const two = await hw.recognize([L, O]);
  assert.strictEqual(two.info.strokes, 2, JSON.stringify(two.info));
  assert.strictEqual(two.info.installed, names.length);
  if (names.some((n) => /English/.test(n))) assert.ok(/^l[o0]$/i.test(two.text), `an English recognizer reads "Lo": ${JSON.stringify(two)}`);
  // with a recognizer installed, "LO" written big must give some letters
  if (names.length) assert.ok(two.text.length > 0, JSON.stringify(two.info));
  console.log('recognizers:', names.join(', ') || '(none)', '| result:', JSON.stringify(two.text), JSON.stringify(two.info));
});
