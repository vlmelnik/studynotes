'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { placeBar, GAP } = require('../../../src/shared/float-place.js');

const VIEW = { x0: 0, y0: 0, x1: 1000, y1: 800 };
const TOOLBAR = { x0: 0, y0: 0, x1: 1000, y1: 48 };

function barRect(r, w, h) {
  return { x0: r.x, y0: r.y, x1: r.x + w, y1: r.y + h };
}
function overlaps(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}
function assertInside(r, view) {
  assert.ok(r.x0 >= view.x0 && r.y0 >= view.y0 && r.x1 <= view.x1 && r.y1 <= view.y1, JSON.stringify(r));
}

test('target at the top under the toolbar: bar goes below', () => {
  const target = { x0: 300, y0: 60, x1: 500, y1: 120 };
  const r = placeBar({ w: 200, h: 40 }, target, VIEW, [TOOLBAR]);
  assert.deepStrictEqual(r, { x: 300, y: 120 + GAP, side: 'below', compact: false });
  const b = barRect(r, 200, 40);
  assert.ok(!overlaps(b, target) && !overlaps(b, TOOLBAR));
});

test('target at the bottom: bar goes above', () => {
  const target = { x0: 300, y0: 700, x1: 500, y1: 790 };
  const r = placeBar({ w: 200, h: 40 }, target, VIEW, [TOOLBAR]);
  assert.deepStrictEqual(r, { x: 300, y: 700 - GAP - 40, side: 'above', compact: false });
});

test('bar slides sideways to stay inside the view', () => {
  const target = { x0: 940, y0: 300, x1: 990, y1: 340 };
  const r = placeBar({ w: 200, h: 40 }, target, VIEW, [TOOLBAR]);
  assert.strictEqual(r.side, 'above');
  assert.strictEqual(r.x, 800);
  assertInside(barRect(r, 200, 40), VIEW);
});

test('narrow window: retries with the compact width', () => {
  const view = { x0: 0, y0: 0, x1: 320, y1: 600 };
  const toolbar = { x0: 0, y0: 0, x1: 320, y1: 48 };
  const target = { x0: 10, y0: 60, x1: 310, y1: 500 };
  const r = placeBar({ w: 400, h: 40, compactW: 200 }, target, view, [toolbar]);
  assert.deepStrictEqual(r, { x: 60, y: 500 + GAP, side: 'below', compact: true });
  const b = barRect(r, 200, 40);
  assertInside(b, view);
  assert.ok(!overlaps(b, target) && !overlaps(b, toolbar));
});

test('target filling the view: farthest corner, clear of the toolbar', () => {
  const target = { x0: 0, y0: 48, x1: 1000, y1: 800 };
  const r = placeBar({ w: 200, h: 40 }, target, VIEW, [TOOLBAR]);
  assert.deepStrictEqual(r, { x: 1000 - GAP - 200, y: 800 - GAP - 40, side: 'inside', compact: false });
});

test('corner prefers the one farthest from the target', () => {
  // The target leaves no room on any side and its centre lies to the lower
  // right, so the upper left corner is the one that hides the least of it.
  const target = { x0: 200, y0: 200, x1: 1000, y1: 800 };
  const r = placeBar({ w: 300, h: 300 }, target, VIEW, []);
  assert.deepStrictEqual(r, { x: GAP, y: GAP, side: 'inside', compact: false });
});

test('corner uses the compact width when the full bar is wider than the view', () => {
  const view = { x0: 0, y0: 0, x1: 300, y1: 400 };
  const r = placeBar({ w: 400, h: 40, compactW: 200 }, view, view, []);
  assert.deepStrictEqual(r, { x: 300 - GAP - 200, y: 400 - GAP - 40, side: 'inside', compact: true });
});

test('missing avoid list is treated as empty', () => {
  const r = placeBar({ w: 100, h: 30 }, { x0: 400, y0: 400, x1: 500, y1: 450 }, VIEW);
  assert.deepStrictEqual(r, { x: 400, y: 400 - GAP - 30, side: 'above', compact: false });
});
