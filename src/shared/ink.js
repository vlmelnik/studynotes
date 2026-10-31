'use strict';
// Stroke → filled outline. Shared by the renderer (canvas) and the PDF export
// so exported ink looks exactly like on screen.
//
// Stroke format (stored in pages/<id>.json):
//   { id, t: 'pen'|'hl', ps: 'ball'|'fountain', c: '#rrggbb', s: size,
//     np: 1 if input had no real pressure, sh: 1 for recognised shapes,
//     p: [x, y, pressure, x, y, pressure, ...] }   (page units = PDF points)

const HIGHLIGHTER_ALPHA = 0.35;

function strokePoints(st) {
  const p = st.p;
  const out = new Array(p.length / 3);
  for (let i = 0, j = 0; i < p.length; i += 3, j++) out[j] = [p[i], p[i + 1], p[i + 2]];
  return out;
}

// Pen styles. `look` tells both renderers how to paint the outline.
//   alpha   – opacity of the fill
//   texture – 'grain' (pencil) / 'bristle' (brush): screen-only texture
//   glow    – neon: soft halo + light core
const PEN_STYLES = {
  ball: { label: 'Ballpoint' },
  fountain: { label: 'Fountain' },
  pencil: { label: 'Pencil', alpha: 0.82, texture: 'grain' },
  marker: { label: 'Marker', alpha: 0.92 },
  brush: { label: 'Brush' }, // smooth stroke, thin–thick with pressure (no bristle lines)
  neon: { label: 'Neon', glow: true },
};

function strokeLook(st) {
  if (st.t === 'hl') return { alpha: HIGHLIGHTER_ALPHA };
  const s = PEN_STYLES[st.ps] || PEN_STYLES.ball;
  return { alpha: s.alpha ?? 1, texture: s.texture || null, glow: !!s.glow };
}

// ---- the line engine ------------------------------------------------------
// A line is the union of round "beads": a circle at every point (radius from
// the pressure) and the tangent band between two neighbouring circles. Every
// piece depends only on its own points, so a line never changes while it is
// being drawn (no wobble), sharp turns stay clean (no triangles or spikes),
// and the end looks exactly like the middle (no thin tail with a blob).
// All pieces wind the same way and are filled together (non-zero rule).

// How much the pressure changes the width (0 = not at all), per pen style.
const THINNING = { ball: 0.3, fountain: 0.6, pencil: 0.25, marker: 0, brush: 0.75, neon: 0 };

// Light touches already give a usable line (tablets report little pressure
// for a light hand); full pressure stays the thickest.
function pressureCurve(p) {
  return Math.pow(Math.min(1, Math.max(0, p)), 0.65);
}

function strokeRadii(st, size) {
  const p = st.p, n = p.length / 3;
  const r = new Float64Array(n);
  if (st.t === 'hl') { r.fill(size / 2); return r; }
  const style = st.ps || 'ball';
  const t = THINNING[style] ?? 0.3;
  // without real pressure (mouse): the fountain pen and brush get thinner
  // when the line goes fast, like ink running out
  const simulate = st.np && (style === 'fountain' || style === 'brush');
  let q = 0.5;
  for (let i = 0; i < n; i++) {
    let pr;
    if (simulate) {
      const d = i ? Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2]) : 0;
      const target = Math.max(0, 1 - d / (size * 1.6));
      q = i ? q + (target - q) * 0.35 : 0.6;
      pr = q;
    } else pr = st.np ? 0.5 : pressureCurve(p[i * 3 + 2]);
    let k = 0.5 - t * (0.5 - pr);
    if (style === 'brush') k = 0.5 * Math.sin(Math.PI / 2 * Math.min(1, k * 2)) + 0.02;
    r[i] = Math.max(size * 0.06, size * k);
  }
  return r;
}

// Brush: thin start and end (the end only once the line is finished).
function applyTapers(st, size, r, live) {
  if (st.ps !== 'brush' || st.t === 'hl') return;
  const p = st.p, n = r.length;
  const len = new Float64Array(n);
  for (let i = 1; i < n; i++) len[i] = len[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2]);
  const total = len[n - 1], ts = size * 1.5, te = live ? 0 : size * 2;
  for (let i = 0; i < n; i++) {
    let f = 1;
    if (ts > 0 && len[i] < ts) f = Math.min(f, 0.25 + 0.75 * (len[i] / ts));
    if (te > 0 && total - len[i] < te) f = Math.min(f, 0.2 + 0.8 * ((total - len[i]) / te));
    r[i] *= f;
  }
}

