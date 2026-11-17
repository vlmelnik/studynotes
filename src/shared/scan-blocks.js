'use strict';
// "Make text editable": the blocks of text on a page, found in the picture
// before anything is read – a paragraph, a table cell, a heading, a column.
// Every block is then read on its own (side by side, one reader each), so a
// question and the answer beside it can never become one line, and the
// lines of one block belong together. Pure: unit-tested.

/** Connected areas of a 0/1 mask (4 neighbours) → Int32 labels (0: none), count. */
function label(mask, W, H) {
  const lab = new Int32Array(W * H);
  const parent = [0];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      if (!mask[i]) continue;
      const l = x && mask[i - 1] ? lab[i - 1] : 0, u = y && mask[i - W] ? lab[i - W] : 0;
      if (!l && !u) { parent.push(parent.length); lab[i] = parent.length - 1; }
      else if (l && u && l !== u) { const a = find(l), b = find(u); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); lab[i] = Math.min(a, b); }
      else lab[i] = l || u;
    }
  }
  // roots → 1..n
  const id = new Int32Array(parent.length);
  let n = 0;
  for (let i = 0; i < lab.length; i++) {
    if (!lab[i]) continue;
    const r = find(lab[i]);
    if (!id[r]) id[r] = ++n;
    lab[i] = id[r];
  }
  return { lab, n };
}

/** Boxes of labelled areas: [x0, y0, x1, y1] (inclusive) per label 1..n. */
function boxes(lab, W, H, n) {
  const b = new Int32Array((n + 1) * 4);
  for (let k = 1; k <= n; k++) { b[k * 4] = W; b[k * 4 + 1] = H; b[k * 4 + 2] = -1; b[k * 4 + 3] = -1; }
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const k = lab[i];
      if (!k) continue;
      if (x < b[k * 4]) b[k * 4] = x;
      if (y < b[k * 4 + 1]) b[k * 4 + 1] = y;
      if (x > b[k * 4 + 2]) b[k * 4 + 2] = x;
      if (y > b[k * 4 + 3]) b[k * 4 + 3] = y;
    }
  }
  return b;
}

/** Marks every run of at least `min` set pixels along rows (or columns). */
function longRuns(mask, W, H, min, down, out) {
  const A = down ? W : H, B = down ? H : W;
  for (let a = 0; a < A; a++) {
    for (let b = 0; b < B;) {
      const at = (q) => (down ? q * W + a : a * W + q);
      if (!mask[at(b)]) { b++; continue; }
      let e = b; while (e < B && mask[at(e)]) e++;
      if (e - b >= min) for (let q = b; q < e; q++) out[at(q)] = 1;
      b = e;
    }
  }
}

/** Grows a mask by rx to the left and right and by ry up and down. */
function smear(mask, W, H, rx, ry) {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let reach = -1; // set up to this x
    for (let x = 0; x < W; x++) if (mask[y * W + x]) { for (let q = Math.max(reach + 1, x - rx); q <= Math.min(W - 1, x + rx); q++) tmp[y * W + q] = 1; reach = Math.min(W - 1, x + rx); }
  }
  for (let x = 0; x < W; x++) {
    let reach = -1;
    for (let y = 0; y < H; y++) if (tmp[y * W + x]) { for (let q = Math.max(reach + 1, y - ry); q <= Math.min(H - 1, y + ry); q++) out[q * W + x] = 1; reach = Math.min(H - 1, y + ry); }
  }
  return out;
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/**
 * The blocks of text in a picture (dark text on light paper, evened light).
 * im: { width, height, data } RGBA. Returns [{ x0, y0, x1, y1, h, zone }] in the
 * picture's pixels (x1 / y1 exclusive), top to bottom, h: the typical height
 * of the block's letters, zone: the cell it stands in (blocks with different
 * zones have a border between them) – or null when the picture gives no usable blocks
 * (nothing found, or far too many pieces: read it as a whole then).
 *
 * How: ink that is not a long line (table borders, frames, underlines) is
 * smeared sideways by a letter's height and a little less up and down – letters
 * grow into words, words into lines, lines into paragraphs; the gap between
 * two columns or two paragraphs stays open, and borders cut. What hangs
 * together is one block. Large print (a title) is joined along its row by
 * its own letter height afterwards.
 */
