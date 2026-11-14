'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('shapes: corners and the closing point are fully covered (no notches or gaps)', () => {
  const { shapeOutline, isClosedShape } = require('../../../src/shared/ink');
  const { shapeStrokes } = require('../../../src/shared/geometry');
  const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const covered = (polys, x, y) => polys.some((p) => inPoly(x, y, p));
  const [pts] = shapeStrokes('rect', [100, 100, 300, 200]);
  const st = { t: 'pen', s: 6, sh: 1, np: 1, c: '#000', p: pts.flatMap(([x, y]) => [x, y, 0.5]) };
  const o = shapeOutline(st);
  assert.ok(o.multi && isClosedShape(st));
  // every corner: points within the pen radius all around it are ink
  for (const [cx, cy] of [[100, 100], [300, 100], [300, 200], [100, 200]]) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      assert.ok(covered(o, cx + 2.6 * Math.cos(t), cy + 2.6 * Math.sin(t)), `corner ${cx},${cy} angle ${a}`);
    }
  }
  // edges are exactly pen-wide, inside stays empty
  assert.ok(covered(o, 200, 102.9) && !covered(o, 200, 103.2) && !covered(o, 200, 150));
  // all polygons wound the same way (non-zero fill = union)
  const area = (p) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0);
  assert.ok(o.every((p) => area(p) > 0));
  // an open line is not "closed" (no fill)
  const [ln] = shapeStrokes('line', [[0, 0], [100, 0]]);
  assert.ok(!isClosedShape({ s: 2, sh: 1, p: ln.flatMap(([x, y]) => [x, y, 0.5]) }));
});
