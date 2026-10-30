'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { stacked, restack, layerOf } = require('../src/shared/stacking');

const ids = (d, l) => stacked(d, l).map((e) => e.obj.id);

test('stacking: defaults match the old look (pictures under ink, text above)', () => {
  const d = { items: [{ id: 'p1' }, { id: 'p2' }], texts: [{ id: 't1' }], strokes: [] };
  assert.deepStrictEqual(ids(d, 'b'), ['p1', 'p2']);
  assert.deepStrictEqual(ids(d, 'f'), ['t1']);
  assert.strictEqual(layerOf('item', {}), 'b');
  assert.strictEqual(layerOf('text', {}), 'f');
});

test('stacking: bring a picture to front puts it above ink and text', () => {
  let d = { items: [{ id: 'p1' }, { id: 'p2' }], texts: [{ id: 't1' }], strokes: [] };
  d = restack(d, new Set(['p1']), 1);
  assert.deepStrictEqual(ids(d, 'b'), ['p2']);
  assert.deepStrictEqual(ids(d, 'f'), ['t1', 'p1']);
});

test('stacking: text can be sent behind pictures and brought back', () => {
  let d = { items: [{ id: 'p1' }], texts: [{ id: 't1' }, { id: 't2' }], strokes: [] };
  d = restack(d, new Set(['t1']), -1);
  assert.deepStrictEqual(ids(d, 'b'), ['t1', 'p1']);
  d = restack(d, new Set(['t1']), 1);
  assert.deepStrictEqual(ids(d, 'f'), ['t2', 't1']);
});

test('stacking: several selected objects keep their relative order', () => {
  let d = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], texts: [], strokes: [] };
  d = restack(d, new Set(['a', 'b']), 1);
  assert.deepStrictEqual(ids(d, 'f'), ['a', 'b']);
  assert.deepStrictEqual(ids(d, 'b'), ['c']);
});

test('richtext: out-of-range character references do not crash export parsing', () => {
  const { parseRich } = require('../src/shared/richtext');
  assert.doesNotThrow(() => parseRich('a &#99999999; b &#x110000; c'));
});
