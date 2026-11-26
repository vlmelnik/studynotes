'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { stacked, restack, layerOf } = require('../../../src/shared/stacking');

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

test('sinkUnder: ink drawn over a picture goes above it – the picture moves to the back layer', () => {
  const { sinkUnder } = require('../../../src/shared/stacking.js');
  const data = { items: [{ id: 'a', type: 'img', lay: 'f', x: 0, y: 0, w: 100, h: 100, z: 3 }, { id: 'b', type: 'img', lay: 'f', x: 500, y: 500, w: 10, h: 10, z: 4 }, { id: 't', type: 'table', lay: 'f', x: 0, y: 0, w: 100, h: 100 }], texts: [], strokes: [] };
  const out = sinkUnder(data, { x0: 10, y0: 10, x1: 20, y1: 20 });
  assert.equal(out.find((i) => i.id === 'a').lay, 'b');
  assert.equal(out.find((i) => i.id === 'b').lay, 'f');
  assert.equal(out.find((i) => i.id === 't').lay, 'f');
  assert.equal(sinkUnder(data, { x0: 300, y0: 300, x1: 310, y1: 310 }), null);
});