// Centripetal Catmull-Rom between sparse points, so a quick small curl comes
// out round instead of as a polygon. Returns [x, y, r] samples.
function beadPath(st, r) {
  const p = st.p, n = p.length / 3;
  const P = (i) => { i = Math.max(0, Math.min(n - 1, i)); return [p[i * 3], p[i * 3 + 1], r[i]]; };
  const out = [P(0)];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    // only where the line bends: how much the direction turns over this piece
    const cx = p2[0] - p1[0], cy = p2[1] - p1[1];
    const turn = Math.max(angleBetween(p1[0] - p0[0], p1[1] - p0[1], cx, cy), angleBetween(cx, cy, p3[0] - p2[0], p3[1] - p2[1]));
    // enough in-between points that each one turns by less than ~3.5°
    const step = Math.max(0.4, Math.min(p1[2], p2[2]) * 0.5);
    const m = turn < 0.03 ? 0 : Math.min(16, Math.floor(L / step), Math.ceil(turn / 0.06));
    for (let k = 1; k <= m; k++) {
      const t = k / (m + 1);
      out.push(catmull(p0, p1, p2, p3, t));
    }
    out.push(p2);
  }
  return out;
}

function angleBetween(ax, ay, bx, by) {
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 0; // at the ends: the neighbour decides
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
}

function catmull(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => { const w = tb - ta < 1e-9 ? 0 : (u - ta) / (tb - ta); return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]; };
  const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
  const C = lerp(B1, B2, t1, t2);
  return [C[0], C[1], p1[2] + (p2[2] - p1[2]) * t];
}

// Circle as 4 cubic arcs (exact and compact, also in the PDF).
function circlePiece(x, y, r) { return { circle: [x, y, r] }; }

function bandPiece(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
  if (d <= Math.abs(a[2] - b[2]) + 1e-6) return null; // one circle inside the other
  const ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
  const sn = (a[2] - b[2]) / d, k = Math.sqrt(Math.max(0, 1 - sn * sn));
  const pt = (c, sgn) => [c[0] + c[2] * (-ux * sn + nx * k * sgn), c[1] + c[2] * (-uy * sn + ny * k * sgn)];
  return ccw([pt(a, 1), pt(b, 1), pt(b, -1), pt(a, -1)]);
}

function beadOutline(st, factor = 1, live = false) {
  const size = st.s * factor;
  const r = strokeRadii(st, size);
  applyTapers(st, size, r, live);
  const raw = beadPath(st, r);
  // samples closer together than a fraction of their width add nothing
  const q = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const a = q[q.length - 1], b = raw[i];
    if (i < raw.length - 1 && Math.hypot(b[0] - a[0], b[1] - a[1]) < Math.max(0.12, Math.min(a[2], b[2]) * 0.2)) continue;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    q.push(b);
  }
  const flatEnds = st.t === 'hl'; // highlighter: square ends like a chisel tip
  const polys = [];
  if (q.length === 1) { polys.push(circlePiece(q[0][0], q[0][1], q[0][2])); polys.multi = true; return polys; }
  const n = q.length;
  const dir = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = q[i + 1][0] - q[i][0], dy = q[i + 1][1] - q[i][1], L = Math.hypot(dx, dy);
    dir.push([dx / L, dy / L]);
  }
  // Smooth stretches become one band each (left side forth, right side back);
  // at corners, and every ~60° of turning, a band ends and a round joint
  // (circle) connects it to the next – so the inside of a tight curve can
  // never fold over and leave a notch.
  // A stretch also ends where the line bends tighter than its own width or
  // the width changes faster than the line moves (the band's inner edge
  // would fold back there); such places are drawn as single beads.
  const len = (i) => Math.hypot(q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1]);
  const runs = [];
  let start = 0, cum = 0;
  for (let i = 1; i < n - 1; i++) {
    const t = Math.acos(Math.max(-1, Math.min(1, dir[i - 1][0] * dir[i][0] + dir[i - 1][1] * dir[i][1])));
    cum += t;
    const L = Math.min(len(i - 1), len(i));
    const tight = t * q[i][2] * 1.5 > L || Math.abs(q[i][2] - q[i - 1][2]) > 0.5 * len(i - 1) || Math.abs(q[i + 1][2] - q[i][2]) > 0.5 * len(i);
    if (t > 0.3 || cum > 1 || tight) { runs.push([start, i]); start = i; cum = 0; }
  }
  runs.push([start, n - 1]);
  const normal = (k, a, b) => {
    let dx, dy;
    if (k === a) [dx, dy] = dir[a];
    else if (k === b) [dx, dy] = dir[b - 1];
    else { dx = dir[k - 1][0] + dir[k][0]; dy = dir[k - 1][1] + dir[k][1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; }
    return [-dy, dx];
  };
  for (const [a, b] of runs) {
    const left = [], right = [];
    for (let k = a; k <= b; k++) {
      const [nx, ny] = normal(k, a, b), rr = q[k][2];
      left.push([q[k][0] + nx * rr, q[k][1] + ny * rr]);
      right.push([q[k][0] - nx * rr, q[k][1] - ny * rr]);
    }
    polys.push(ccw(left.concat(right.reverse())));
  }
  // round joints and ends
  const joints = new Set([0, n - 1, ...runs.map(([a]) => a)]);
  for (const k of [...joints].sort((x, y) => x - y)) {
    if (flatEnds && (k === 0 || k === n - 1)) continue;
    polys.push(circlePiece(q[k][0], q[k][1], q[k][2]));
  }
  if (flatEnds) {
    // square caps: extend the first and last stretch by half the width
    // (direction from a point at least half a width back: a tiny wiggle when
    // lifting must not turn the cap)
    const back = (k, step) => { let j = k + step; while (j > 0 && j < n - 1 && Math.hypot(q[j][0] - q[k][0], q[j][1] - q[k][1]) < q[k][2]) j += step; return q[j]; };
    const ext = (A, B) => { const dx = A[0] - B[0], dy = A[1] - B[1], L = Math.hypot(dx, dy) || 1; return [A[0] + (dx / L) * A[2] * 0.5, A[1] + (dy / L) * A[2] * 0.5, A[2]]; };
    const b1 = bandPiece(ext(q[0], back(0, 1)), q[0]), b2 = bandPiece(q[n - 1], ext(q[n - 1], back(n - 1, -1)));
    if (b1) polys.push(b1);
    if (b2) polys.push(b2);
  }
  polys.multi = true;
  return polys;
}

