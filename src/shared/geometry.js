'use strict';
// Pure geometry for eraser, lasso and shape recognition. All in page units.

function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function distSegSeg(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distPointSeg(ax, ay, cx, cy, dx, dy),
    distPointSeg(bx, by, cx, cy, dx, dy),
    distPointSeg(cx, cy, ax, ay, bx, by),
    distPointSeg(dx, dy, ax, ay, bx, by),
  );
}

const bboxCache = new WeakMap();
// [minX, minY, maxX, maxY] of a stroke's centre line, padded by half its width.
function strokeBBox(st) {
  let b = bboxCache.get(st);
  if (b) return b;
  const p = st.p;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const pad = (st.s || 1) / 2;
  b = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  bboxCache.set(st, b);
  return b;
}

function bboxesOverlap(a, b, pad = 0) {
  return a[0] - pad <= b[2] && a[2] + pad >= b[0] && a[1] - pad <= b[3] && a[3] + pad >= b[1];
}

// Does the eraser segment (a→b, radius r) touch the stroke?
function strokeHit(st, ax, ay, bx, by, r) {
  const bb = strokeBBox(st);
  const eb = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  if (!bboxesOverlap(bb, eb, r)) return false;
  const p = st.p;
  const lim = r + (st.s || 1) / 2;
  if (p.length === 3) return distPointSeg(p[0], p[1], ax, ay, bx, by) <= lim;
  for (let i = 0; i + 3 < p.length; i += 3) {
    if (distSegSeg(p[i], p[i + 1], p[i + 3], p[i + 4], ax, ay, bx, by) <= lim) return true;
  }
  return false;
}

// Insert points so consecutive points are at most `step` apart.
function resample(p, step) {
  const out = [p[0], p[1], p[2]];
  for (let i = 3; i < p.length; i += 3) {
    const x0 = p[i - 3], y0 = p[i - 2], z0 = p[i - 1];
    const x1 = p[i], y1 = p[i + 1], z1 = p[i + 2];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(d / step);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
    }
    out.push(x1, y1, z1);
  }
  return out;
}

// Partial eraser: remove the part of the stroke under the eraser segment
// (a→b, radius r). The points that stay are NOT moved or resampled – only the
// exact cut points are added – so the rest of the line keeps its shape while
// erasing. Returns null if nothing was erased, otherwise the remaining pieces
// as { p, k }: k = the eraser capsules [ax, ay, bx, by, r] that clip the
// piece's ink (exact mode). With `exact`, exactly the eraser circle is
// removed: the piece reaches the circle and the renderers clip it there.
function eraseFromStroke(st, ax, ay, bx, by, r, exact = false) {
  if (!strokeHit(st, ax, ay, bx, by, r)) return null;
  const half = (st.s || 1) / 2;
  const lim = exact ? r : r + half * 0.5;
  const cap = [ax, ay, bx, by, r];
  const p = st.p;
  const inside = (x, y) => distPointSeg(x, y, ax, ay, bx, by) <= lim;
  const lerp = (i, t) => [p[i] + (p[i + 3] - p[i]) * t, p[i + 1] + (p[i + 4] - p[i + 1]) * t, p[i + 2] + (p[i + 5] - p[i + 2]) * t];
  // exact crossing between two parameters on segment i (one inside, one outside)
  const cross = (i, t0, t1) => {
    const in0 = inside(...lerp(i, t0));
    for (let k = 0; k < 24; k++) {
      const m = (t0 + t1) / 2;
      if (inside(...lerp(i, m)) === in0) t0 = m; else t1 = m;
    }
    return lerp(i, in0 ? t1 : t0); // the outside side of the boundary
  };
  const pieces = [];
  let cur = [], touched = false;
  const close = () => { if (cur.length >= 6) pieces.push({ p: cur }); cur = []; };
  let wasIn = inside(p[0], p[1]);
  if (!wasIn) cur.push(p[0], p[1], p[2]); else touched = true;
  const step = Math.max(0.25, lim / 2);
  for (let i = 0; i + 3 < p.length; i += 3) {
    const len = Math.hypot(p[i + 3] - p[i], p[i + 4] - p[i + 1]);
    const n = Math.max(1, Math.ceil(len / step));
    let tPrev = 0;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const q = lerp(i, t);
      const isIn = inside(q[0], q[1]);
      if (isIn !== wasIn) {
        touched = true;
        const b = cross(i, tPrev, t);
        cur.push(b[0], b[1], b[2]);
        if (isIn) close();
        wasIn = isIn;
      }
      tPrev = t;
    }
    if (!wasIn) cur.push(p[i + 3], p[i + 4], p[i + 5]);
  }
  close();
  const cuts = [...(Array.isArray(st.k) ? st.k : []), ...(exact ? [cap] : [])];
  if (!touched) {
    // the centre line was not reached: normal mode changes nothing; exact mode
    // still removes the edge of the ink under the circle (by clipping)
    return exact ? [{ p: st.p.slice(), k: cuts }] : null;
  }
  const out = [];
  for (const pc of pieces) {
    // drop the duplicate a crossing exactly at an original point makes
    const q = pc.p, pts = [q[0], q[1], q[2]];
    for (let i = 3; i < q.length; i += 3) if (Math.abs(q[i] - pts[pts.length - 3]) > 1e-4 || Math.abs(q[i + 1] - pts[pts.length - 2]) > 1e-4) pts.push(q[i], q[i + 1], q[i + 2]);
    if (pts.length < 6 || pieceLength(pts) <= 0.05) continue;
    // cuts that can still touch this piece's ink (earlier ones too: their
    // circles may overlap the new end)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 3) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
    const k = cuts.filter((c) => distSegRect(c, [x0 - half, y0 - half, x1 + half, y1 + half]) <= c[4]);
    out.push(k.length ? { p: pts, k } : { p: pts });
  }
  return out;
}

