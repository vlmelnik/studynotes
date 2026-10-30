'use strict';
const test = require('node:test');
const assert = require('node:assert');
const g = require('../src/shared/geometry');

const stroke = (pts, s = 2) => ({ id: 'x', t: 'pen', c: '#000', s, p: pts.flatMap(([x, y]) => [x, y, 0.5]) });

test('strokeHit detects crossing and misses distant strokes', () => {
  const st = stroke([[0, 0], [100, 0]]);
  assert.ok(g.strokeHit(st, 50, -10, 50, 10, 1)); // crosses
  assert.ok(g.strokeHit(st, 50, 3, 50, 3, 3)); // near
  assert.ok(!g.strokeHit(st, 50, 20, 60, 20, 3));
});

test('partial eraser splits a stroke in two', () => {
  const st = stroke([[0, 0], [100, 0]]);
  const pieces = g.eraseFromStroke(st, 50, -10, 50, 10, 5);
  assert.strictEqual(pieces.length, 2);
  const maxX0 = Math.max(...pieces[0].p.filter((_, i) => i % 3 === 0));
  const minX1 = Math.min(...pieces[1].p.filter((_, i) => i % 3 === 0));
  assert.ok(maxX0 < 46 && minX1 > 54, `${maxX0} ${minX1}`);
  assert.strictEqual(g.eraseFromStroke(st, 50, 50, 60, 50, 5), null);
});

test('lasso selects strokes mostly inside the loop', () => {
  const poly = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.ok(g.strokeInLasso(stroke([[10, 10], [90, 90]]), poly));
  assert.ok(!g.strokeInLasso(stroke([[10, 10], [300, 300]]), poly));
});

test('transformStroke moves and scales', () => {
  const st = stroke([[10, 10], [20, 20]], 4);
  const t = g.transformStroke(st, 2, 2, 5, 5);
  assert.deepStrictEqual(t.p, [25, 25, 0.5, 45, 45, 0.5]);
  assert.strictEqual(t.s, 8);
  assert.deepStrictEqual(st.p, [10, 10, 0.5, 20, 20, 0.5]); // original untouched
});

function jitter(pts, amt, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * amt;
  return pts.map(([x, y]) => [x + rnd(), y + rnd()]);
}

function sampleLine(a, b, n = 30) {
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
}

test('recognizes a wobbly line and snaps it horizontal', () => {
  const r = g.recognizeShape(jitter(sampleLine([0, 0], [200, 4]), 1.5));
  assert.strictEqual(r.type, 'line');
  const last = r.points[r.points.length - 1];
  assert.ok(Math.abs(last[1] - r.points[0][1]) < 0.01, 'snapped to horizontal');
});

test('recognizes rectangle (starting mid-edge), triangle and circle', () => {
  const rect = [
    ...sampleLine([50, 0], [100, 0], 10), ...sampleLine([100, 0], [100, 60]), ...sampleLine([100, 60], [0, 60]),
    ...sampleLine([0, 60], [0, 0]), ...sampleLine([0, 0], [48, 1], 10),
  ];
  assert.strictEqual(g.recognizeShape(jitter(rect, 1.2)).type, 'rect');

  const tri = [...sampleLine([0, 100], [60, 0]), ...sampleLine([60, 0], [120, 100]), ...sampleLine([120, 100], [2, 99])];
  assert.strictEqual(g.recognizeShape(jitter(tri, 1.2)).type, 'triangle');

  const circle = Array.from({ length: 80 }, (_, i) => {
    const t = (i / 78) * Math.PI * 2;
    return [100 + 50 * Math.cos(t), 100 + 48 * Math.sin(t)];
  });
  const c = g.recognizeShape(jitter(circle, 1.5));
  assert.strictEqual(c.type, 'ellipse');
});

test('scribbles are not recognized as shapes', () => {
  const scribble = [];
  for (let i = 0; i < 60; i++) scribble.push([i * 3, (i % 2) * 30 + Math.sin(i) * 5]);
  assert.strictEqual(g.recognizeShape(scribble), null);
});

test('partial eraser keeps the remaining points exactly (line does not change shape)', () => {
  const pts = [];
  for (let i = 0; i <= 60; i++) pts.push([i * 2, 10 * Math.sin(i / 5)]);
  const st = stroke(pts);
  const pieces = g.eraseFromStroke(st, 60, -20, 60, 20, 3);
  assert.strictEqual(pieces.length, 2);
  const orig = new Set(pts.map(([x, y]) => `${x},${y}`));
  for (const pc of pieces) {
    const inner = []; // all but the cut point at the erased end
    for (let i = 0; i < pc.p.length; i += 3) inner.push(`${pc.p[i]},${pc.p[i + 1]}`);
    const kept = inner.filter((k) => orig.has(k)).length;
    assert.ok(kept >= inner.length - 1, `only the cut point is new (${kept}/${inner.length})`);
  }
  // erasing again elsewhere does not touch the other piece at all
  const again = g.eraseFromStroke({ ...st, p: pieces[0].p }, 10, -20, 10, 20, 3);
  assert.deepStrictEqual(again[again.length - 1].p.slice(-6), pieces[0].p.slice(-6));
});

test('exact eraser cuts at the eraser circle and records the cut for clipping', () => {
  const st = { ...stroke([[0, 0], [100, 0]]), s: 6 };
  const normal = g.eraseFromStroke(st, 50, 0, 50, 0, 5);
  const exact = g.eraseFromStroke(st, 50, 0, 50, 0, 5, true);
  const endX = (pc) => pc.p[pc.p.length - 3];
  assert.ok(Math.abs(endX(exact[0]) - 45) < 0.01, String(endX(exact[0])));
  assert.ok(endX(normal[0]) < 44, 'normal mode also removes half the line width');
  assert.deepStrictEqual(exact[0].k, [[50, 0, 50, 0, 5]]);
  assert.deepStrictEqual(exact[1].k, [[50, 0, 50, 0, 5]]);
  assert.ok(!normal[0].k);
  // a long straight segment (shape edge) is cut too, no resampling of the rest
  assert.strictEqual(exact[0].p.length, 6);
  // cuts move with the stroke
  const moved = g.transformStroke({ ...st, p: exact[0].p, k: exact[0].k }, 2, 2, 10, 0);
  assert.deepStrictEqual(moved.k, [[110, 0, 110, 0, 10]]);
  // a second cut that only grazes the ink next to the first keeps both (no erased ink comes back)
  const again = g.eraseFromStroke({ ...st, p: exact[1].p, k: exact[1].k }, 57, 4.5, 57, 4.5, 2, true);
  assert.strictEqual(again.length, 1);
  assert.deepStrictEqual(again[0].p, exact[1].p, 'grazing: points unchanged, only clipped');
  assert.deepStrictEqual(again[0].k.map((c) => c[0]), [50, 57]);
  // cuts far away are not carried along
  const far = g.eraseFromStroke({ ...st, p: exact[1].p, k: exact[1].k }, 95, 0, 95, 0, 2, true);
  assert.ok(far.every((pc) => !pc.k || pc.k.every((c) => c[0] !== 50 || pc.p[0] < 60)), JSON.stringify(far.map((pc) => [pc.p[0], pc.k])));
});

test('eraser passing close by (inside the hit margin, not over the ink) changes nothing', () => {
  const st = { ...stroke([[0, 0], [100, 0]]), s: 6 };
  assert.strictEqual(g.eraseFromStroke(st, 50, 6.5, 60, 6.5, 4), null);
});
