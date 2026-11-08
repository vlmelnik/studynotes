// "Match the document" for one recognised line: its perspective (the line as
// a quadrilateral: smaller far away, letters leaning) and its light (the ink
// colour along the line: glare, shadow). Both are measured the same way on the
// real ink and on the chosen font drawn flat, so the font's own shapes (an
// italic slant, capitals) cancel out.
import { homography, applyH } from '../shared/warp.js';
import { inkColor } from '../shared/scan-clean.js';

/**
 * Upper and lower edge of the letters' body (the rows most letters cover)
 * along the line, as straight lines y = a + b·x (local pixels).
 */
export function bandFit(ink, w, h) {
  // per column: first and last ink row (most columns belong to the letters'
  // body; ascenders and descenders are the minority)
  const colTop = new Int32Array(w).fill(-1), colBot = new Int32Array(w).fill(-1);
  let x0 = w, x1 = -1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) if (ink[y * w + x]) { if (colTop[x] < 0) colTop[x] = y; colBot[x] = y + 1; }
    if (colTop[x] >= 0) { if (x < x0) x0 = x; x1 = x; }
  }
  if (x1 - x0 < h) return null;
  const nSeg = Math.max(3, Math.min(14, Math.round((x1 - x0) / (h * 0.8))));
  const segs = [];
  const median = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  for (let s = 0; s < nSeg; s++) {
    const sa = Math.round(x0 + ((x1 - x0 + 1) * s) / nSeg), sb = Math.round(x0 + ((x1 - x0 + 1) * (s + 1)) / nSeg);
    const tops = [], bots = [];
    let sx = 0;
    for (let x = sa; x < sb; x++) if (colTop[x] >= 0) { tops.push(colTop[x]); bots.push(colBot[x]); sx += x; }
    if (tops.length < Math.max(3, (sb - sa) * 0.25)) continue;
    segs.push({ x: sx / tops.length, top: median(tops), bot: median(bots) });
  }
  if (segs.length < 3 || segs[segs.length - 1].x - segs[0].x < (x1 - x0) * 0.5) return null;
  // Theil–Sen: the median of the pairwise slopes, robust against odd segments
  const fit = (key) => {
    const sl = [];
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[j].x - segs[i].x > h * 0.5) sl.push((segs[j][key] - segs[i][key]) / (segs[j].x - segs[i].x));
    const b = sl.length ? median(sl) : 0;
    return { a: median(segs.map((g) => g[key] - b * g.x)), b };
  };
  return { top: fit('top'), bot: fit('bot'), x0, x1: x1 + 1, at: (l, x) => l.a + l.b * x };
}

/** Lean of the letters (dx per dy) in columns [xa, xb): the shear that makes the strokes most upright. */
export function shearOf(ink, w, h, xa = 0, xb = w) {
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = xa; x < xb; x++) if (ink[y * w + x]) pts.push(x, y);
  if (pts.length < 40) return 0;
  const yc = h / 2, W = xb - xa + h + 4;
  let best = 0, bestV = -1;
  for (let s = -0.4; s <= 0.4001; s += 0.02) {
    const col = new Float32Array(W);
    for (let i = 0; i < pts.length; i += 2) {
      const c = Math.round(pts[i] - xa - s * (pts[i + 1] - yc) + h / 2 + 2);
      if (c >= 0 && c < W) col[c]++;
    }
    let v = 0;
    for (let c = 0; c < W; c++) v += col[c] * col[c];
    if (v > bestV) { bestV = v; best = s; }
  }
  return best;
}

/** The line's own ink: the mask cut to the recognised line (neighbouring lines and marks out). */
function ownInk(li, line) {
  const h = line.bbox.y1 - line.bbox.y0;
  const xa = Math.max(0, Math.floor(line.bbox.x0 - li.box.x0 - 2)), xb = Math.min(li.w, Math.ceil(line.bbox.x1 - li.box.x0 + 2));
  const ya = Math.max(0, Math.floor(line.bbox.y0 - li.box.y0 - h * 0.12)), yb = Math.min(li.h, Math.ceil(line.bbox.y1 - li.box.y0 + h * 0.12));
  const m = new Uint8Array(li.w * li.h);
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) m[y * li.w + x] = li.ink[y * li.w + x];
  return m;
}

