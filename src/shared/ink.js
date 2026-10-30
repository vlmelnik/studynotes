'use strict';
// Stroke → filled outline. Shared by the renderer (canvas) and the PDF export
// so exported ink looks exactly like on screen.
//
// Stroke format (stored in pages/<id>.json):
//   { id, t: 'pen'|'hl', ps: 'ball'|'fountain', c: '#rrggbb', s: size,
//     np: 1 if input had no real pressure, sh: 1 for recognised shapes,
//     p: [x, y, pressure, x, y, pressure, ...] }   (page units = PDF points)

const { getStroke } = require('perfect-freehand');

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

function strokeOptions(st, last = true) {
  const size = st.s;
  if (st.sh) {
    return { size, thinning: 0, smoothing: 0, streamline: 0, simulatePressure: false, last };
  }
  if (st.t === 'hl') {
    return {
      size, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: false, last,
      start: { cap: false }, end: { cap: false },
    };
  }
  const hasPressure = !st.np;
  switch (st.ps) {
    case 'fountain':
      return { size, thinning: 0.65, smoothing: 0.6, streamline: 0.4, simulatePressure: !hasPressure, easing: (t) => t, last };
    case 'pencil':
      return { size, thinning: hasPressure ? 0.25 : 0.05, smoothing: 0.5, streamline: 0.35, simulatePressure: false, last };
    case 'marker':
      return { size, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last };
    case 'brush':
      return {
        size, thinning: 0.8, smoothing: 0.7, streamline: 0.5, simulatePressure: !hasPressure,
        easing: (t) => Math.sin((t * Math.PI) / 2), start: { taper: size * 1.5 }, end: { taper: size * 2 }, last,
      };
    case 'neon':
      return { size, thinning: 0, smoothing: 0.65, streamline: 0.5, simulatePressure: false, last };
    default:
      return { size, thinning: hasPressure ? 0.3 : 0, smoothing: 0.6, streamline: 0.4, simulatePressure: false, easing: (t) => t, last };
  }
}

// Outline of the same stroke at a different size (neon core / halo).
const sizedCache = new WeakMap();
function getSizedOutline(st, factor) {
  let m = sizedCache.get(st);
  if (!m) { m = new Map(); sizedCache.set(st, m); }
  let o = m.get(factor);
  if (!o) {
    if (st.sh) o = shapeOutline(st, st.s * factor);
    else {
      const pts = strokePoints(st);
      if (st.np) for (const q of pts) q[2] = 0.5;
      o = getStroke(pts, { ...strokeOptions(st, true), size: st.s * factor });
    }
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
function getOutline(st) {
  let o = outlineCache.get(st);
  if (!o && st.sh) { o = shapeOutline(st); outlineCache.set(st, o); }
  if (!o) {
    const pts = strokePoints(st);
    if (st.np && st.t !== 'hl') for (const q of pts) q[2] = 0.5;
    o = getStroke(pts, strokeOptions(st, true));
    outlineCache.set(st, o);
  }
  return o;
}

// While drawing: the end follows the pen exactly (last: true – the same as
// the finished stroke, so nothing jumps when the pen lifts) and the end taper
// is left out until then, so the tip doesn't "breathe" with every new point.
function getLiveOutline(st) {
  if (st.sh) return shapeOutline(st);
  const pts = strokePoints(st);
  if (st.np && st.t !== 'hl') for (const q of pts) q[2] = 0.5;
  const o = strokeOptions(st, true);
  if (o.end && o.end.taper) o.end = { ...o.end, taper: 0 };
  return getStroke(pts, o);
}

// Emit the outline as a smooth closed path (quadratic curves through
// midpoints). `sink` has moveTo/quadraticCurveTo/lineTo/closePath, e.g. a
// Path2D. `map` optionally transforms points (used by the PDF export).
function traceOutline(outline, sink, map) {
  if (outline.multi) {
    for (const poly of outline) {
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

// SVG path string (used with pdf-lib drawSvgPath).
function outlineToSvgPath(outline, map) {
  const parts = [];
  const f = (v) => (Math.round(v * 100) / 100).toString();
  traceOutline(outline, {
    moveTo: (x, y) => parts.push(`M${f(x)} ${f(y)}`),
    lineTo: (x, y) => parts.push(`L${f(x)} ${f(y)}`),
    quadraticCurveTo: (cx, cy, x, y) => parts.push(`Q${f(cx)} ${f(cy)} ${f(x)} ${f(y)}`),
    closePath: () => parts.push('Z'),
  }, map);
  return parts.join(' ');
}

module.exports = { PEN_STYLES, strokeLook, getSizedOutline, lighten, strokePoints, strokeOptions, getOutline, getLiveOutline, traceOutline, outlineToSvgPath, HIGHLIGHTER_ALPHA, isClosedShape, shapeOutline };