// Outline of the same stroke at a different size (neon core / halo).
const sizedCache = new WeakMap();
function getSizedOutline(st, factor) {
  let m = sizedCache.get(st);
  if (!m) { m = new Map(); sizedCache.set(st, m); }
  let o = m.get(factor);
  if (!o) {
    if (st.sh) o = shapeOutline(st, st.s * factor);
    else if (isDot(st)) o = dotOutline(st, factor);
    else o = beadOutline(st, factor);
    m.set(factor, o);
  }
  return o;
}

// Lighter version of a colour (neon core).
function lighten(hex, amount) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// ---- shapes: exact geometry instead of a freehand outline -----------------
// A shape is outlined as the union of one rectangle per segment and a round
// joint at every corner (and the ends), so corners and the closing point join
// cleanly. Returned as several polygons (marked .multi) that are filled
// together in one path with the non-zero rule (all wound the same way).

function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  // Closed outline (ends where it starts): split at the farthest point first,
  // otherwise the start-end "segment" has no length and everything is dropped.
  const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
  if (Math.hypot(sx - ex, sy - ey) < 1e-6) {
    let far = 1, fd = -1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - sx, pts[i][1] - sy); if (d > fd) { fd = d; far = i; } }
    if (fd <= 0) return [pts[0]];
    const a = simplify(pts.slice(0, far + 1), eps), b = simplify(pts.slice(far), eps);
    return a.concat(b.slice(1));
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; idx = i; }
    }
    if (best > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function ccw(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a < 0 ? poly.reverse() : poly;
}

function disc(cx, cy, r, n = 16) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  return ccw(out);
}

/** Is the shape stroke closed (ends where it starts)? */
function isClosedShape(st) {
  const p = st.p;
  if (!st.sh || p.length < 12) return false;
  return Math.hypot(p[0] - p[p.length - 3], p[1] - p[p.length - 2]) < Math.max(0.6, st.s * 0.3);
}

function shapeOutline(st, size = st.s) {
  const pts = simplify(strokePoints(st).map((q) => [q[0], q[1]]), 0.15);
  const r = size / 2;
  const polys = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-6) continue;
    const nx = (-(y1 - y0) / L) * r, ny = ((x1 - x0) / L) * r;
    polys.push(ccw([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]));
  }
  // Round joints: at both ends and wherever the direction turns noticeably.
  const n = Math.max(12, Math.min(32, Math.round(size * 3)));
  for (let i = 0; i < pts.length; i++) {
    const end = i === 0 || i === pts.length - 1;
    let turn = Math.PI;
    if (!end) {
      const a1 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      const a2 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
    }
    if (end || turn > 0.03) polys.push(disc(pts[i][0], pts[i][1], r, n));
  }
  if (!polys.length) polys.push(disc(pts[0][0], pts[0][1], r, n));
  polys.multi = true;
  return polys;
}

const outlineCache = new WeakMap();

