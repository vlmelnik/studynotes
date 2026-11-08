'use strict';
// Perspective of a text box ("Match the document"): a photo taken at an angle
// shows a line of text as a quadrilateral, not a rectangle. The text box keeps
// its normal, editable rectangle; t.q holds where its reference rectangle
// [0, qw] × [0, qh] (page units, box-local) lands: four corners
// [x0,y0, x1,y1, x2,y2, x3,y3] (top-left, top-right, bottom-right, bottom-left).
// A homography (3×3, h33 = 1) maps between the two; it extends beyond the
// reference rectangle, so longer text keeps the same perspective.

/** Homography that maps the 4 points src → dst ([[x,y] × 4]); null if degenerate. */
function homography(src, dst) {
  // 8 equations a·x + b·y + c − g·x·X − h·y·X = X (and the same for Y)
  const A = [], B = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = src[k], [X, Y] = dst[k];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); B.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); B.push(Y);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-12) return null;
    [A[i], A[p]] = [A[p], A[i]]; [B[i], B[p]] = [B[p], B[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      if (!f) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      B[r] -= f * B[i];
    }
  }
  const h = B.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** The box's homography (box-local page units → box-local page units), or null. */
function boxWarp(t) {
  const q = t && t.q;
  if (!Array.isArray(q) || q.length !== 8 || !(t.qw > 0) || !(t.qh > 0) || !q.every(Number.isFinite)) return null;
  const H = homography([[0, 0], [t.qw, 0], [t.qw, t.qh], [0, t.qh]], [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]);
  if (!H) return null;
  // a sane perspective only: corners must keep their order and stay near the box
  const span = Math.max(t.qw, t.qh);
  // (also where longer text or more lines reach: up to 2.5× as wide, 3× as high)
  for (const [x, y] of [[0, 0], [t.qw, 0], [t.qw, t.qh], [0, t.qh], [t.qw * 2.5, 0], [t.qw * 2.5, t.qh * 3], [0, t.qh * 3]]) {
    const w = H[6] * x + H[7] * y + 1;
    if (!(w > 0.2)) return null;
    const [X, Y] = applyH(H, x, y);
    if (Math.abs(X - x) > span * 4 || Math.abs(Y - y) > span * 4) return null;
  }
  return H;
}

/** CSS transform for a homography in the element's own pixels (origin top-left). */
function cssMatrix3d(H) {
  const f = (v) => +v.toFixed(6);
  return `matrix3d(${f(H[0])},${f(H[3])},0,${f(H[6])},${f(H[1])},${f(H[4])},0,${f(H[7])},0,0,1,0,${f(H[2])},${f(H[5])},0,${f(H[8])})`;
}

/** Colour along a line: stops [[u, '#rrggbb'], …] (u = page units from the box's left). */
function colourAt(stops, u) {
  if (!Array.isArray(stops) || !stops.length) return null;
  if (u <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (u <= stops[k][0]) {
      const [u0, c0] = stops[k - 1], [u1, c1] = stops[k];
      const f = u1 > u0 ? (u - u0) / (u1 - u0) : 0;
      const a = parseInt(c0.slice(1), 16), b = parseInt(c1.slice(1), 16);
      const ch = (s) => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f);
      return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
    }
  }
  return stops[stops.length - 1][1];
}

const validStops = (s) => Array.isArray(s) && s.length >= 2 && s.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && /^#[0-9a-f]{6}$/i.test(p[1]));

module.exports = { homography, applyH, boxWarp, cssMatrix3d, colourAt, validStops };
