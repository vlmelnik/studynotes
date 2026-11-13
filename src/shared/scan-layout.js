'use strict';
// Page layout of recognised text: graphic marks next to text (logos),
// underlined words, and lines that belong together (paragraphs).
// Pure functions on pictures (RGBA ImageData-like) and boxes: unit-tested.

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * Solid graphic marks of a picture: connected areas of ink (dark or strongly
 * coloured) much taller than the text and filled – a logo's sign, a big
 * symbol. Thin lines (frames, charts, arrows) and text are not marks, and
 * neither is a dark label with text on it (the text lies inside it).
 * Returns their boxes [{ x0, y0, x1, y1 }] in pixels.
 */
function graphicMarks(img, textH) {
  const { width: W0, height: H0, data: d } = img;
  // (big pictures: on a mask 2–4× smaller – a sign is large anyway)
  const f = Math.max(1, Math.ceil(Math.sqrt((W0 * H0) / 2e6)));
  const W = Math.ceil(W0 / f), H = Math.ceil(H0 / f);
  textH /= f;
  // paper: the bright end of the picture
  const hist = new Uint32Array(256);
  for (let i = 0; i < W0 * H0; i += f) hist[Math.round(lum(d, i * 4))]++;
  let tot = 0;
  for (let v = 0; v < 256; v++) tot += hist[v];
  let acc = 0, paper = 255;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= tot * 0.3) { paper = v; break; } }
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H0; y++) {
    for (let x = 0; x < W0; x++) {
      const i = y * W0 + x, j = ((y / f) | 0) * W + ((x / f) | 0);
      if (ink[j]) continue;
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum(d, i * 4) < paper * 0.72 || sat > 70) ink[j] = 1;
    }
  }
  // connected areas (union-find over rows)
  const lab = new Int32Array(W * H).fill(-1);
  let parent = new Int32Array(1024), nLab = 0;
  const newLab = () => { if (nLab >= parent.length) { const p2 = new Int32Array(parent.length * 2); p2.set(parent); parent = p2; } parent[nLab] = nLab; return nLab++; };
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!ink[i]) continue;
      const up = y ? lab[i - W] : -1, left = x ? lab[i - 1] : -1;
      if (up < 0 && left < 0) lab[i] = newLab(); else if (up >= 0 && left >= 0) {
        const a = find(up), b = find(left);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        lab[i] = Math.min(a, b);
      } else lab[i] = up >= 0 ? up : left;
    }
  }
  const comps = new Map();
  for (let i = 0; i < W * H; i++) {
    if (lab[i] < 0) continue;
    const r = find(lab[i]);
    const x = i % W, y = (i / W) | 0;
    let c = comps.get(r);
    if (!c) { c = { x0: x, y0: y, x1: x, y1: y, n: 0 }; comps.set(r, c); }
    if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
    c.n++;
  }
  const out = [];
  for (const c of comps.values()) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    // (blocky: a bar beside a heading or quote is no sign)
    const big = bh >= textH * 1.6 && bw >= textH && Math.max(bw, bh) <= Math.min(bw, bh) * 4;
    const solid = c.n / (bw * bh) >= 0.3 && c.n >= textH * textH * 0.8;
    if (big && solid && bw * bh < W * H * 0.25) out.push({ x0: c.x0 * f, y0: c.y0 * f, x1: (c.x1 + 1) * f, y1: (c.y1 + 1) * f });
  }
  return out;
}

/**
 * A short line beside a graphic mark (a logo's name to the left or right of
 * its sign): kept as it is in the picture. Not: a paragraph flowing beside a
 * picture (long lines), lines above or below it, a line on it (a dark label).
 * words: how many words the line has.
 */
function besideMark(bbox, marks, textH, words = 1) {
  if (words > 4) return false;
  const reach = textH * 1.5;
  const cx = (bbox.x0 + bbox.x1) / 2, cy = (bbox.y0 + bbox.y1) / 2;
  return marks.some((m) => {
    const onIt = cx > m.x0 && cx < m.x1 && cy > m.y0 && cy < m.y1;
    const side = (bbox.x0 >= m.x1 - textH && bbox.x0 < m.x1 + reach) || (bbox.x1 <= m.x0 + textH && bbox.x1 > m.x0 - reach);
    // (or the sign was read as letters of the line: "T Ll dortmund")
    const mx = (m.x0 + m.x1) / 2, my = (m.y0 + m.y1) / 2;
    const holds = mx > bbox.x0 && mx < bbox.x1 && my > bbox.y0 - textH && my < bbox.y1 + textH;
    const level = cy > m.y0 - textH * 0.3 && cy < m.y1 + textH * 0.3;
    return (side || holds) && level && !onIt;
  });
}

