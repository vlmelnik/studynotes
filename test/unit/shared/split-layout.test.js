'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../../../src/shared/split-layout');

const st = { mode: 'split', ratio: 0.5, notesSide: 'left' };

test('layout: notes left or right, the reader on the other side, divider between', () => {
  const l = S.layout(st, 1206);
  assert.deepStrictEqual(l, { notes: { x: 0, width: 600 }, divider: { x: 600, width: 6 }, reader: { x: 606, width: 600 } });
  const r = S.layout({ ...st, notesSide: 'right', ratio: 0.6 }, 1006);
  assert.strictEqual(r.reader.x, 0);
  assert.strictEqual(r.notes.width, 600);
  assert.strictEqual(r.notes.x + r.notes.width, 1006);
  assert.deepStrictEqual(S.layout({ mode: 'single' }, 900), { notes: { x: 0, width: 900 }, reader: null, divider: null });
});

test('layout: both panes keep their minimum; a narrow window hides the reader without changing the state', () => {
  const l = S.layout({ ...st, ratio: 0.95 }, 1006);
  assert.strictEqual(l.reader.width, 280);
  const narrow = S.layout(st, 500);
  assert.strictEqual(narrow.reader, null);
  assert.strictEqual(st.mode, 'split');
});

test('dragDivider: the ratio follows the divider, clamped; swap goes back and forth', () => {
  const s1 = S.dragDivider(st, 1006, 403);
  assert.ok(Math.abs(s1.ratio - 0.4) < 0.001, String(s1.ratio));
  assert.ok(S.dragDivider(st, 1006, 5).ratio >= 280 / 1000);
  const right = S.dragDivider({ ...st, notesSide: 'right' }, 1006, 403);
  assert.ok(Math.abs(right.ratio - 0.6) < 0.001);
  assert.deepStrictEqual(S.swap(S.swap(st)), st);
  assert.strictEqual(st.ratio, 0.5);
});

test('paneAt: borders belong to the pane on their right', () => {
  const l = S.layout(st, 1206);
  assert.strictEqual(S.paneAt(l, 599), 'notes');
  assert.strictEqual(S.paneAt(l, 600), 'divider');
  assert.strictEqual(S.paneAt(l, 605), 'divider');
  assert.strictEqual(S.paneAt(l, 606), 'reader');
  assert.strictEqual(S.paneAt(S.layout({ mode: 'single' }, 500), 400), 'notes');
});
