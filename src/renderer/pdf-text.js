// The real text of PDF pages: select it (copy, highlight, underline) with the
// select tool, and let the highlighter snap to text lines (like GoodNotes).
import { h, showMenu, toast } from './ui.js';
import { Util } from './pdfdoc.js';
import { layoutFromOcr } from './ocr.js';
import { linesOf, charAt, spanBetween, highlightStrokes } from '../shared/pdf-text-layout.js';

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