/**
 * Underlined words: below the letters' baseline a row of ink runs along
 * (almost) the whole word – descenders (g, p, y) cover only bits of it.
 * li: a line's ink mask { w, h, ink, box: { x0, y0 } } reaching a little
 * below the line; words: [{ bbox }] in the same pixels; base: baseline y,
 * hgt: line height. Returns one flag per word.
 */
function underlinedWords(li, words, base, hgt, line = null) {
  const yA = Math.max(0, Math.round(base - li.box.y0 + 1)), yB = Math.min(li.h - 1, Math.round(base - li.box.y0 + hgt * 0.45));
  // a ruled line or table border runs on past the text: no underline.
  // (null: nothing to look at there – the selection ends at the text)
  if (line) {
    const span = (xa, xb) => {
      xa = Math.max(0, Math.round(xa - li.box.x0)); xb = Math.min(li.w, Math.round(xb - li.box.x0));
      if (xb - xa < 3) return null;
      for (let y = yA; y <= yB; y++) { let n = 0; for (let x = xa; x < xb; x++) n += li.ink[y * li.w + x]; if (n >= (xb - xa) * 0.6) return true; }
      return false;
    };
    const right = span(line.x1 + hgt * 0.5, line.x1 + hgt * 1.2), left = span(line.x0 - hgt * 1.2, line.x0 - hgt * 0.5);
    // a rule on either side, or no side to check at all: unsure, so no
    // underline (it is then kept in the picture rather than erased)
    if (right || left || (right === null && left === null)) return words.map(() => false);
  }
  return words.map((w) => {
    if (!w.bbox) return false;
    const xa = Math.max(0, Math.round(w.bbox.x0 - li.box.x0)), xb = Math.min(li.w, Math.round(w.bbox.x1 - li.box.x0));
    if (xb - xa < 3) return false;
    let rows = 0, last = -2, bands = 0;
    for (let y = yA; y <= yB; y++) {
      let n = 0;
      for (let x = xa; x < xb; x++) n += li.ink[y * li.w + x];
      if (n >= (xb - xa) * 0.85) { rows++; if (y !== last + 1) bands++; last = y; }
    }
    // one thin band (not a box frame or a filled block)
    return rows > 0 && bands === 1 && rows <= Math.max(2, hgt * 0.18);
  });
}

/**
 * Lines that belong together: one under the other at an even spacing, the
 * same font, size and colour, aligned on the left, the right or centred.
 * items: [{ x0, x1, cy, fs, ff, c, hand, warp }] (page units, cy: centre of
 * the line). Returns groups [{ idx: [line numbers top → bottom], al, pitch }];
 * a single line is a group of its own.
 */