// Outline polygon [[x,y], ...] in page units. Cached per stroke object;
// strokes are immutable (edits create new stroke objects).
// A tap (dot on an i, ä, full stop…): a round dot, also for tapered pens
// (the brush would otherwise taper it away to nothing).
function isDot(st) {
  if (st.sh || st.t === 'hl') return false;
  const p = st.p;
  let len = 0;
  for (let i = 3; i < p.length; i += 3) { len += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]); if (len > st.s * 0.6) return false; }
  return true;
}

function dotOutline(st, factor = 1) {
  const p = st.p, n = p.length / 3;
  let x = 0, y = 0;
  for (let i = 0; i < p.length; i += 3) { x += p[i]; y += p[i + 1]; }
  x /= n; y /= n;
  // the same width a line would have here (pen style, pressure curve); a
  // brush tap is a small dab like the start of a brush line
  const rs = strokeRadii(st, st.s * factor);
  let r = 0;
  for (const v of rs) r += v / rs.length;
  if (st.ps === 'brush') r *= 0.6;
  r = Math.max(0.25, r);
  const out = [];
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  return out;
}

function getOutline(st) {
  let o = outlineCache.get(st);
  if (!o) {
    o = st.sh ? shapeOutline(st) : isDot(st) ? dotOutline(st) : beadOutline(st);
    outlineCache.set(st, o);
  }
  return o;
}

// While drawing: the same pieces as the finished line (only the brush's end
// taper waits until the pen lifts).
function getLiveOutline(st) {
  if (st.sh) return shapeOutline(st);
  if (isDot(st)) return dotOutline(st);
  return beadOutline(st, 1, true);
}

// Emit the outline as a smooth closed path (quadratic curves through
// midpoints). `sink` has moveTo/quadraticCurveTo/lineTo/closePath, e.g. a
// Path2D. `map` optionally transforms points (used by the PDF export).
function traceOutline(outline, sink, map) {
  if (outline.multi) {
    for (const poly of outline) {
      if (poly.circle) { traceCircle(poly.circle, sink, map); continue; }
      const P = map ? poly.map((q) => map(q[0], q[1])) : poly;
      sink.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < P.length; i++) sink.lineTo(P[i][0], P[i][1]);
      sink.closePath();
    }
    return;
  }
  const n = outline.length;
  if (n === 0) return;
  const P = map ? outline.map((q) => map(q[0], q[1])) : outline;
  if (n < 4) {
    sink.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < n; i++) sink.lineTo(P[i][0], P[i][1]);
    sink.closePath();
    return;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  sink.moveTo(P[0][0], P[0][1]);
  let m = mid(P[1], P[2]);
  sink.quadraticCurveTo(P[1][0], P[1][1], m[0], m[1]);
  for (let i = 2; i < n - 1; i++) {
    m = mid(P[i], P[i + 1]);
    sink.quadraticCurveTo(P[i][0], P[i][1], m[0], m[1]);
  }
  sink.closePath();
}

// Circle (counter-clockwise like the other pieces) from 4 cubic arcs.
function traceCircle([cx, cy, r], sink, map) {
  const K = 0.5522847498 * r;
  const pts = [
    [cx + r, cy], [cx + r, cy + K], [cx + K, cy + r], [cx, cy + r],
    [cx - K, cy + r], [cx - r, cy + K], [cx - r, cy],
    [cx - r, cy - K], [cx - K, cy - r], [cx, cy - r],
    [cx + K, cy - r], [cx + r, cy - K], [cx + r, cy],
  ].map((q) => (map ? map(q[0], q[1]) : q));
  sink.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 3) sink.bezierCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 2][0], pts[i + 2][1]);
  sink.closePath();
}

// SVG path string (used with pdf-lib drawSvgPath).
function outlineToSvgPath(outline, map) {
  const parts = [];
  const f = (v) => (Math.round(v * 100) / 100).toString();
  traceOutline(outline, {
    moveTo: (x, y) => parts.push(`M${f(x)} ${f(y)}`),
    lineTo: (x, y) => parts.push(`L${f(x)} ${f(y)}`),
    quadraticCurveTo: (cx, cy, x, y) => parts.push(`Q${f(cx)} ${f(cy)} ${f(x)} ${f(y)}`),
    bezierCurveTo: (a, b, c, d, x, y) => parts.push(`C${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(x)} ${f(y)}`),
    closePath: () => parts.push('Z'),
  }, map);
  return parts.join(' ');
}

module.exports = { PEN_STYLES, strokeLook, getSizedOutline, lighten, strokePoints, pressureCurve, getOutline, getLiveOutline, traceOutline, outlineToSvgPath, HIGHLIGHTER_ALPHA, isClosedShape, shapeOutline };
