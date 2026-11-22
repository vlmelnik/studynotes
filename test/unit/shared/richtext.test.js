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

test('an extension inline element is one atomic run with its fallback text', () => {
  const { parseRich, richToPlain, layoutRich } = require('../../../src/shared/richtext');
  const html = 'a <span data-x="rich-paste:math" data-v="\\frac{1}{2} &amp; x" data-display="1">$$\\frac{1}{2}$$</span> <b>c d</b>';
  const runs = parseRich(html)[0];
  const f = runs.find((r) => r.ix);
  assert.strictEqual(f.ix, 'rich-paste:math');
  assert.strictEqual(f.iv, '\\frac{1}{2} & x');
  assert.strictEqual(f.disp, true);
  assert.strictEqual(f.t, '$$\\frac{1}{2}$$');
  assert.strictEqual(richToPlain(html), 'a $$\\frac{1}{2}$$ c d');
  // never broken, even when wider than the line
  const lines = layoutRich(parseRich(html), 20, (t) => t.length * 5);
  const placed = lines.flatMap((l) => l.runs).filter((r) => r.ix);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].t, '$$\\frac{1}{2}$$');
  // a bad kind is an ordinary span; an unclosed element still ends up as one run
  assert.ok(!parseRich('<span data-x="Bad Kind" data-v="1">t</span>')[0].some((r) => r.ix));
  assert.strictEqual(parseRich('<span data-x="k" data-v="1">$1$')[0][0].ix, 'k');
});
