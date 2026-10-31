// The real text of PDF pages: select it (copy, highlight, underline) with the
// select tool, and let the highlighter snap to text lines (like GoodNotes).
import { h, showMenu, toast } from './ui.js';
import { Util } from './pdfdoc.js';

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
  // runs → lines (same baseline), top to bottom, left to right
  runs.sort((a, b) => a.base - b.base || a.chars[0].x0 - b.chars[0].x0);
  const lines = [];
  for (const r of runs) {
    const tol = (r.y1 - r.y0) * 0.45, gap = (r.y1 - r.y0) * 2.5;
    // same baseline and close by (a wide gap = another column)
    let line = lines.find((l) => Math.abs(l.base - r.base) < tol && r.chars[0].x0 - l.chars[l.chars.length - 1].x1 < gap && r.chars[0].x0 > l.chars[0].x0 - gap);
    if (!line) { line = { base: r.base, y0: r.y0, y1: r.y1, chars: [] }; lines.push(line); }
    line.y0 = Math.min(line.y0, r.y0); line.y1 = Math.max(line.y1, r.y1);
    // a space between runs that don't touch
    const last = line.chars[line.chars.length - 1];
    if (last && r.chars[0].x0 - last.x1 > (r.y1 - r.y0) * 0.15 && last.ch !== ' ') line.chars.push({ ch: ' ', x0: last.x1, x1: r.chars[0].x0 });
    line.chars.push(...r.chars);
  }
  for (const l of lines) l.chars.sort((a, b) => a.x0 - b.x0);
  // reading order: columns left to right, inside a column top to bottom
  const colOf = (l) => Math.round(l.chars[0].x0 / 40);
  const cols = [...new Set(lines.map(colOf))];
  const twoCols = cols.length > 1 && lines.filter((l) => colOf(l) !== colOf(lines[0])).length > lines.length * 0.25;
  lines.sort((a, b) => (twoCols ? a.chars[0].x0 > (b.chars[b.chars.length - 1].x1) ? 1 : b.chars[0].x0 > a.chars[a.chars.length - 1].x1 ? -1 : 0 : 0) || a.base - b.base);
  return { lines };
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
