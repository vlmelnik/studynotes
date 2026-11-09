// The real text of PDF pages: select it (copy, highlight, underline) with the
// select tool, and let the highlighter snap to text lines (like GoodNotes).
import { h, showMenu, toast } from './ui.js';
import { Util } from './pdfdoc.js';
import { layoutFromOcr } from './ocr.js';

const layouts = new WeakMap(); // page object → Promise<layout>
const ready = new WeakMap(); // page object → layout (once loaded)

/** The layout if it is already loaded (starts loading otherwise). */
export function peekLayout(editor, page) {
  if (!page || page.kind !== 'pdf') return null;
  if (ready.has(page)) return ready.get(page);
  textLayout(editor, page);
  return null;
}
let measureCtx = null;

/** Forget the text of a page (after OCR gave it one). */
export function forgetLayouts(pages) {
  for (const p of pages) { layouts.delete(p); ready.delete(p); }
}

/**
 * Characters of a PDF page with their boxes (page units), in reading order.
 * { lines: [{ y0, y1, chars: [{ ch, x0, x1 }] }] } – only horizontal text.
 */
export function textLayout(editor, page) {
  if (!page || page.kind !== 'pdf') return Promise.resolve(null);
  let p = layouts.get(page);
  if (!p) {
    p = build(editor, page).catch(() => null).then((l) => { ready.set(page, l); return l; });
    layouts.set(page, p);
  }
  return p;
}

async function build(editor, page) {
  const pdf = editor.doc.pdfs.get(page.src || 'main');
  if (!pdf) return null;
  const [tc, vp] = await Promise.all([pdf.textContent(page.pdfPage), pdf.viewport(page.pdfPage, 1, page.rot || 0)]);
  // a scan: the words found by OCR (only for pages that are not turned)
  if (!tc.items.some((it) => it.str && it.str.trim()) && !page.rot) {
    const o = editor.doc.ocr && editor.doc.ocr[page.src || 'main'];
    const l = layoutFromOcr(o && o.pages && o.pages[page.pdfPage]);
    if (l) return l;
  }
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const runs = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = Util.transform(vp.transform, it.transform);
    if (Math.abs(tx[1]) > 0.01 * Math.abs(tx[0]) || tx[0] <= 0) continue; // rotated text: not selectable (yet)
    const fh = Math.hypot(tx[2], tx[3]);
    const width = it.width * vp.scale;
    if (!(width > 0) || !(fh > 0)) continue;
    // character widths: measured with a similar font, scaled to the real width
    const style = tc.styles && tc.styles[it.fontName];
    measureCtx.font = `${fh}px ${style && style.fontFamily ? style.fontFamily : 'sans-serif'}`;
    const ws = [...it.str].map((ch) => measureCtx.measureText(ch).width || fh * 0.5);
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    let x = tx[4];
    const chars = [...it.str].map((ch, i) => {
      const w = (ws[i] / sum) * width;
      const c = { ch, x0: x, x1: x + w };
      x += w;
      return c;
    });
    runs.push({ base: tx[5], y0: tx[5] - fh * 0.88, y1: tx[5] + fh * 0.22, chars, eol: !!it.hasEOL });
  }
  return { lines: linesOf(runs) };
}

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
export function charAt(layout, x, y, near = false, reach = Infinity, col) {
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
export function spanBetween(layout, a, b) {
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
export function highlightStrokes(rects, color, uid) {
  return rects.map((r) => {
    const y = (r.y0 + r.y1) / 2, s = (r.y1 - r.y0) * 1.05;
    return { id: uid(), t: 'hl', c: color, s: Math.round(s * 100) / 100, p: [r.x0, y, 0.5, r.x1, y, 0.5].map((v) => Math.round(v * 100) / 100), np: 1, sh: 1 };
  });
}

export function underlineStrokes(rects, color, uid) {
  return rects.map((r) => {
    const y = r.y1 + 0.6;
    return { id: uid(), t: 'pen', c: color, s: 1.2, p: [r.x0, y, 0.5, r.x1, y, 0.5].map((v) => Math.round(v * 100) / 100), np: 1, sh: 1 };
  });
}

// ---------- select tool: dragging over PDF text ----------
export class TextSelection {
  constructor(tools, uid) {
    this.tools = tools;
    this.uid = uid;
    this.editor = tools.editor;
    this.layer = null;
  }

  // Synchronous: only when the page's text is already known.
  start(e, hit, view) {
    const layout = peekLayout(this.editor, hit.page);
    const at = charAt(layout, hit.x, hit.y);
    if (!at) return false;
    this.clear();
    this.cur = { layout, view, index: hit.index, page: hit.page, a: at, b: at };
    this.layer = h('div', { class: 'pdf-sel' });
    view.overlay.append(this.layer);
    return true;
  }

  move(x, y) {
    const c = this.cur;
    if (!c) return;
    const at = charAt(c.layout, x, y, true, Infinity, c.layout.lines[c.a.line] && c.layout.lines[c.a.line].col);
    if (at) { c.b = at; this.draw(); }
  }

  draw() {
    const c = this.cur;
    const z = this.editor.viewer.zoom;
    const { rects } = spanBetween(c.layout, c.a, c.b);
    this.layer.replaceChildren(...rects.map((r) => h('div', {
      class: 'pdf-sel-rect',
      style: { left: (r.x0 - c.view.ox) * z + 'px', top: (r.y0 - c.view.oy) * z + 'px', width: (r.x1 - r.x0) * z + 'px', height: (r.y1 - r.y0) * z + 'px' },
    })));
  }

  end(e) {
    const c = this.cur;
    if (!c) return;
    const span = spanBetween(c.layout, c.a, c.b);
    if (!span.text) { this.clear(); return; }
    this.span = span;
    const ed = this.editor;
    const ts = ed.toolState;
    const add = (strokes) => {
      const before = ed.pageData(c.page.id);
      ed.commit(c.page.id, before, { ...before, strokes: before.strokes.concat(strokes) });
      this.clear();
    };
    const m = showMenu([
      { label: 'Copy', icon: 'copy', onClick: () => { navigator.clipboard.writeText(span.text).catch(() => {}); toast('Copied', { timeout: 900 }); this.clear(); } },
      { label: 'Highlight', icon: 'highlighter', onClick: () => add(highlightStrokes(span.rects, ts.hl.color, this.uid)) },
      { label: 'Underline', icon: 'line', onClick: () => add(underlineStrokes(span.rects, ts.pen.color, this.uid)) },
    ], e.clientX + 6, e.clientY + 6);
    m.classList.add('pdf-sel-menu');
  }

  clear() {
    if (this.layer) this.layer.remove();
    this.layer = null;
    this.cur = null;
  }
}