// Distance from a capsule's centre segment to a rectangle (0 if it crosses).
function distSegRect([ax, ay, bx, by], [x0, y0, x1, y1]) {
  const inR = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (inR(ax, ay) || inR(bx, by)) return 0;
  return Math.min(
    distSegSeg(ax, ay, bx, by, x0, y0, x1, y0), distSegSeg(ax, ay, bx, by, x1, y0, x1, y1),
    distSegSeg(ax, ay, bx, by, x1, y1, x0, y1), distSegSeg(ax, ay, bx, by, x0, y1, x0, y0),
  );
}

function pieceLength(p) {
  let L = 0;
  for (let i = 3; i < p.length; i += 3) L += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
  return L;
}

// Outline of an eraser capsule (segment a→b with radius r) as a polygon.
function capsulePolygon([ax, ay, bx, by, r], n = 14) {
  const a0 = Math.atan2(by - ay, bx - ax);
  const out = [];
  for (let i = 0; i <= n; i++) { const t = a0 + Math.PI / 2 + (Math.PI * i) / n; out.push([ax + r * Math.cos(t), ay + r * Math.sin(t)]); }
  for (let i = 0; i <= n; i++) { const t = a0 - Math.PI / 2 + (Math.PI * i) / n; out.push([bx + r * Math.cos(t), by + r * Math.sin(t)]); }
  return out;
}