/** The candidate font drawn flat at its place in the line, as an ink mask. */
function renderMask(c, line, li, cssFont) {
  const cv = document.createElement('canvas');
  cv.width = li.w; cv.height = li.h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.font = cssFont(c, c.px);
  g.fillText(line.text.trim(), line.bbox.x0 - li.box.x0 + c.left, c.baseY - li.box.y0);
  const d = g.getImageData(0, 0, li.w, li.h).data;
  cv.width = cv.height = 0;
  const m = new Uint8Array(li.w * li.h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

/**
 * Measures one line for pageWarps: where the letters stand along it, how
 * their size changes and how much they lean, compared with the font drawn flat.
 * box: { x0, top } of the box in the straightened picture (pixels); S: pixels per page unit.
 */
export function lineWarp({ li, line, f, cssFont, box, S, bw, bh }) {
  const ink = ownInk(li, line);
  const mask = renderMask(f, line, li, cssFont);
  const real = bandFit(ink, li.w, li.h), flat = bandFit(mask, li.w, li.h);
  if (!real || !flat) return null;
  // the same pieces of the line in both (the same letters: their shapes cancel)
  const x0 = Math.max(real.x0, flat.x0), x1 = Math.min(real.x1, flat.x1), lh = flat.at(flat.bot, (x0 + x1) / 2) - flat.at(flat.top, (x0 + x1) / 2);
  if (!(lh > 3) || x1 - x0 < lh * 3) return null;
  const nSeg = Math.max(4, Math.min(14, Math.round((x1 - x0) / (lh * 1.2))));
  const median = (a) => { const c = a.slice().sort((p, q) => p - q); return c[c.length >> 1]; };
  const stats = (m, xa, xb) => {
    const tops = [], bots = [];
    for (let x = xa; x < xb; x++) {
      let t = -1, b = -1;
      for (let y = 0; y < li.h; y++) if (m[y * li.w + x]) { if (t < 0) t = y; b = y + 1; }
      if (t >= 0) { tops.push(t); bots.push(b); }
    }
    return tops.length >= Math.max(3, (xb - xa) * 0.25) ? { t: median(tops), b: median(bots) } : null;
  };
  // per piece: how much larger the real letters are (k) and where their foot is (off)
  const pts = [];
  for (let s = 0; s < nSeg; s++) {
    const xa = Math.round(x0 + ((x1 - x0) * s) / nSeg), xb = Math.round(x0 + ((x1 - x0) * (s + 1)) / nSeg);
    const r = stats(ink, xa, xb), fl = stats(mask, xa, xb);
    if (!r || !fl || fl.b - fl.t < lh * 0.4) continue;
    pts.push({ x: (xa + xb) / 2, k: (r.b - r.t) / (fl.b - fl.t), off: r.b - fl.b });
  }
  if (pts.length < 4 || pts[pts.length - 1].x - pts[0].x < (x1 - x0) * 0.5) return null;
  // Theil–Sen line off(x) (where the letters stand): robust against a few odd pieces
  const fit = (key) => {
    const sl = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) sl.push((pts[j][key] - pts[i][key]) / (pts[j].x - pts[i].x));
    const b = median(sl);
    return { a: median(pts.map((p) => p[key] - b * p.x)), b };
  };
  const O = fit('off'), at = (l, x) => l.a + l.b * x;
  // how the letters' size changes along the line (perspective): the slope of
  // ln k; the size itself stays the font's (a slightly different font is not
  // to be stretched)
  const lk = pts.map((p) => ({ x: p.x, v: Math.log(Math.max(0.2, p.k)) }));
  const sl = [];
  for (let i = 0; i < lk.length; i++) for (let j = i + 1; j < lk.length; j++) sl.push((lk[j].v - lk[i].v) / (lk[j].x - lk[i].x));
  const kMed = median(pts.map((p) => p.k));
  // lean on the left and right half, minus the font's own lean (italic)
  const mid = (x0 + x1) / 2;
  const sh = (m, xa, xb) => shearOf(m, li.w, li.h, Math.round(xa), Math.round(xb));
  const lean = (sh(ink, x0, x1) - sh(mask, x0, x1));
  const fT = flat.at(flat.top, mid), fB = flat.at(flat.bot, mid);
  // how unevenly the letters stand and how their size jumps from piece to
  // piece compared with the font (print: even; handwriting: uneven)
  const lnk = median(lk.map((p) => p.v));
  const jitter = median(pts.map((p, i) => Math.abs(lk[i].v - lnk) + Math.abs(p.off - at(O, p.x)) / Math.max(1, fB - fT)));
  return { li, box, bw, bh, x0, x1, mid, fT, fB, O, dlnk: median(sl), kMed, lean, jitter, n: pts.length, text: line.text };
}

/**
 * The perspective of every line, from all lines together: a page is one flat
 * plane, so the size change along the lines and the letters' lean are the
 * same everywhere – single lines are too noisy to say. ms: lineWarp results.
 * Returns per line { q, qw, qh } or null.
 */
export function pageWarps(ms, S) {
  const ok = ms.filter((m) => m && m.kMed > 0.7 && m.kMed < 1.45 && Math.abs(m.lean) < 0.3);
  const med = (a) => { const c = a.slice().sort((p, q) => p - q); return c.length ? c[c.length >> 1] : 0; };
  // weights by length: long lines say more about the size change
  const g = ok.length >= 2 ? med(ok.flatMap((m) => Array(Math.max(1, Math.round((m.x1 - m.x0) / 200))).fill(m.dlnk))) : 0;
  const lean = ok.length >= 2 ? med(ok.map((m) => m.lean)) : 0;
  if (window.__ocrDebug) window.__ocrDebug.page = { g, lean, n: ok.length };
  return ms.map((m) => {
    if (!m || !ok.includes(m)) return null;
    const at = (l, x) => l.a + l.b * x;
    const fh = m.fB - m.fT;
    const kL = Math.exp(g * (m.x0 - m.mid)), kR = Math.exp(g * (m.x1 - m.mid));
    if (kL / kR > 1.4 || kR / kL > 1.4) return null;
    const P = [[m.x0, m.fT], [m.x1, m.fT], [m.x1, m.fB], [m.x0, m.fB]];
    const bL = m.fB + at(m.O, m.x0), bR = m.fB + at(m.O, m.x1);
    const Q = [[m.x0 - lean * kL * fh, bL - kL * fh], [m.x1 - lean * kR * fh, bR - kR * fh], [m.x1, bR], [m.x0, bL]]; // (top = foot − lean · height)
    // flat enough: no perspective (the normal box and its tilt are right)
    const dev = Math.max(...P.map((p, k) => Math.hypot(p[0] - Q[k][0], p[1] - Q[k][1])));
    if (dev < fh * 0.1) return null;
    const { li, box, bw, bh } = m;
    const toPx = ([x, y]) => [x + li.box.x0, y + li.box.y0];
    const Hpx = homography(P.map(toPx), Q.map(toPx));
    if (!Hpx) return null;
    const qw = bw / S, qh = bh / S;
    const q = [];
    for (const [u, v] of [[0, 0], [qw, 0], [qw, qh], [0, qh]]) {
      const [X, Y] = applyH(Hpx, box.x0 + u * S, box.top + v * S);
      q.push(Math.round(((X - box.x0) / S) * 100) / 100, Math.round(((Y - box.top) / S) * 100) / 100);
    }
    return { q, qw: Math.round(qw * 100) / 100, qh: Math.round(qh * 100) / 100 };
  });
}

/**
 * Ink colour along the line (glare, shadow, a gradient on a sign) as stops
 * [[u, '#rrggbb']] (u = page units from the box's left), or null when it is
 * the same everywhere.
 */
export function lineLight({ li, line, img, box, S, fixColour = (c) => c }) {
  const own = ownInk(li, line);
  const real = bandFit(own, li.w, li.h);
  if (!real) return null;
  const n = Math.max(2, Math.min(8, Math.round((real.x1 - real.x0) / (li.h * 1.5))));
  const stops = [];
  for (let s = 0; s < n; s++) {
    const xa = Math.round(real.x0 + ((real.x1 - real.x0) * s) / n), xb = Math.round(real.x0 + ((real.x1 - real.x0) * (s + 1)) / n);
    const w = xb - xa;
    if (w < 2) continue;
    const ink = new Uint8Array(w * li.h);
    let cnt = 0;
    for (let y = 0; y < li.h; y++) for (let x = 0; x < w; x++) if ((ink[y * w + x] = own[y * li.w + xa + x])) cnt++;
    if (cnt < li.h) continue;
    const c = inkColor(img, { box: { x0: li.box.x0 + xa, y0: li.box.y0, x1: li.box.x0 + xb, y1: li.box.y1 }, w, h: li.h, ink, light: li.light });
    stops.push([(li.box.x0 + (xa + xb) / 2 - box.x0) / S, c]);
  }
  if (stops.length < 2) return null;
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  // a little smoothing: one odd segment is noise, not light
  const sm = stops.map(([u], k) => {
    const nb = [stops[k - 1], stops[k], stops[k + 1]].filter(Boolean).map((p) => rgb(p[1]));
    const avg = [0, 1, 2].map((i) => Math.round(nb.reduce((a, v) => a + v[i], 0) / nb.length));
    return [Math.round(u * 100) / 100, fixColour('#' + avg.map((v) => v.toString(16).padStart(2, '0')).join(''))];
  });
  const cs = sm.map((p) => rgb(p[1]));
  let spread = 0;
  for (const a of cs) for (const b of cs) spread = Math.max(spread, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  return spread >= 20 ? sm : null;
}
