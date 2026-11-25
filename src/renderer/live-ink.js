// "Handwriting becomes text" (live): write with the pen anywhere on the page,
// as big as you like; after a short pause the words are read and fly into
// the text line of the page – on the ruled lines, in the notes style – and
// the ink disappears. One Ctrl+Z brings the ink back. Off by default
// (⋯ menu or Ctrl+Shift+H).
import { toast } from './ui.js';
import { uid } from './tools.js';
import { layoutNotes, notesStyle } from '../shared/notes-layout.js';
import { FONTS, DEFAULT_FONT } from '../shared/fonts.js';

const PAUSE = 900; // ms without writing before a group is read

let canvas;
function measure(text, r) {
  canvas ||= document.createElement('canvas').getContext('2d');
  const f = FONTS[r.ff] || FONTS[DEFAULT_FONT];
  canvas.font = `${r.i ? 'italic ' : ''}${r.b ? '700' : '400'} ${r.fs || 15}px "${f.css}", "Segoe UI", sans-serif`;
  return canvas.measureText(text).width;
}

export class LiveInk {
  constructor(editor) {
    this.editor = editor;
    this.group = null; // { pageId, ids: [] }
    this.timer = null;
    this.targets = new Map(); // pageId -> text box id the words go into
    this.busy = Promise.resolve();
  }

  get on() { return !!this.editor.settings.liveInk; }

  toggle() {
    const s = this.editor.settings;
    s.liveInk = !s.liveInk;
    this.editor.app.saveSettings();
    toast(s.liveInk ? 'Handwriting becomes text: on – write anywhere, the words move into the line' : 'Handwriting becomes text: off', { timeout: 2500 });
    if (!s.liveInk) this.flush();
  }

