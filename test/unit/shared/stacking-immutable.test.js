'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { restack, stacked } = require('../../../src/shared/stacking');

test('bringing a picture and text forward preserves the original notebook', () => {
  const notebook = {
    items: [{ id: 'photo' }],
    texts: [{ id: 'caption' }, { id: 'other' }],
    strokes: [],
  };
  const original = structuredClone(notebook);

  const reordered = restack(notebook, new Set(['photo', 'caption']), 1);

  assert.deepEqual(notebook, original);
  assert.deepEqual(stacked(reordered, 'f').map(entry => entry.obj.id),
    ['other', 'photo', 'caption']);
});
