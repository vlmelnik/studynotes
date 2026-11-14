'use strict';
// Text of a PDF page (or of recognised scans) as lines and columns: runs
// joined into lines, column cuts, hit testing, spans, highlight strokes.
// Pure functions on text runs: unit-tested.
// (moved unchanged from src/renderer/pdf-text.js)

const sameBase = (l, r) => Math.abs(l.base - r.base) < (r.y1 - r.y0) * 0.45;

function joinRun(line, r, wide) {
  line.y0 = Math.min(line.y0, r.y0); line.y1 = Math.max(line.y1, r.y1);
  // a space between runs that don't touch (a tab across a wide gap: table cells)
  const last = line.chars[line.chars.length - 1];
  const gap = r.chars[0].x0 - last.x1;
  if (gap > (r.y1 - r.y0) * 0.15 && last.ch !== ' ') line.chars.push({ ch: gap > wide ? '\t' : ' ', x0: last.x1, x1: r.chars[0].x0 });
  line.chars.push(...r.chars);
}

/**
 * Text runs → lines in reading order. First the runs one word gap apart
 * become pieces of text (a PDF may write every word on its own); then
 * columns: a vertical strip that (almost) no piece crosses, with running
 * text on both sides – text of different columns never joins into one line
 * and is read one column after the other. Pieces on the same baseline in a
 * column are one line (table cells: one row).
 */
function linesOf(runs) {
  runs.sort((a, b) => a.base - b.base || a.chars[0].x0 - b.chars[0].x0);
  const pieces = [];
  for (const r of runs) {
    // (a word space, even in justified text – narrower than a column gap)
    const word = (r.y1 - r.y0) * 0.55;
    const p = pieces.find((l) => sameBase(l, r) && r.chars[0].x0 > l.chars[0].x0 && Math.abs(r.chars[0].x0 - l.chars[l.chars.length - 1].x1) < word);
    if (p) joinRun(p, r, Infinity);
    else pieces.push({ base: r.base, y0: r.y0, y1: r.y1, chars: r.chars.slice() });
  }
  for (const p of pieces) p.chars.sort((a, b) => a.x0 - b.x0);
  const cuts = columnCuts(pieces);
  const colOf = (r) => { const m = (r.chars[0].x0 + r.chars[r.chars.length - 1].x1) / 2; let c = 0; while (c < cuts.length && m > cuts[c]) c++; return c; };
  pieces.sort((a, b) => a.base - b.base || a.chars[0].x0 - b.chars[0].x0);
  const lines = [];
  for (const r of pieces) {
    const col = colOf(r);
    const line = lines.find((l) => l.col === col && sameBase(l, r));
    if (line) joinRun(line, r, (r.y1 - r.y0) * 1.2);
    else lines.push({ col, base: r.base, y0: r.y0, y1: r.y1, chars: r.chars.slice() });
  }
  for (const l of lines) l.chars.sort((a, b) => a.x0 - b.x0);
  // reading order: column by column, top to bottom inside a column
  lines.sort((a, b) => a.col - b.col || a.base - b.base);
  return lines;
}

/**
 * Columns of running text are filled: most lines on each side of the gap
 * reach across most of that side. Table cells (short pieces) are not columns
 * of text – their rows are read across.
 */
function filled(pieces, mid) {
  const side = (left) => {
    const ps = pieces.filter((r) => ((r.chars[0].x0 + r.chars[r.chars.length - 1].x1) / 2 < mid) === left);
    let a = Infinity, b = -Infinity;
    for (const r of ps) { a = Math.min(a, r.chars[0].x0); b = Math.max(b, r.chars[r.chars.length - 1].x1); }
    const ws = ps.map((r) => r.chars[r.chars.length - 1].x1 - r.chars[0].x0).sort((p, q) => p - q);
    return ws.length && ws[ws.length >> 1] >= (b - a) * 0.5;
  };
  return side(true) && side(false);
}

/**
 * x positions that separate the columns of a page: gaps of at least ~6 units
 * that at most a few lines cross, with a good share of the text on each side.
 */