function findBlocks(im, { maxSide = 1500, maxBlocks = 400 } = {}) {
  // a smaller mask is enough (and fast): a cell is ink when any pixel in it is
  const st = Math.max(1, Math.ceil(Math.max(im.width, im.height) / maxSide));
  const W = Math.ceil(im.width / st), H = Math.ceil(im.height / st), d = im.data;
  const low = new Uint8Array(W * H).fill(255);
  const hist = new Uint32Array(256);
  for (let y = 0; y < im.height; y++) {
    const row = Math.floor(y / st) * W;
    for (let x = 0, o = y * im.width * 4; x < im.width; x++, o += 4) {
      const v = (d[o] * 77 + d[o + 1] * 150 + d[o + 2] * 29) >> 8;
      const i = row + Math.floor(x / st);
      if (v < low[i]) low[i] = v;
      hist[v]++;
    }
  }
  // paper: the brightness 3/4 of the pixels stay below; ink is clearly darker
  let acc = 0, paper = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= im.width * im.height * 0.75) { paper = v; break; } }
  const dark = paper * 0.62;
  const ink = new Uint8Array(W * H);
  let nInk = 0;
  for (let i = 0; i < ink.length; i++) if (low[i] < dark) { ink[i] = 1; nInk++; }
  if (!nInk || nInk > ink.length * 0.5) return null;

  // letter height: the typical height of the pieces of ink
  // (not the long thin ones: borders, a line down the page)
  const heightsOf = (lab, n) => { const b = boxes(lab, W, H, n); const hs = []; for (let k = 1; k <= n; k++) { const h = b[k * 4 + 3] - b[k * 4 + 1] + 1, w = b[k * 4 + 2] - b[k * 4] + 1; if (h >= 3 && h <= w * 8 && w <= h * 12) hs.push(h); } return hs; };
  const first = label(ink, W, H);
  let h = median(heightsOf(first.lab, first.n));
  if (!h) return null;
  // long lines are no text: borders, frames, underlines, form lines
  const rules = new Uint8Array(W * H);
  longRuns(ink, W, H, Math.max(24, Math.round(h * 5)), false, rules);
  longRuns(ink, W, H, Math.max(16, Math.round(h * 3)), true, rules);
  const text = new Uint8Array(W * H);
  for (let i = 0; i < text.length; i++) text[i] = ink[i] && !rules[i] ? 1 : 0;
  const pieces = label(text, W, H);
  const pb = boxes(pieces.lab, W, H, pieces.n);
  h = median(heightsOf(pieces.lab, pieces.n)) || h;

  const rx = Math.max(1, Math.round(h * 1.0)), ry = Math.max(1, Math.round(h * 0.5));
  const sm = smear(text, W, H, rx, ry);
  for (let i = 0; i < sm.length; i++) if (rules[i]) sm[i] = 0;
  const areas = label(sm, W, H);
  if (!areas.n) return null;
  // every piece of ink belongs to the area it lies in; a block is the box of its pieces
  const blocks = Array.from({ length: areas.n + 1 }, () => ({ x0: W, y0: H, x1: -1, y1: -1, hs: [] }));
  for (let k = 1; k <= pieces.n; k++) {
    const x0 = pb[k * 4], y0 = pb[k * 4 + 1], x1 = pb[k * 4 + 2], y1 = pb[k * 4 + 3];
    // (any pixel of the piece: found on its top row)
    let a = 0;
    for (let x = x0; x <= x1 && !a; x++) if (pieces.lab[y0 * W + x] === k) a = areas.lab[y0 * W + x];
    if (!a) continue;
    const b = blocks[a];
    b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0); b.x1 = Math.max(b.x1, x1); b.y1 = Math.max(b.y1, y1);
    if (y1 - y0 + 1 >= 3) b.hs.push(y1 - y0 + 1);
  }
  let list = blocks.filter((b) => b.x1 >= 0 && b.hs.length).map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1 + 1, y1: b.y1 + 1, h: median(b.hs), n: b.hs.length }));
  // specks: smaller than half a letter
  list = list.filter((b) => b.y1 - b.y0 >= h * 0.5 && b.x1 - b.x0 >= h * 0.4);

  // large print: its words stand further apart than the smear reaches – join
  // neighbours in one row that are closer than their own letters are high
  // (not across a border)
  const ruleBetween = (a, b) => {
    const xa = Math.min(a.x1, b.x1), xb = Math.max(a.x0, b.x0), ya = Math.max(a.y0, b.y0), yb = Math.min(a.y1, b.y1);
    for (let x = xa; x < xb; x++) { let n = 0; for (let y = ya; y < yb; y++) if (rules[y * W + x]) n++; if (n >= (yb - ya) * 0.8) return true; }
    return false;
  };
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < list.length && !again; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i], b = list[j];
        if (b.x0 < a.x1) continue; // b right of a
        const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const hm = Math.min(a.h, b.h);
        if (hm < h * 1.5 || Math.max(a.h, b.h) > hm * 1.5) continue;
        if (ov < Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.6 || b.x0 - a.x1 > hm * 1.0 || ruleBetween(a, b)) continue;
        list[i] = { x0: a.x0, y0: Math.min(a.y0, b.y0), x1: b.x1, y1: Math.max(a.y1, b.y1), h: Math.max(a.h, b.h), n: a.n + b.n };
        list.splice(j, 1);
        again = true;
        break;
      }
    }
  }
  if (!list.length || list.length > maxBlocks) return null;
  // the cell a block stands in: borders divide the page into zones (the
  // cells of a table, the inside of a frame); an open line divides nothing
  const open = new Uint8Array(W * H);
  for (let i = 0; i < open.length; i++) open[i] = rules[i] ? 0 : 1;
  const zones = label(open, W, H);
  for (const b of list) {
    const cy = Math.min(H - 1, (b.y0 + b.y1) >> 1);
    let z = 0;
    for (let x = b.x0; x < b.x1 && !z; x++) z = zones.lab[cy * W + x];
    b.zone = z;
  }
  list.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return list.map((b) => ({ x0: b.x0 * st, y0: b.y0 * st, x1: Math.min(im.width, b.x1 * st), y1: Math.min(im.height, b.y1 * st), h: b.h * st, zone: b.zone }));
}

module.exports = { findBlocks, label, smear };
