'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseRich, richToPlain, layoutRich, plainToHtml } = require('../../../src/shared/richtext');

test('rich text: parse, plain text, wrapping', () => {
  const p = parseRich('Hello <b>bold <i>both</i></b> <u>u</u><div>second</div><div><br></div><div>x &amp; y</div>');
  assert.strictEqual(richToPlain('a<br>b<div>c</div>'), 'a\nb\nc');
  assert.deepStrictEqual(p[0].map((r) => [r.t, r.b, r.i, r.u]), [['Hello ', false, false, false], ['bold ', true, false, false], ['both', true, true, false], [' ', false, false, false], ['u', false, false, true]]);
  assert.strictEqual(p[1][0].t, 'second');
  assert.strictEqual(richToPlain(plainToHtml('a < b\nc')), 'a < b\nc');
  const lines = layoutRich(parseRich('aaa bbb ccc'), 6, (t) => t.length);
  assert.deepStrictEqual(lines.map((l) => l.runs.map((r) => r.t).join('')), ['aaa', 'bbb', 'ccc']);
  const long = layoutRich(parseRich('abcdefghij'), 4, (t) => t.length);
  assert.deepStrictEqual(long.map((l) => l.runs.map((r) => r.t).join('')), ['abcd', 'efgh', 'ij']);
});

test('richtext: out-of-range character references do not crash export parsing', () => {
  const { parseRich } = require('../../../src/shared/richtext');
  assert.doesNotThrow(() => parseRich('a &#99999999; b &#x110000; c'));
});