function columnCuts(runs) {
  if (runs.length < 12) return [];
  let min = Infinity, max = -Infinity;
  for (const r of runs) { min = Math.min(min, r.chars[0].x0); max = Math.max(max, r.chars[r.chars.length - 1].x1); }
  const W = Math.ceil(max - min);
  if (W < 200) return [];
  const cross = new Int32Array(W + 2);
  for (const r of runs) {
    const a = Math.max(0, Math.floor(r.chars[0].x0 - min)), b = Math.min(W, Math.ceil(r.chars[r.chars.length - 1].x1 - min));
    for (let x = a; x <= b; x++) cross[x]++;
  }
  const limit = Math.max(2, Math.round(runs.length * 0.04));
  const cuts = [];
  for (let x = Math.round(W * 0.12); x < W * 0.88;) {
    if (cross[x] > limit) { x++; continue; }
    let e = x;
    while (e < W * 0.88 && cross[e + 1] <= limit) e++;
    const mid = min + (x + e) / 2;
    let left = 0, right = 0;
    for (const r of runs) { const m = (r.chars[0].x0 + r.chars[r.chars.length - 1].x1) / 2; if (m < mid) left++; else right++; }
    if (e - x >= 6 && left >= runs.length * 0.15 && right >= runs.length * 0.15 && filled(runs, mid)) cuts.push(mid);
    x = e + 1;
  }
  return cuts;
}

/**
 * Position {line, ch} of the character under (x, y), or null. While dragging
 * (`near`) the closest line counts, as in a text editor: next to a line's end
 * → its end, left of its start → its start, between two lines → the nearer one.
 * `reach`: how far off (in line heights) a line still counts; `col`: the
 * column the selection started in.
 */
function charAt(layout, x, y, near = false, reach = Infinity, col) {
  if (!layout) return null;
  let best = null;
  layout.lines.forEach((l, li) => {
    const hgt = l.y1 - l.y0;
    const first = l.chars[0], last = l.chars[l.chars.length - 1];
    let d;
    if (near) {
      // how far the point is from the line (0 inside it); off to the side
      // counts less than above / below, a line of another column far away not at all
      const dy = y < l.y0 ? l.y0 - y : y > l.y1 ? y - l.y1 : 0;
      const dx = x < first.x0 ? first.x0 - x : x > last.x1 ? x - last.x1 : 0;
      if (dy && dx > Math.max(60, hgt * 6)) return;
      // (beside a line, at its height, that line: its end / start – but a
      // line of another column only when the pointer is on it)
      const other = col !== undefined && l.col !== undefined && l.col !== col;
      d = other ? (dy || dx ? dy + dx * 0.25 + hgt * 2 : hgt * 0.5) : dy ? dy + dx * 0.25 + hgt : dx * 1e-3;
      if (dy > hgt * reach || dx > hgt * Math.max(1, reach)) return;
    } else {
      const pad = hgt * 0.15;
      if (y < l.y0 - pad || y > l.y1 + pad || x < first.x0 - 4 || x > last.x1 + 4) return;
      d = Math.abs((l.y0 + l.y1) / 2 - y);
    }
    let ci = l.chars.findIndex((c) => x < (c.x0 + c.x1) / 2);
    if (ci < 0) ci = l.chars.length;
    if (!best || d < best.d) best = { line: li, ch: ci, d };
  });
  return best && { line: best.line, ch: best.ch };
}

const before = (a, b) => a.line < b.line || (a.line === b.line && a.ch <= b.ch);

/** Rectangles (one per line) and text between two positions. */
function spanBetween(layout, a, b) {
  if (!layout || !a || !b) return { rects: [], text: '' };
  const [s, e] = before(a, b) ? [a, b] : [b, a];
  const rects = [];
  let text = '';
  for (let li = s.line; li <= e.line; li++) {
    const l = layout.lines[li];
    const from = li === s.line ? s.ch : 0;
    const to = li === e.line ? e.ch : l.chars.length;
    if (to <= from) { if (li < e.line) text += '\n'; continue; }
    const cs = l.chars.slice(from, to);
    // one rectangle per piece (the wide gap between table cells stays clear)
    let seg = [];
    for (const c of cs.concat([{ ch: '\t' }])) {
      if (c.ch !== '\t') { seg.push(c); continue; }
      while (seg.length && seg[seg.length - 1].ch === ' ') seg.pop();
      while (seg.length && seg[0].ch === ' ') seg.shift();
      if (seg.length) rects.push({ x0: seg[0].x0, x1: seg[seg.length - 1].x1, y0: l.y0, y1: l.y1 });
      seg = [];
    }
    text += cs.map((c) => c.ch).join('');
    if (li < e.line) text += '\n';
  }
  return { rects, text: text.replace(/[ \t]+\n/g, '\n').trim() };
}

/** Highlighter strokes (straight, line height) covering the rectangles. */
function highlightStrokes(rects, color, uid) {
  return rects.map((r) => {
    const y = (r.y0 + r.y1) / 2, s = (r.y1 - r.y0) * 1.05;
    return { id: uid(), t: 'hl', c: color, s: Math.round(s * 100) / 100, p: [r.x0, y, 0.5, r.x1, y, 0.5].map((v) => Math.round(v * 100) / 100), np: 1, sh: 1 };
  });
}

module.exports = { sameBase, joinRun, linesOf, filled, columnCuts, before, charAt, spanBetween, highlightStrokes };