function paragraphs(items) {
  const order = items.map((_, k) => k).sort((a, b) => items[a].cy - items[b].cy);
  const groups = [];
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const sameColour = (a, b) => {
    const p = parseInt(String(a).slice(1, 7), 16), q = parseInt(String(b).slice(1, 7), 16);
    if (Number.isNaN(p) || Number.isNaN(q)) return a === b;
    return Math.abs((p >> 16) - (q >> 16)) + Math.abs(((p >> 8) & 255) - ((q >> 8) & 255)) + Math.abs((p & 255) - (q & 255)) < 90;
  };
  for (const k of order) {
    const t = items[k];
    let joined = false;
    if (!t.hand && !t.warp) {
      for (const g of groups) {
        const last = items[g.idx[g.idx.length - 1]], first = items[g.idx[0]];
        if (last.hand || last.warp || last.ff !== t.ff || !near(last.fs, t.fs, t.fs * 0.08) || !sameColour(last.c, t.c)) continue;
        const pitch = t.cy - last.cy;
        if (pitch < t.fs * 0.95 || pitch > t.fs * 2.1) continue;
        if (g.pitch && !near(pitch, g.pitch, g.pitch * 0.12)) continue;
        // (one above the other)
        const ov = Math.min(last.x1, t.x1) - Math.max(last.x0, t.x0);
        if (ov < Math.min(last.x1 - last.x0, t.x1 - t.x0) * 0.3) continue;
        const tol = t.fs * 0.6;
        const left = near(t.x0, first.x0, tol), right = near(t.x1, first.x1, tol), centre = near((t.x0 + t.x1) / 2, (first.x0 + first.x1) / 2, tol);
        // the alignment found with the 2nd line must hold for the next ones
        // (a justified paragraph: left – its last line is shorter)
        const al = g.al ? (g.al === 'left' && left ? 'left' : g.al === 'right' && right ? 'right' : g.al === 'center' && centre ? 'center' : null)
          : left ? 'left' : centre ? 'center' : right ? 'right' : null;
        if (!al) continue;
        g.al = al; g.pitch = g.pitch || pitch; g.idx.push(k); joined = true;
        break;
      }
    }
    if (!joined) groups.push({ idx: [k], al: null, pitch: 0 });
  }
  return groups.map((g) => ({ idx: g.idx, al: g.al || 'left', pitch: g.pitch }));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r2 = (v) => Math.round(v * 100) / 100;
const LINE_H = 1.3;

/**
 * Several text boxes → one ("Combine"): boxes side by side become one line
 * (a space between), lines one under the other become the box's lines, in
 * their spacing. Style that differs from the first box stays per part (bold,
 * italic, underline, size, font, colour). Returns the new box (without id).
 */
function combineBoxes(texts) {
  if (!texts.length) return null;
  // the middle of a box's first line
  const cyOf = (t) => t.y + (t.fs * (t.lh || LINE_H)) / 2;
  const ts = texts.slice().sort((a, b) => cyOf(a) - cyOf(b) || a.x - b.x);
  // rows: boxes at about the same height
  const rows = [];
  for (const t of ts) {
    const row = rows.find((r) => Math.abs(cyOf(r[0]) - cyOf(t)) < Math.max(r[0].fs, t.fs) * 0.5 && String(t.text).indexOf('\n') < 0 && String(r[0].text).indexOf('\n') < 0);
    if (row) row.push(t); else rows.push([t]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  const first = rows[0][0];
  // bold / italic / underlined for the box when all parts are, else per part
  const base = { b: ts.every((t) => t.b), i: ts.every((t) => t.i), u: ts.every((t) => t.u), fs: first.fs, ff: first.ff, c: first.c };
  let rich = false;
  const part = (t) => {
    let x = t.html || esc(t.text || '');
    const span = [];
    if (Math.abs(t.fs - base.fs) > 0.05) span.push(`data-fs="${r2(t.fs)}"`);
    if (t.ff && t.ff !== base.ff && /^[a-z0-9-]+$/i.test(t.ff)) span.push(`data-ff="${t.ff}"`);
    if (t.c && /^#[0-9a-f]{6}$/i.test(t.c) && t.c.toLowerCase() !== String(base.c).toLowerCase()) span.push(`data-c="${t.c.toLowerCase()}"`);
    if (t.b && !base.b) x = `<b>${x}</b>`;
    if (t.i && !base.i) x = `<i>${x}</i>`;
    if (t.u && !base.u) x = `<u>${x}</u>`;
    if (span.length) x = `<span ${span.join(' ')}>${x}</span>`;
    if (x !== esc(t.text || '')) rich = true;
    return x;
  };
  const html = rows.map((r) => r.map(part).join(' ')).join('\n');
  const text = rows.map((r) => r.map((t) => t.text || '').join(' ')).join('\n');
  // spacing of the rows (when even), else the usual one
  const cys = rows.map((r) => cyOf(r[0]));
  // (from the last line of the row above: a box may have several lines)
  const lastCy = (r) => cyOf(r[0]) + (String(r[0].text || '').split('\n').length - 1) * r[0].fs * (r[0].lh || LINE_H);
  const gaps = cys.slice(1).map((c, k) => c - lastCy(rows[k]));
  let lh = first.lh || undefined;
  if (gaps.length) {
    const avg = gaps.reduce((a, g) => a + g, 0) / gaps.length;
    const even = gaps.every((g) => Math.abs(g - avg) < avg * 0.2);
    lh = even && avg / base.fs >= 1 && avg / base.fs <= 2.4 ? r2(avg / base.fs) : first.lh || undefined;
  }
  const x0 = Math.min(...ts.map((t) => t.x)), x1 = Math.max(...ts.map((t) => t.x + (t.w || 0)));
  const out = { ...first, x: r2(x0), w: r2(x1 - x0), text, lh, b: base.b || undefined, i: base.i || undefined, u: base.u || undefined };
  for (const key of ['b', 'i', 'u']) if (!out[key]) delete out[key];
  out.y = r2(cys[0] - (base.fs * (lh || LINE_H)) / 2);
  if (rich) out.html = html; else delete out.html;
  if (!lh) delete out.lh;
  // (one box: no per-line perspective / colour stops; a common tilt stays)
  for (const key of ['q', 'qw', 'qh', 'cg', 'h', 'lines']) delete out[key];
  if (!ts.every((t) => (t.r || 0) === (first.r || 0))) delete out.r;
  out.aw = ts.every((t) => t.aw) || undefined;
  if (!out.aw) delete out.aw;
  return out;
}

module.exports = { graphicMarks, besideMark, underlinedWords, paragraphs, combineBoxes };