// Move/scale/rotate the eraser cuts of a stroke together with its points.
function mapCuts(k, fn, scale = 1) {
  if (!Array.isArray(k) || !k.length) return undefined;
  return k.map((c) => {
    const [x0, y0] = fn(c[0], c[1]), [x1, y1] = fn(c[2], c[3]);
    return [round2(x0), round2(y0), round2(x1), round2(y1), round2(c[4] * scale)];
  });
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Lasso: a stroke is selected when most of its points lie inside the loop.
function strokeInLasso(st, poly) {
  let p = st.p;
  if (p.length < 60) {
    // Sparse strokes (lines, shapes): judge along the segments, not just the vertices.
    const b = strokeBBox(st);
    p = resample(p, Math.max(0.5, Math.hypot(b[2] - b[0], b[3] - b[1]) / 40));
  }
  const n = p.length / 3;
  const step = Math.max(1, Math.floor(n / 40));
  let inside = 0, total = 0;
  for (let k = 0; k < n; k += step) {
    total++;
    if (pointInPolygon(p[k * 3], p[k * 3 + 1], poly)) inside++;
  }
  return total > 0 && inside / total >= 0.5;
}

function transformStroke(st, sx, sy, tx, ty, newId) {
  const p = st.p.slice();
  for (let i = 0; i < p.length; i += 3) {
    p[i] = round2(p[i] * sx + tx);
    p[i + 1] = round2(p[i + 1] * sy + ty);
  }
  const k = Math.sqrt(Math.abs(sx * sy));
  const out = { ...st, id: newId || st.id, p, s: round2(st.s * k) };
  if (st.k) { out.k = mapCuts(st.k, (x, y) => [x * sx + tx, y * sy + ty], k); if (!out.k) delete out.k; }
  return out;
}

function round2(v) { return Math.round(v * 100) / 100; }

// ---------- Shape recognition (draw and hold) ----------

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPointSeg(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

function turnAngle(prev, cur, next) {
  const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
  const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d; // 0 = straight on
}

function densify(vertices, step = 2) {
  const out = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const [x0, y0] = vertices[i], [x1, y1] = vertices[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  out.push(vertices[vertices.length - 1]);
  return out;
}

// Arc from angle a0 to a1 around (cx, cy).
function arcPts(cx, cy, rx, ry, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

function roundRectPts(x0, y0, x1, y1, r) {
  r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (r < 0.5) return densify([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
  const n = Math.max(8, Math.round(r / 1.5));
  const H = Math.PI / 2;
  const pts = [
    ...densify([[x0 + r, y0], [x1 - r, y0]]),
    ...arcPts(x1 - r, y0 + r, r, r, -H, 0, n),
    ...densify([[x1, y0 + r], [x1, y1 - r]]),
    ...arcPts(x1 - r, y1 - r, r, r, 0, H, n),
    ...densify([[x1 - r, y1], [x0 + r, y1]]),
    ...arcPts(x0 + r, y1 - r, r, r, H, 2 * H, n),
    ...densify([[x0, y1 - r], [x0, y0 + r]]),
    ...arcPts(x0 + r, y0 + r, r, r, 2 * H, 3 * H, n),
  ];
  pts.push([x0 + r, y0]);
  return pts;
}

function regular(cx, cy, rx, ry, n, rot = -Math.PI / 2) {
  const v = [];
  for (let i = 0; i < n; i++) v.push([cx + rx * Math.cos(rot + (i * 2 * Math.PI) / n), cy + ry * Math.sin(rot + (i * 2 * Math.PI) / n)]);
  return densify([...v, v[0]]);
}

function arrowHead(x0, y0, x1, y1) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.min(18, Math.hypot(x1 - x0, y1 - y0) * 0.35);
  return [
    [x1 - len * Math.cos(ang - 0.45), y1 - len * Math.sin(ang - 0.45)],
    [x1 - len * Math.cos(ang + 0.45), y1 - len * Math.sin(ang + 0.45)],
  ];
}

// Single polyline shapes. `a` is two points for line-like shapes, otherwise
// a box [x0, y0, x1, y1] (or legacy forms for 'polygon' / 'ellipse').
function shapePoints(type, a) {
  switch (type) {
    case 'line': return densify([a[0], a[1]]);
    case 'polygon': return densify([...a, a[0]]);
    case 'rect': {
      const [x0, y0, x1, y1] = a;
      return densify([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
    }
    case 'roundrect': {
      const [x0, y0, x1, y1, r] = a;
      return roundRectPts(x0, y0, x1, y1, r ?? Math.min(x1 - x0, y1 - y0) * 0.18);
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = a;
      const n = Math.max(96, Math.round((rx + ry) * 0.8));
      return arcPts(cx, cy, rx, ry, 0, Math.PI * 2, n);
    }
    case 'arrow': {
      const [[x0, y0], [x1, y1]] = a;
      const [h1, h2] = arrowHead(x0, y0, x1, y1);
      return densify([[x0, y0], [x1, y1], h1, [x1, y1], h2]);
    }
    case 'darrow': {
      const [[x0, y0], [x1, y1]] = a;
      const [h1, h2] = arrowHead(x0, y0, x1, y1);
      const [g1, g2] = arrowHead(x1, y1, x0, y0);
      return densify([g1, [x0, y0], g2, [x0, y0], [x1, y1], h1, [x1, y1], h2]);
    }
    default: {
      const [x0, y0, x1, y1] = a;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
      switch (type) {
        case 'triangle': return densify([[cx, y0], [x1, y1], [x0, y1], [cx, y0]]);
        case 'rtriangle': return densify([[x0, y0], [x1, y1], [x0, y1], [x0, y0]]);
        case 'diamond': return densify([[cx, y0], [x1, cy], [cx, y1], [x0, cy], [cx, y0]]);
        case 'pentagon': return regular(cx, cy, rx, ry, 5);
        case 'hexagon': return regular(cx, cy, rx, ry, 6, 0);
        case 'parallelogram': {
          const k = (x1 - x0) * 0.22;
          return densify([[x0 + k, y0], [x1, y0], [x1 - k, y1], [x0, y1], [x0 + k, y0]]);
        }
        case 'star': {
          const v = [];
          for (let i = 0; i < 10; i++) {
            const r = i % 2 ? 0.42 : 1;
            const t = -Math.PI / 2 + (i * Math.PI) / 5;
            v.push([cx + rx * r * Math.cos(t), cy + ry * r * Math.sin(t)]);
          }
          return densify([...v, v[0]]);
        }
        case 'bubble': {
          // Rounded box with a tail at the bottom left.
          const by = y0 + (y1 - y0) * 0.78;
          const r = Math.min(x1 - x0, by - y0) * 0.2;
          const box = roundRectPts(x0, y0, x1, by, r);
          // Open the bottom edge for the tail.
          const tx = x0 + (x1 - x0) * 0.22;
          const out = [];
          for (const q of box) {
            out.push(q);
          }
          const tail = densify([[tx + (x1 - x0) * 0.14, by], [x0 + (x1 - x0) * 0.12, y1], [tx, by]]);
          return out.concat(tail);
        }
        case 'cross': {
          const kx = (x1 - x0) / 3, ky = (y1 - y0) / 3;
          return densify([[x0 + kx, y0], [x1 - kx, y0], [x1 - kx, y0 + ky], [x1, y0 + ky], [x1, y1 - ky], [x1 - kx, y1 - ky], [x1 - kx, y1],
            [x0 + kx, y1], [x0 + kx, y1 - ky], [x0, y1 - ky], [x0, y0 + ky], [x0 + kx, y0 + ky], [x0 + kx, y0]]);
        }
        default: return null;
      }
    }
  }
}

// Shapes made of several strokes (e.g. a cylinder). Returns [[x,y]...][].
function shapeStrokes(type, a) {
  if (type === 'cylinder') {
    const [x0, y0, x1, y1] = a;
    const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2, ry = Math.min((y1 - y0) * 0.15, rx * 0.5);
    const n = Math.max(64, Math.round(rx));
    return [
      arcPts(cx, y0 + ry, rx, ry, 0, Math.PI * 2, n),
      arcPts(cx, y1 - ry, rx, ry, 0, Math.PI, Math.round(n / 2)),
      densify([[x0, y0 + ry], [x0, y1 - ry]]),
      densify([[x1, y0 + ry], [x1, y1 - ry]]),
    ];
  }
  if (type === 'axes') {
    const [x0, y0, x1, y1] = a;
    return [shapePoints('arrow', [[x0, y1], [x0, y0]]), shapePoints('arrow', [[x0, y1], [x1, y1]])];
  }
  const p = shapePoints(type, a);
  return p ? [p] : [];
}

const BOX_SHAPES = ['rect', 'roundrect', 'ellipse', 'triangle', 'rtriangle', 'diamond', 'pentagon', 'hexagon', 'parallelogram', 'star', 'bubble', 'cross', 'cylinder', 'axes'];
const LINE_SHAPES = ['line', 'arrow', 'darrow'];

function snapAngle(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(snapped - ang) < (6 * Math.PI) / 180) return [a, [a[0] + len * Math.cos(snapped), a[1] + len * Math.sin(snapped)]];
  return [a, b];
}

// pts: [[x,y], ...]. Returns { type, points } or null when nothing fits.
function recognizeShape(pts) {
  if (pts.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, L = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (i) L += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
  }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 10) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);

  // Straight line
  let maxDev = 0;
  for (const q of pts) maxDev = Math.max(maxDev, distPointSeg(q[0], q[1], first[0], first[1], last[0], last[1]));
  if (chord > 10 && maxDev < Math.max(2.5, chord * 0.06) && L < chord * 1.15) {
    return { type: 'line', points: shapePoints('line', snapAngle(first, last)) };
  }

  const closed = chord < Math.max(12, diag * 0.22);
  if (!closed) return null;

  // Polygon corners: simplify, then drop near-straight vertices.
  const loop = pts.concat([first]);
  let v = rdp(loop, Math.max(3, diag * 0.06));
  v = v.slice(0, -1); // drop duplicate closing point
  let changed = true;
  while (changed && v.length > 3) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const prev = v[(i - 1 + v.length) % v.length], next = v[(i + 1) % v.length];
      const seg = Math.min(Math.hypot(v[i][0] - prev[0], v[i][1] - prev[1]), Math.hypot(next[0] - v[i][0], next[1] - v[i][1]));
      if (turnAngle(prev, v[i], next) < (28 * Math.PI) / 180 || seg < diag * 0.08) {
        v.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  // How well does an ellipse fit?
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  let ellErr = 0;
  for (const q of pts) {
    const d = Math.hypot((q[0] - cx) / (rx || 1), (q[1] - cy) / (ry || 1));
    ellErr += Math.abs(d - 1);
  }
  ellErr /= pts.length;

  if (v.length === 3 && ellErr > 0.08) return { type: 'triangle', points: shapePoints('polygon', v) };
  if (v.length === 4 && ellErr > 0.045) {
    // Axis-aligned rectangle if every edge is close to horizontal/vertical.
    let aligned = true;
    for (let i = 0; i < 4; i++) {
      const a = v[i], b = v[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0])) % (Math.PI / 2);
      const off = Math.min(ang, Math.PI / 2 - ang);
      if (off > (12 * Math.PI) / 180) aligned = false;
    }
    if (aligned) {
      // Rounded corners: how far do the drawn corners stay away from the box corners?
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      let d = 0;
      for (const [cxr, cyr] of corners) {
        let m = Infinity;
        for (const q of pts) m = Math.min(m, Math.hypot(q[0] - cxr, q[1] - cyr));
        d += m / 4;
      }
      const side = Math.min(x1 - x0, y1 - y0);
      if (d > Math.max(3, side * 0.06)) {
        const r = Math.min(side / 2, d / 0.414 * 0.9);
        return { type: 'roundrect', points: shapePoints('roundrect', [x0, y0, x1, y1, r]) };
      }
      return { type: 'rect', points: shapePoints('rect', [x0, y0, x1, y1]) };
    }
    return { type: 'polygon', points: shapePoints('polygon', v) };
  }
  // A rounded rectangle often simplifies to more than 4 vertices: compare
  // how well it fills its bounding box (rounded rect ≈ 0.9–0.98, ellipse ≈ 0.785).
  if (v.length >= 4 && v.length <= 8 && ellErr > 0.045) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      area += p1[0] * p2[1] - p2[0] * p1[1];
    }
    const fill = Math.abs(area / 2) / ((x1 - x0) * (y1 - y0));
    if (fill > 0.86) {
      const side = Math.min(x1 - x0, y1 - y0);
      // Fill of a rounded rect with radius r: 1 - (4 - π) r² / (w h)
      const r = Math.sqrt(Math.max(0, (1 - fill) * (x1 - x0) * (y1 - y0) / (4 - Math.PI)));
      if (r > side * 0.08) return { type: 'roundrect', points: shapePoints('roundrect', [x0, y0, x1, y1, Math.min(r, side / 2)]) };
      return { type: 'rect', points: shapePoints('rect', [x0, y0, x1, y1]) };
    }
  }
  if (ellErr < 0.16) {
    // Snap near-circles to circles.
    let rrx = rx, rry = ry;
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) rrx = rry = (rx + ry) / 2;
    return { type: 'ellipse', points: shapePoints('ellipse', [cx, cy, rrx, rry]) };
  }
  if (v.length >= 3 && v.length <= 6) return { type: 'polygon', points: shapePoints('polygon', v) };
  return null;
}

// Distance from a point to a stroke's centre line (page units).
function distToStroke(st, x, y) {
  const p = st.p;
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y);
  let m = Infinity;
  for (let i = 0; i + 3 < p.length; i += 3) m = Math.min(m, distPointSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]));
  return m;
}

function rectsIntersect(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

module.exports = {
  distToStroke, rectsIntersect, shapeStrokes, roundRectPts, BOX_SHAPES, LINE_SHAPES,
  distPointSeg, distSegSeg, strokeBBox, bboxesOverlap, strokeHit, eraseFromStroke, resample,
  pointInPolygon, strokeInLasso, transformStroke, capsulePolygon, mapCuts, rdp, recognizeShape, shapePoints, snapAngle, round2,
};
