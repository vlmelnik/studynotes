'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { linesOf, charAt, spanBetween, highlightStrokes } = require('../../../src/shared/pdf-text-layout');

// a run of text: one char box per letter, 6 units wide, 10 high
const run = (text, x, base) => {
  const chars = [...text].map((ch, i) => ({ ch, x0: x + i * 6, x1: x + i * 6 + 6 }));
  return { base, y0: base - 10, y1: base, chars };
};
const text = (l) => l.chars.map((c) => c.ch).join('');

test('linesOf: words written one by one become one line with spaces', () => {
  const lines = linesOf([run('world', 40, 20), run('hello', 0, 20)]);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(text(lines[0]), 'hello world');
});

test('linesOf: two columns of running text are read one after the other', () => {
  const runs = [];
  for (let i = 0; i < 6; i++) {
    runs.push(run('left column text line', 0, 20 + i * 14));
    runs.push(run('right column text line', 200, 20 + i * 14));
  }
  const lines = linesOf(runs);
  assert.strictEqual(lines.length, 12);
  assert.ok(lines.slice(0, 6).every((l) => text(l).startsWith('left')));
  assert.ok(lines.slice(6).every((l) => text(l).startsWith('right')));
});

test('linesOf: table cells on one baseline stay one row, cells split by a tab', () => {
  const lines = linesOf([run('Name', 0, 20), run('Price', 150, 20), run('Pen', 0, 34), run('2.50', 150, 34)]);
  assert.deepStrictEqual(lines.map(text), ['Name\tPrice', 'Pen\t2.50']);
});

test('charAt / spanBetween: hit a character and copy the text between two points', () => {
  const layout = { lines: linesOf([run('hello world', 0, 20), run('second line', 0, 34)]) };
  const a = charAt(layout, 1, 15), b = charAt(layout, 64, 29);
  assert.ok(a && b);
  assert.strictEqual(a.line, 0);
  assert.strictEqual(b.line, 1);
  const span = spanBetween(layout, b, a); // order does not matter
  assert.ok(span.text.startsWith('hello world'), span.text);
  assert.ok(span.text.includes('\n'), span.text);
  assert.strictEqual(span.rects.length, 2);
  assert.strictEqual(charAt(layout, 500, 500), null); // far away, not "near"
});

test('highlightStrokes: one straight highlighter stroke per rectangle', () => {
  let n = 0;
  const s = highlightStrokes([{ x0: 10, x1: 50, y0: 0, y1: 10 }], '#ffeb3b', () => 'id' + ++n);
  assert.strictEqual(s.length, 1);
  assert.deepStrictEqual({ id: s[0].id, t: s[0].t, c: s[0].c, p: s[0].p }, { id: 'id1', t: 'hl', c: '#ffeb3b', p: [10, 5, 0.5, 50, 5, 0.5] });
});
