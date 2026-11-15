'use strict';
// A tall page is read in several bands at once (one recognition worker per
// band): where to cut it. Pure: unit-tested.

/**
 * Rows to cut a page at so that no line of text is cut: each cut lies in a
 * stretch of rows without ink that runs across the whole width, as close as
 * possible to an even split. im: { width, height, data } (RGBA, dark text on
 * light paper). Returns the bands as [[y0, y1], …] (one band = no cut: the
 * page is short, tilted – no empty rows across –, or `parts` is 1).
 */
function bandCuts(im, parts, { minBand = 500, minGap = 5 } = {}) {
  const W = im.width, H = im.height, d = im.data;
  const whole = [[0, H]];
  parts = Math.min(parts, Math.floor(H / minBand));
  if (!(parts >= 2)) return whole;
  // ink per row: pixels clearly darker than that row's paper (its light
  // pixels) – uneven light changes the paper from row to row. Every 2nd
  // pixel is enough.
  const empty = new Uint8Array(H);
  const hist = new Uint32Array(256);
  for (let y = 0; y < H; y++) {
    hist.fill(0);
    let n = 0;
    for (let x = 0, o = y * W * 4; x < W; x += 2, o += 8) { hist[(d[o] * 77 + d[o + 1] * 150 + d[o + 2] * 29) >> 8]++; n++; }
    // paper = the brightness 3/4 of the pixels stay below
    let acc = 0, paper = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.75) { paper = v; break; } }
    const dark = Math.max(0, Math.round(paper * 0.72));
    let ink = 0;
    for (let v = 0; v <= dark; v++) ink += hist[v];
    empty[y] = ink <= Math.max(1, n * 0.002) ? 1 : 0; // (a speck of dust is not a line)
  }
  // stretches of empty rows
  const gaps = [];
  for (let y = 0; y < H;) {
    if (!empty[y]) { y++; continue; }
    let e = y; while (e < H && empty[e]) e++;
    if (e - y >= minGap && y > 0 && e < H) gaps.push([y, e]);
    y = e;
  }
  const cuts = [];
  let prev = 0;
  for (let i = 1; i < parts; i++) {
    const want = (H * i) / parts, reach = (H / parts) * 0.35;
    let best = null;
    for (const [a, b] of gaps) {
      const mid = (a + b) >> 1;
      if (Math.abs(mid - want) > reach || mid - prev < minBand * 0.6 || H - mid < minBand * 0.6) continue;
      if (!best || Math.abs(mid - want) < Math.abs(best - want)) best = mid;
    }
    if (best !== null) { cuts.push(best); prev = best; }
  }
  if (!cuts.length) return whole;
  const ys = [0, ...cuts, H];
  return ys.slice(0, -1).map((y, i) => [y, ys[i + 1]]);
}

module.exports = { bandCuts };