  // a pen stroke was added
  stroke(pageId, st) {
    if (!this.on || st.t !== 'pen' || st.sh) return;
    const page = this.editor.pages.find((p) => p.id === pageId);
    if (!page || page.kind === 'board') return;
    if (this.group && this.group.pageId !== pageId) this.flush();
    this.group ||= { pageId, ids: [] };
    this.group.ids.push(st.id);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), PAUSE);
  }

  // a stroke is being written: wait with reading
  writing() { if (this.group) { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), PAUSE); } }

  flush() {
    clearTimeout(this.timer);
    const g = this.group;
    this.group = null;
    if (!g || !g.ids.length) return;
    this.busy = this.busy.then(() => this.convert(g)).catch((err) => toast(String(err.message || err), { error: true, timeout: 6000 }));
  }

  async convert(g) {
    const ed = this.editor;
    const data = ed.pageData(g.pageId);
    const strokes = data.strokes.filter((st) => g.ids.includes(st.id));
    if (!strokes.length) return;
    const res = ed.settings.inkEngine === 'google' ? await ed.readInkWithGoogle(strokes)
      : await window.api.inkRecognizeLive(strokes.map((st) => st.p.filter((_, i) => i % 3 !== 2)), ed.settings.inkRecognizer || '');
    const words = String(res.text || '').replace(/\s*\n\s*/g, ' ').trim();
    if (!words || ed.destroyed) return; // not text (a drawing): the ink stays
    const before = ed.pageData(g.pageId);
    const gone = new Set(strokes.map((st) => st.id));
    const after = { ...before, strokes: before.strokes.filter((st) => !gone.has(st.id)), texts: before.texts.slice() };
    const index = ed.pages.findIndex((p) => p.id === g.pageId);
    let box = after.texts.find((t) => t.id === this.targets.get(g.pageId));
    let from;
    if (box) {
      // the words go on in the same paragraph (the box wraps on the ruled lines)
      from = this.endOf(g.pageId, box);
      const sep = /\s$/.test(box.text || '') || !box.text ? '' : ' ';
      const i = after.texts.indexOf(box);
      box = { ...box, text: box.text + sep + words };
      if (box.html) box.html = box.html + (sep ? ' ' : '') + words.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      delete box.h; delete box.lines;
      after.texts[i] = box;
    } else {
      // a new paragraph on the next free line below what is on the page (without this ink)
      const style = notesStyle(ed.app.settings.notesStyle, ed.doc.nb.notesStyle);
      const r = layoutNotes([{ type: 'paragraph', text: words }], index, {
        pages: ed.pages, data: (id) => (id === g.pageId ? after : ed.pageData(id)), style, measure, newId: uid, place: 'below',
        newPage: (ref) => ({ id: 'none', kind: 'paper', paper: ref.paper, pc: ref.pc, w: ref.w, h: ref.h }),
      });
      const ch = r.changes.find((c) => c.pageId === g.pageId);
      if (!ch || r.added.length) return; // the page is full: leave the ink
      box = ch.after.texts[ch.after.texts.length - 1];
      box.h = undefined; box.lines = undefined;
      after.texts.push(box);
      this.targets.set(g.pageId, box.id);
      from = { x: box.x, y: box.y + box.fs };
    }
    await this.fly(g.pageId, strokes, from);
    ed.commit(g.pageId, before, after);
  }

  // where the next word goes: the end of the box's last line (page units)
  endOf(pageId, t) {
    const v = this.editor.viewer.viewById(pageId);
    const el = v && v.el.querySelector(`.textbox[data-id="${t.id}"]`);
    if (!el) return { x: t.x + 20, y: t.y + t.fs };
    const r = document.createRange();
    r.selectNodeContents(el); r.collapse(false);
    const c = r.getClientRects()[0] || el.getBoundingClientRect();
    const p = v.el.getBoundingClientRect();
    const k = this.editor.pages.find((q) => q.id === pageId).w / p.width;
    return { x: (c.right - p.left) * k + 4, y: (c.bottom - p.top) * k };
  }

  // the ink shrinks and moves to where the text goes, then fades
  async fly(pageId, strokes, to) {
    const v = this.editor.viewer.viewById(pageId);
    if (!v || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const page = this.editor.pages.find((q) => q.id === pageId);
    const rect = v.el.getBoundingClientRect();
    const k = rect.width / page.w;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of strokes) for (let i = 0; i + 1 < st.p.length; i += 3) { x0 = Math.min(x0, st.p[i]); x1 = Math.max(x1, st.p[i]); y0 = Math.min(y0, st.p[i + 1]); y1 = Math.max(y1, st.p[i + 1]); }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `${x0 - 4} ${y0 - 4} ${x1 - x0 + 8} ${y1 - y0 + 8}`);
    Object.assign(svg.style, { position: 'fixed', left: rect.left + (x0 - 4) * k + 'px', top: rect.top + (y0 - 4) * k + 'px', width: (x1 - x0 + 8) * k + 'px', height: (y1 - y0 + 8) * k + 'px', pointerEvents: 'none', zIndex: 50, transformOrigin: '0 0', overflow: 'visible' });
    for (const st of strokes) {
      const path = document.createElementNS(ns, 'path');
      let d = '';
      for (let i = 0; i + 1 < st.p.length; i += 3) d += `${i ? 'L' : 'M'}${st.p[i]} ${st.p[i + 1]}`;
      path.setAttribute('d', d);
      Object.assign(path.style, { fill: 'none', stroke: st.c || '#333', strokeWidth: st.w || 2, strokeLinecap: 'round', strokeLinejoin: 'round' });
      svg.append(path);
    }
    document.body.append(svg);
    // the ink is taken off the page at once (it lives on in the flying copy; the undo step comes after)
    const d = this.editor.pageData(pageId);
    const ids = new Set(strokes.map((st) => st.id));
    this.editor.setPageData(pageId, { ...d, strokes: d.strokes.filter((st) => !ids.has(st.id)) });
    const s = Math.max(0.15, Math.min(1, 16 / Math.max(8, y1 - y0)));
    const dx = (to.x - x0) * k, dy = (to.y - (y1 - y0) * s - y0) * k;
    await svg.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.15 }], { duration: 380, easing: 'cubic-bezier(.3,.7,.3,1)' }).finished.catch(() => {});
    svg.remove();
  }
}
