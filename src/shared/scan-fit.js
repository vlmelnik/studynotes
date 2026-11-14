'use strict';
// Fitting recognised lines to the ink of a photo: baseline band, shear,
// the line's own ink. Pure functions on ink masks: unit-tested.
// (moved unchanged from src/renderer/scan-geo.js)

/**
 * Upper and lower edge of the letters' body (the rows most letters cover)
 * along the line, as straight lines y = a + b·x (local pixels).
 */
function bandFit(ink, w, h) {
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
function shearOf(ink, w, h, xa = 0, xb = w) {
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

module.exports = { bandFit, shearOf, ownInk };
