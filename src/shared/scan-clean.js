'use strict';
// Image work for "Make text editable" on scans and photos: find the ink of a
// recognised text line, take its colour, and paint the paper back over it
// (no artefacts: the filled area gets the grain of the surrounding paper).
// img = { width, height, data: Uint8ClampedArray RGBA } (like ImageData).

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function clampBox(img, b) {
  return {
    x0: Math.max(0, Math.floor(b.x0)), y0: Math.max(0, Math.floor(b.y0)),
    x1: Math.min(img.width, Math.ceil(b.x1)), y1: Math.min(img.height, Math.ceil(b.y1)),
  };
}

// Otsu threshold of a luminance histogram.
function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}

/**
 * Ink pixels of one text line inside `box` (pixel coordinates).
 * Returns { box, w, h, ink: Uint8Array (1 = ink), light: bool (light text on dark) }.
 */
function lineInk(img, box) {
  const b = clampBox(img, box);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const ink = new Uint8Array(Math.max(0, w * h));
  if (w <= 0 || h <= 0) return { box: b, w, h, ink, light: false };
  const L = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum(img.data, ((b.y0 + y) * img.width + b.x0 + x) * 4);
      L[y * w + x] = v; hist[Math.min(255, Math.round(v))]++;
    }
  }
  const th = otsu(hist, w * h) + 0.5; // (the histogram uses rounded values)
  // the paper is what the border of the box mostly is
  let edge = 0, n = 0;
  for (let x = 0; x < w; x++) { edge += L[x] + L[(h - 1) * w + x]; n += 2; }
  for (let y = 0; y < h; y++) { edge += L[y * w] + L[y * w + w - 1]; n += 2; }
  // keep only clear ink (a margin from the threshold avoids paper noise)
  let lo = 0, hi = 0, nl = 0, nh = 0;
  for (let i = 0; i < L.length; i++) { if (L[i] <= th) { lo += L[i]; nl++; } else { hi += L[i]; nh++; } }
  // paper darker than the threshold: light text (and most of the box is
  // dark – a rule or frame along the border is no dark paper)
  const light = edge / n < th && nl > nh;
  const mLo = nl ? lo / nl : 0, mHi = nh ? hi / nh : 255;
  if (mHi - mLo < 25) return { box: b, w, h, ink, light }; // no contrast: nothing to clean
  for (let i = 0; i < L.length; i++) ink[i] = light ? (L[i] > th ? 1 : 0) : (L[i] <= th ? 1 : 0);
  // (th: the threshold used, to tell ink from paper around the box the same way)
  return { box: b, w, h, ink, light, th };
}

