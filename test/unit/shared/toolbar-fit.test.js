'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fitToolbar } = require('../../../src/shared/toolbar-fit');

const groups = [
  { id: 'history', items: [{ id: 'undo', w: 160, keep: true, rank: 0 }, { id: 'redo', w: 160, keep: true, rank: 0 }] },
  { id: 'tools', items: [{ id: 'pen', w: 210, keep: true, rank: 1 }, { id: 'shape', w: 210, rank: 3 }] },
  { id: 'extras', items: [{ id: 'stamp', w: 210, rank: 2 }, { id: 'star', w: 210, rank: 1 }] },
];
const opts = { gap: 8, minGap: 2, more: 36 };

for (const [width, hidden] of [[1280, []], [960, ['stamp', 'star']], [800, ['stamp', 'star']], [640, ['shape', 'stamp', 'star']]]) {
  test('fits a toolbar at ' + width + ' pixels', () => {
    const plan = fitToolbar(groups, width, opts);
    assert.deepEqual(plan.overflow, hidden);
    assert.deepEqual(plan.visible, groups.flatMap(g => g.items.map(i => i.id)).filter(id => !hidden.includes(id)));
    assert.ok(!plan.tooNarrow);
  });
}

test('reduces gaps before hiding anything; ignores empty groups', () => {
  const plan = fitToolbar([...groups, { id: 'empty', items: [] }], 1170, opts);
  assert.deepEqual(plan.overflow, []);
  assert.equal(plan.gap, 5);
  assert.deepEqual(fitToolbar([], 0, opts), { gap: 8, visible: [], overflow: [] });
});

test('keeps mandatory items when the overflow control cannot fit', () => {
  const plan = fitToolbar(groups, 500, opts);
  assert.equal(plan.tooNarrow, true);
  assert.deepEqual(plan.visible, ['undo', 'redo', 'pen']);
});

test('random widths preserve order and leave room for the overflow control', () => {
  let state = 73;
  const items = groups.flatMap(g => g.items);
  for (let i = 0; i < 1500; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const width = state % 1400;
    const plan = fitToolbar(groups, width, opts);
    const visible = items.filter(item => plan.visible.includes(item.id));
    assert.deepEqual(plan.visible, visible.map(item => item.id));
    assert.deepEqual(plan.overflow, items.filter(item => !plan.visible.includes(item.id)).map(item => item.id));
    const blocks = groups.filter(g => g.items.some(item => plan.visible.includes(item.id))).length + Number(!!plan.overflow.length);
    const used = visible.reduce((total, item) => total + item.w, 0) + Math.max(0, blocks - 1) * plan.gap + (plan.overflow.length ? opts.more : 0);
    assert.equal(used > width, !!plan.tooNarrow);
    if (plan.tooNarrow) assert.ok(visible.every(item => item.keep));
  }
});
