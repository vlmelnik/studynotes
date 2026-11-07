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
  // Columns: a vertical strip that (almost) no line crosses, with text on both
  // sides. Text of different columns never joins into one line, and is read
  // one column after the other.
  const cuts = columnCuts(runs);
  const colOf = (r) => { const m = (r.chars[0].x0 + r.chars[r.chars.length - 1].x1) / 2; let c = 0; while (c < cuts.length && m > cuts[c]) c++; return c; };
  runs.sort((a, b) => a.base - b.base || a.chars[0].x0 - b.chars[0].x0);
  const lines = [];
  for (const r of runs) {
    const col = colOf(r);
    const tol = (r.y1 - r.y0) * 0.45, gap = (r.y1 - r.y0) * 2.5;
    // same column, same baseline and close by
    let line = lines.find((l) => l.col === col && Math.abs(l.base - r.base) < tol && r.chars[0].x0 - l.chars[l.chars.length - 1].x1 < gap && r.chars[0].x0 > l.chars[0].x0 - gap);
    if (!line) { line = { col, base: r.base, y0: r.y0, y1: r.y1, chars: [] }; lines.push(line); }
    line.y0 = Math.min(line.y0, r.y0); line.y1 = Math.max(line.y1, r.y1);
    // a space between runs that don't touch
    const last = line.chars[line.chars.length - 1];
    if (last && r.chars[0].x0 - last.x1 > (r.y1 - r.y0) * 0.15 && last.ch !== ' ') line.chars.push({ ch: ' ', x0: last.x1, x1: r.chars[0].x0 });
    line.chars.push(...r.chars);
  }
  for (const l of lines) l.chars.sort((a, b) => a.x0 - b.x0);
  // reading order: column by column, top to bottom inside a column
  lines.sort((a, b) => a.col - b.col || a.base - b.base);
  return { lines };
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
    if (e - x >= 6 && left >= runs.length * 0.15 && right >= runs.length * 0.15) cuts.push(mid);
    x = e + 1;
  }
  return cuts;
}

/** Position {line, ch} of the character under (x, y), or null. */
export function charAt(layout, x, y, near = false) {
  if (!layout) return null;
  let best = null;
  layout.lines.forEach((l, li) => {
    const pad = (l.y1 - l.y0) * (near ? 0.6 : 0.15);
    if (y < l.y0 - pad || y > l.y1 + pad) return;
    const first = l.chars[0], last = l.chars[l.chars.length - 1];
    const tolX = near ? (l.y1 - l.y0) : 4;
    if (x < first.x0 - tolX || x > last.x1 + tolX) return;
    let ci = l.chars.findIndex((c) => x < (c.x0 + c.x1) / 2);
    if (ci < 0) ci = l.chars.length;
    const dy = Math.abs((l.y0 + l.y1) / 2 - y);
    if (!best || dy < best.dy) best = { line: li, ch: ci, dy };
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
    rects.push({ x0: cs[0].x0, x1: cs[cs.length - 1].x1, y0: l.y0, y1: l.y1 });
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
    const at = charAt(c.layout, x, y, true);
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
