'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clipPlan } = require('../../../src/shared/clip-plan');

test('empty selection and original picture keep their distinct clipboard formats', () => {
  assert.deepEqual(clipPlan({ items: [] }), { png: null, text: '', html: false, privateClip: true });
  assert.deepEqual(clipPlan({ items: [{ type: 'img' }] }),
    { png: { mode: 'original' }, text: '', html: false, privateClip: true });
});

test('text and table cells follow selection reading order without rearranging the selection', () => {
  const items = Object.freeze([
    { type: 'text', text: 'end', x: 1, y: 2 },
    { type: 'table', cells: [[{ t: 'one', h: '<b>one</b>' }, {}], [{ t: 'two' }]], x: 5, y: 1 },
    { type: 'text', text: 'start', x: 0, y: 1 },
    { type: 'img', x: 3, y: 4 },
  ]);
  assert.deepEqual(clipPlan({ items, bbox: { w: 10, h: 4.5 }, zoom: 1.5 }), {
    png: { mode: 'render', width: 30, height: 14, scale: 3 },
    text: 'start\none\ntwo\nend', html: true, privateClip: true,
  });
});

test('render scale caps either orientation and keeps even a hairline visible', () => {
  for (const [w, h, width, height] of [[8000, 200, 4000, 100], [0.1, 8000, 1, 4000]]) {
    assert.deepEqual(clipPlan({ items: [{ type: 'stroke' }, { type: 'shape' }], bbox: { w, h }, zoom: 2 }),
      { png: { mode: 'render', width, height, scale: 0.5 }, text: '', html: false, privateClip: true });
  }
});
