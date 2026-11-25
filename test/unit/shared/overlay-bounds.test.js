'use strict';
const test = require('node:test');
const assert = require('node:assert');
const B = require('../../../src/shared/overlay-bounds');

const left = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 1280, height: 984 };

test('clampBounds: minimum size, kept where the title strip is visible on either monitor', () => {
  assert.deepStrictEqual(B.clampBounds({ x: 100, y: 100, width: 100, height: 50 }, [left]), { x: 100, y: 100, width: 240, height: 180 });
  const across = { x: 1800, y: 200, width: 400, height: 500 };
  assert.deepStrictEqual(B.clampBounds(across, [left, right]), across);
});

test('clampBounds: a window left on an unplugged monitor comes back to the nearest one', () => {
  const lost = { x: 2400, y: 300, width: 400, height: 500 };
  const b = B.clampBounds(lost, [left]);
  assert.ok(b.x + b.width <= 1920 && b.x >= 0 && b.y >= 0, JSON.stringify(b));
  const above = B.clampBounds({ x: 300, y: -400, width: 400, height: 300 }, [left]);
  assert.strictEqual(above.y, 0);
});

test('snapBounds: near an edge it snaps, far away it stays', () => {
  assert.deepStrictEqual(B.snapBounds({ x: 10, y: 1040 - 300 - 12, width: 400, height: 300 }, left), { x: 0, y: 740, width: 400, height: 300 });
  const free = { x: 300, y: 300, width: 400, height: 300 };
  assert.deepStrictEqual(B.snapBounds(free, left), free);
});

test('resizeKeepingAspect: every edge without aspect moves only that edge', () => {
  const b = { x: 100, y: 100, width: 400, height: 300 };
  assert.deepStrictEqual(B.resizeKeepingAspect(b, 'e', 50, 0, null), { x: 100, y: 100, width: 450, height: 300 });
  assert.deepStrictEqual(B.resizeKeepingAspect(b, 'w', 50, 0, null), { x: 150, y: 100, width: 350, height: 300 });
  assert.deepStrictEqual(B.resizeKeepingAspect(b, 's', 0, 40, null), { x: 100, y: 100, width: 400, height: 340 });
  assert.deepStrictEqual(B.resizeKeepingAspect(b, 'n', 0, 40, null), { x: 100, y: 140, width: 400, height: 260 });
  assert.deepStrictEqual(B.resizeKeepingAspect(b, 'nw', -20, -20, null), { x: 80, y: 80, width: 420, height: 320 });
});

test('resizeKeepingAspect: with the page aspect the opposite corner stays and the size follows', () => {
  const a = 0.75;
  const b = { x: 100, y: 100, width: 300, height: 400 };
  for (const edge of ['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw']) {
    const r = B.resizeKeepingAspect(b, edge, edge.includes('w') ? -60 : 60, edge.includes('n') ? -60 : 60, a);
    assert.ok(Math.abs(r.width / r.height - a) < 0.01, `${edge} ${JSON.stringify(r)}`);
    if (edge === 'se') assert.ok(r.x === 100 && r.y === 100);
    if (edge === 'nw') assert.ok(r.x + r.width === 400 && r.y + r.height === 500, JSON.stringify(r));
    if (edge === 'ne') assert.ok(r.x === 100 && r.y + r.height === 500);
    if (edge === 'sw') assert.ok(r.x + r.width === 400 && r.y === 100);
  }
  const small = B.resizeKeepingAspect(b, 'se', -500, -500, a);
  assert.ok(small.width >= 240 && small.height >= 180 && Math.abs(small.width / small.height - a) < 0.01);
});

test('defaultBounds: a quarter of the width at the right edge, centred, page aspect', () => {
  const d = B.defaultBounds(left, 0.7071);
  assert.strictEqual(d.width, 480);
  assert.ok(d.x + d.width <= 1920 && d.x > 1920 / 2);
  assert.ok(Math.abs(d.y - (1040 - d.height) / 2) <= 1);
});