/** Typical colour of the ink (the darkest / strongest part of it). */
function inkColor(img, li) {
  const vals = [];
  const { box: b, w, h, ink } = li;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      const i = ((b.y0 + y) * img.width + b.x0 + x) * 4;
      vals.push([lum(img.data, i), img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  }
  if (!vals.length) return '#000000';
  vals.sort((a, c) => (li.light ? c[0] - a[0] : a[0] - c[0]));
  const part = vals.slice(0, Math.max(1, Math.floor(vals.length * 0.4)));
  const mid = (k) => { const s = part.map((v) => v[k]).sort((a, c) => a - c); return s[s.length >> 1]; };
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(mid(1))}${hex(mid(2))}${hex(mid(3))}`;
}

/** Grows a mask by r pixels (square). */
function dilate(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = mask[y * w + k];
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = tmp[k * w + x];
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Paints the paper back over masked pixels of `img` (in place). `fill` is a
 * mask over the whole image (1 = replace). Pixels are filled from the outside
 * in (each from its known neighbours), then given the grain of nearby paper.
 */
function inpaint(img, fill, seed = 1, avoid = null) {
  const { width: W, height: H, data: d } = img;
  const known = new Uint8Array(W * H);
  let todo = [];
  // (avoid: ink that stays – a rule, a neighbour's letters – and its soft
  // edge (4) are no paper to copy from)
  for (let i = 0; i < W * H; i++) { if (fill[i]) todo.push(i); else if (!(avoid && avoid[i])) known[i] = 1; }
  if (!todo.length) return;
  const filled = todo.slice();
  const nb = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
  let guard = 0, relaxed = avoid ? 0 : 2;
  while (todo.length && guard++ < 4000) {
    const next = [], set = [];
    for (const i of todo) {
      const x = i % W;
      let r = 0, g = 0, b = 0, n = 0;
      for (const o of nb) {
        const j = i + o;
        if (j < 0 || j >= W * H) continue;
        const xj = j % W;
        if (Math.abs(xj - x) > 1 || !known[j]) continue;
        r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
      }
      if (n) set.push([i, r / n, g / n, b / n]); else next.push(i);
    }
    if (!set.length) {
      // walled in by kept ink: first its edge, then its colour – better
      // than the old letters
      if (relaxed === 2) break;
      relaxed++;
      for (let i = 0; i < W * H; i++) if (avoid[i] && !fill[i] && (relaxed === 2 || avoid[i] === 4)) known[i] = 1;
      continue;
    }
    for (const [i, r, g, b] of set) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; known[i] = 1; }
    todo = next;
  }
  // grain: copy the small variations of paper pixels a few pixels away
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const R = 6;
  for (const i of filled) {
    const x = i % W, y = (i / W) | 0;
    for (let tries = 0; tries < 6; tries++) {
      const xx = x + Math.round((rnd() * 2 - 1) * R), yy = y + Math.round((rnd() * 2 - 1) * R);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (fill[j] || (avoid && avoid[j])) continue;
      // the source pixel's difference to its own neighbourhood mean
      let mr = 0, mg = 0, mb = 0, n = 0;
      for (const o of [-2, 2, -2 * W, 2 * W]) {
        const k = j + o;
        if (k < 0 || k >= W * H || fill[k] || (avoid && avoid[k])) continue;
        mr += d[k * 4]; mg += d[k * 4 + 1]; mb += d[k * 4 + 2]; n++;
      }
      if (!n) continue;
      d[i * 4] += d[j * 4] - mr / n; d[i * 4 + 1] += d[j * 4 + 1] - mg / n; d[i * 4 + 2] += d[j * 4 + 2] - mb / n;
      break;
    }
  }
}

/**
 * Straight runs of ink: pieces of at least `min` pixels in a row, joined
 * with the pieces of the next row they touch (a rule that is not quite level
 * is a staircase of such pieces). Returns groups { x0, x1, y0, y1 (ends
 * exclusive), runs: [y, xa, xb, …] }.
 */
function longRuns(ink, w, h, min) {
  const runs = [], rowAt = new Int32Array(h + 1), parent = [];
  for (let y = 0; y < h; y++) {
    rowAt[y] = runs.length / 3;
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      const xa = x;
      while (x < w && ink[y * w + x]) x++;
      if (x - xa >= min) { runs.push(y, xa, x); parent.push(parent.length); }
    }
  }
  rowAt[h] = runs.length / 3;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let y = 1; y < h; y++) {
    let p = rowAt[y - 1];
    for (let q = rowAt[y]; q < rowAt[y + 1]; q++) {
      while (p < rowAt[y] && runs[p * 3 + 2] < runs[q * 3 + 1]) p++;
      for (let k = p; k < rowAt[y] && runs[k * 3 + 1] <= runs[q * 3 + 2]; k++) {
        const a = find(k), b = find(q);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map();
  for (let k = 0; k < parent.length; k++) {
    const r = find(k), y = runs[k * 3], xa = runs[k * 3 + 1], xb = runs[k * 3 + 2];
    let g = groups.get(r);
    if (!g) { g = { x0: xa, x1: xb, y0: y, y1: y + 1, runs: [] }; groups.set(r, g); }
    if (xa < g.x0) g.x0 = xa; if (xb > g.x1) g.x1 = xb; if (y + 1 > g.y1) g.y1 = y + 1;
    g.runs.push(y, xa, xb);
  }
  return [...groups.values()];
}

/**
 * Ink that is no letter of the line: rules, table borders, frames. A level
 * run longer than any letter's stroke that goes on past the line's text, an
 * upright one that passes the line above and below. ink: mask of a window
 * around the line (w × h), bb: the line's box in the window's pixels,
 * far: how far past the text a level run must reach.
 */
function ruleMask(ink, w, h, bb, hgt, far = 2) {
  const rule = new Uint8Array(w * h);
  const min = Math.max(4, Math.round(hgt * 0.5));
  for (const g of longRuns(ink, w, h, min)) {
    if (g.x1 - g.x0 < hgt * 1.5 || !(g.x0 <= bb.x0 - far || g.x1 >= bb.x1 + far)) continue;
    for (let k = 0; k < g.runs.length; k += 3) rule.fill(1, g.runs[k] * w + g.runs[k + 1], g.runs[k] * w + g.runs[k + 2]);
  }
  // upright: the same on the turned mask
  const t = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = ink[y * w + x];
  for (const g of longRuns(t, h, w, min)) {
    if (g.x1 - g.x0 < hgt * 1.2 || g.x0 > bb.y0 - 2 || g.x1 < bb.y1 + 2) continue;
    for (let k = 0; k < g.runs.length; k += 3) for (let y = g.runs[k + 1]; y < g.runs[k + 2]; y++) rule[y * w + g.runs[k]] = 1;
  }
  return rule;
}

/**
 * The letters of a line among the ink around it (li: lineInk of the padded
 * box; rule: mask of the same size, ink that is no letter). The ink on the
 * recognised line and what hangs together with it; beside the line only a
 * lone dot (a full stop the reader missed) – not a neighbouring column.
 */
function letterInk(li, bbox, rule) {
  const { w, h, ink } = li;
  const hgt = bbox.y1 - bbox.y0;
  const xa = Math.max(0, Math.floor(bbox.x0 - li.box.x0 - 2)), xb = Math.min(w, Math.ceil(bbox.x1 - li.box.x0 + 2));
  const ya = Math.max(0, Math.floor(bbox.y0 - li.box.y0 - hgt * 0.12)), yb = Math.min(h, Math.ceil(bbox.y1 - li.box.y0 + hgt * 0.12));
  const own = new Uint8Array(w * h);
  const free = (i) => ink[i] && !rule[i] && !own[i];
  const stack = [];
  const flood = (i, onPix) => {
    own[i] = 1; stack.push(i);
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j / w) | 0;
      if (onPix) onPix(x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (free(k)) { own[k] = 1; stack.push(k); }
      }
    }
  };
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (free(y * w + x)) flood(y * w + x);
  // beside the line: one small mark alone on its side
  const dot = Math.max(3, hgt * 0.35);
  for (const [sa, sb] of [[0, xa], [xb, w]]) {
    const parts = [];
    for (let y = 0; y < h; y++) for (let x = sa; x < sb; x++) {
      if (!free(y * w + x)) continue;
      const c = { x0: x, x1: x, y0: y, y1: y, pix: [] };
      flood(y * w + x, (px, py) => { c.pix.push(py * w + px); if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px; if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py; });
      parts.push(c);
    }
    const c = parts[0];
    // (at the edge of the box it may go on outside: part of something bigger)
    const lone = parts.length === 1 && c.x1 - c.x0 < dot && c.y1 - c.y0 < dot && c.x0 > 0 && c.y0 > 0 && c.x1 < w - 1 && c.y1 < h - 1;
    if (!lone) for (const p of parts) for (const i of p.pix) own[i] = 0;
  }
  return own;
}

/**
 * Clears the given text lines from the image (in place): only the letters'
 * ink. Rules, table borders, frames and the ink of a neighbouring column
 * stay as they are (a letter on a rule goes, the rule stays whole).
 * lines: [{ bbox:{x0,y0,x1,y1}, under }] in pixels (under: the line's
 * underline is put on the text box – a short rule under it goes too).
 * Returns per line { color, light, inkBox }.
 */
function cleanLines(img, lines, maskImg = img) {
  const W = img.width, H = img.height;
  const fill = new Uint8Array(W * H), keep = new Uint8Array(W * H);
  const out = [];
  for (const l of lines) {
    const hgt = l.bbox.y1 - l.bbox.y0;
    const pad = Math.max(2, Math.round(hgt * 0.15));
    // ink found on the light-corrected picture, colours from the real one
    // (a little wider: a full stop the reader missed is cleaned too)
    const li = lineInk(maskImg, { x0: l.bbox.x0 - hgt * 0.4, y0: l.bbox.y0 - pad, x1: l.bbox.x1 + hgt * 0.5, y1: l.bbox.y1 + pad });
    if (li.th === undefined) { out.push({ color: inkColor(img, li), light: li.light }); continue; }
    // rules show in a wider window: they go on past the line
    const wb = clampBox(maskImg, { x0: l.bbox.x0 - hgt, y0: l.bbox.y0 - hgt, x1: l.bbox.x1 + hgt, y1: l.bbox.y1 + hgt });
    const ww = wb.x1 - wb.x0, wh = wb.y1 - wb.y0, ox = li.box.x0 - wb.x0, oy = li.box.y0 - wb.y0;
    const wide = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const v = lum(maskImg.data, ((wb.y0 + y) * maskImg.width + wb.x0 + x) * 4);
      wide[y * ww + x] = li.light ? (v > li.th ? 1 : 0) : (v <= li.th ? 1 : 0);
    }
    // (an underline that is put on the text box ends near the text)
    const wRule = ruleMask(wide, ww, wh, { x0: l.bbox.x0 - wb.x0, y0: l.bbox.y0 - wb.y0, x1: l.bbox.x1 - wb.x0, y1: l.bbox.y1 - wb.y0 }, hgt, l.under ? Math.max(2, hgt * 0.5) : 2);
    const rule = new Uint8Array(li.w * li.h);
    for (let y = 0; y < li.h; y++) for (let x = 0; x < li.w; x++) rule[y * li.w + x] = wRule[(y + oy) * ww + x + ox];
    const own = letterInk(li, l.bbox, rule);
    // (the colour from the letters, not from a border beside them)
    const color = inkColor(img, own.some(Boolean) ? { ...li, ink: own } : li);
    // anti-aliased edges and paper shadows next to the letters go too
    const r = Math.max(1, Math.round(hgt * 0.07));
    const grown = dilate(own, li.w, li.h, r);
    // what stays: rules (1), other ink (2) and the soft edge around both (4),
    // which is neither painted with a letter's edge nor copied as paper
    const stay = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x, lx = x - ox, ly = y - oy;
      const k = lx >= 0 && ly >= 0 && lx < li.w && ly < li.h ? ly * li.w + lx : -1;
      if (wide[i] && !(k >= 0 && own[k])) stay[i] = 1;
    }
    const edge = dilate(stay, ww, wh, r);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x, g = (wb.y0 + y) * W + wb.x0 + x, lx = x - ox, ly = y - oy;
      const k = lx >= 0 && ly >= 0 && lx < li.w && ly < li.h ? ly * li.w + lx : -1;
      if (k >= 0 && rule[k]) keep[g] |= 1; else if (stay[i]) keep[g] |= 2; else if (edge[i]) keep[g] |= 4;
      if (k >= 0 && !stay[i] && (own[k] || (grown[k] && !edge[i]))) fill[g] = 1;
    }
    out.push({ color, light: li.light });
  }
  // a rule is painted by no line; other ink one line leaves alone may be
  // the letters of another (the line above, the next column)
  for (let i = 0; i < W * H; i++) { if (keep[i] & 1) fill[i] = 0; else if (fill[i]) keep[i] = 0; }
  inpaint(img, fill, 1, keep);
  void H;
  out.fill = fill; // which pixels were painted over
  return out;
}

/**
 * Evens out the light of a photo: every pixel is divided by the brightness of
 * the paper around it (estimated from bright blocks), so shadows, gradients
 * and glare become plain white paper and the text stays dark. Returns a new
 * grey image (RGBA) of the same size.
 */
function normalizeLight(img, block = 32) {
  const { width: W, height: H, data: d } = img;
  // luminance, lightly smoothed (sensor noise, JPEG blocks)
  const L0 = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L0[i] = lum(d, i * 4);
  const L = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          s += L0[yy * W + xx] * (dx || dy ? 1 : 2); n += dx || dy ? 1 : 2;
        }
      }
      L[y * W + x] = s / n;
    }
  }
  // the paper's brightness per block = the bright part of the block
  const gw = Math.ceil(W / block), gh = Math.ceil(H / block);
  const grid = new Float32Array(gw * gh);
  const tmp = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      tmp.length = 0;
      for (let y = gy * block; y < Math.min(H, (gy + 1) * block); y += 2) for (let x = gx * block; x < Math.min(W, (gx + 1) * block); x += 2) tmp.push(L[y * W + x]);
      tmp.sort((p, q) => p - q);
      grid[gy * gw + gx] = tmp[Math.floor(tmp.length * 0.9)] || 255;
    }
  }
  // smooth it with a median of the neighbours (blocks full of text look dark,
  // and a hard edge – picture next to white paper – must not spread)
  let sm = grid;
  for (let pass = 0; pass < 2; pass++) {
    const src = sm, dst = new Float32Array(gw * gh), nb = [];
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        nb.length = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx, y = gy + dy;
          if (x >= 0 && y >= 0 && x < gw && y < gh) nb.push(src[y * gw + x]);
        }
        nb.sort((p, q) => p - q);
        // median of the neighbours: smooth, and a hard edge does not spread
        dst[gy * gw + gx] = nb[nb.length >> 1];
      }
    }
    sm = dst;
  }
  const N = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(gh - 1.001, Math.max(0, y / block - 0.5)), y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(gw - 1.001, Math.max(0, x / block - 0.5)), x0 = Math.floor(fx), tx = fx - x0;
      const g = (a, b) => sm[Math.min(gh - 1, b) * gw + Math.min(gw - 1, a)];
      const bg = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
      N[y * W + x] = Math.min(1.2, L[y * W + x] / Math.max(30, bg));
    }
  }
  // contrast: the darkest ink → black, the paper → white (faint photos)
  const hist = new Uint32Array(256);
  for (let i = 0; i < W * H; i++) hist[Math.min(255, Math.round(N[i] * 212))]++;
  let acc = 0, lo = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > W * H * 0.004) { lo = v / 212; break; } }
  const hi = 0.93, span = Math.max(0.15, hi - lo);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = Math.max(0, Math.min(1, (N[i] - lo) / span)) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  // was the light uneven at all? (scans and screenshots: no – then the
  // original is the better picture to read from)
  const bgs = Array.from(sm).sort((p, q) => p - q);
  const spread = bgs[Math.floor(bgs.length * 0.95)] - bgs[Math.floor(bgs.length * 0.05)];
  const uneven = spread > 28 || bgs[bgs.length >> 1] < 170;
  return { width: W, height: H, data: out, uneven };
}

module.exports = { lineInk, inkColor, dilate, inpaint, cleanLines, longRuns, ruleMask, letterInk, otsu, normalizeLight };
