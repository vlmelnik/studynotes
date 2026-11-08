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
  const light = edge / n < th; // paper darker than the threshold: light text
  // keep only clear ink (a margin from the threshold avoids paper noise)
  let lo = 0, hi = 0, nl = 0, nh = 0;
  for (let i = 0; i < L.length; i++) { if (L[i] <= th) { lo += L[i]; nl++; } else { hi += L[i]; nh++; } }
  const mLo = nl ? lo / nl : 0, mHi = nh ? hi / nh : 255;
  if (mHi - mLo < 25) return { box: b, w, h, ink, light }; // no contrast: nothing to clean
  for (let i = 0; i < L.length; i++) ink[i] = light ? (L[i] > th ? 1 : 0) : (L[i] <= th ? 1 : 0);
  return { box: b, w, h, ink, light };
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
function inpaint(img, fill, seed = 1) {
  const { width: W, height: H, data: d } = img;
  const known = new Uint8Array(W * H);
  let todo = [];
  for (let i = 0; i < W * H; i++) { if (fill[i]) todo.push(i); else known[i] = 1; }
  if (!todo.length) return;
  const filled = todo.slice();
  const nb = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
  let guard = 0;
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
    if (!set.length) break;
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
      if (fill[j]) continue;
      // the source pixel's difference to its own neighbourhood mean
      let mr = 0, mg = 0, mb = 0, n = 0;
      for (const o of [-2, 2, -2 * W, 2 * W]) {
        const k = j + o;
        if (k < 0 || k >= W * H || fill[k]) continue;
        mr += d[k * 4]; mg += d[k * 4 + 1]; mb += d[k * 4 + 2]; n++;
      }
      if (!n) continue;
      d[i * 4] += d[j * 4] - mr / n; d[i * 4 + 1] += d[j * 4 + 1] - mg / n; d[i * 4 + 2] += d[j * 4 + 2] - mb / n;
      break;
    }
  }
}

/**
 * Clears the given text lines from the image (in place).
 * lines: [{ bbox:{x0,y0,x1,y1} }] in pixels. Returns per line { color, light, inkBox }.
 */
function cleanLines(img, lines) {
  const W = img.width, H = img.height;
  const fill = new Uint8Array(W * H);
  const out = [];
  for (const l of lines) {
    const hgt = l.bbox.y1 - l.bbox.y0;
    const pad = Math.max(2, Math.round(hgt * 0.15));
    const li = lineInk(img, { x0: l.bbox.x0 - pad, y0: l.bbox.y0 - pad, x1: l.bbox.x1 + pad, y1: l.bbox.y1 + pad });
    const color = inkColor(img, li);
    // anti-aliased edges and paper shadows next to the letters go too
    const grown = dilate(li.ink, li.w, li.h, Math.max(1, Math.round(hgt * 0.07)));
    for (let y = 0; y < li.h; y++) for (let x = 0; x < li.w; x++) if (grown[y * li.w + x]) fill[(li.box.y0 + y) * W + li.box.x0 + x] = 1;
    out.push({ color, light: li.light });
  }
  inpaint(img, fill);
  void H;
  return out;
}

module.exports = { lineInk, inkColor, dilate, inpaint, cleanLines, otsu };
