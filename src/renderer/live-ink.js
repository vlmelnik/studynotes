// "Handwriting becomes text" (live): write with the pen anywhere on the page,
// as big as you like; after a short pause the words are read and appear in
// the text line of the page – on the ruled lines, in the notes style – as if
// typed (they come out of a blur), and the ink blurs away. One Ctrl+Z brings
// the ink back. Off by default (⋯ menu or Ctrl+Shift+H).
//
// When is a group read? While the pen hovers over the page (between letters,
// over an i-dot) it waits longer, so a word with a pause in it stays one
// word; when the pen leaves the screen it is read at once.
import { toast } from './ui.js';
import { uid } from './tools.js';
import { layoutNotes, notesStyle } from '../shared/notes-layout.js';
import { FONTS, DEFAULT_FONT } from '../shared/fonts.js';

const PAUSE = 800; // ms without writing before a group is read (mouse, or the pen away)
const HOVER = 1500; // the pen still hovers over the page: the word may go on
const AWAY = 120; // the pen left the screen
const MAX = 4000; // never wait longer than this after the last stroke

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
    // the pen hovering / leaving (pointer events of the page area)
    const sc = editor.viewer && editor.viewer.scroller;
    if (sc) {
      sc.addEventListener('pointermove', (e) => { if (e.pointerType === 'pen' && !e.buttons) this.hover(); }, { passive: true });
      sc.addEventListener('pointerleave', (e) => { if (e.pointerType === 'pen') this.wait(AWAY); });
    }
  }

  wait(ms) {
    if (!this.group) return;
    clearTimeout(this.timer);
    const left = MAX - (Date.now() - this.group.last);
    this.timer = setTimeout(() => this.flush(), Math.max(0, Math.min(ms, left)));
  }

  hover() { if (this.group && Date.now() - this.hoverAt > 100) { this.hoverAt = Date.now(); this.wait(HOVER); } }

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
    this.group.last = Date.now();
    this.hoverAt = 0;
    this.wait(PAUSE);
  }

  // a stroke is being written: wait with reading
  writing() { if (this.group) { clearTimeout(this.timer); this.group.last = Date.now(); } }

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
    const pts = strokes.map((st) => st.p.filter((_, i) => i % 3 !== 2));
    // Google reads the strokes themselves (fast); the words written just before go along as context
    const prev = data.texts.find((t) => t.id === this.targets.get(g.pageId));
    // (Google unless Windows was chosen: the Windows recognizer reads live writing badly)
    const res = ed.settings.inkEngine !== 'windows'
      ? await window.api.inkGoogle(pts, { lang: ed.settings.inkLang || 'de', pre: prev ? prev.text : '' })
      : await window.api.inkRecognizeLive(pts, ed.settings.inkRecognizer || '');
    const words = String(res.text || '').replace(/\s*\n\s*/g, ' ').trim();
    if (!words || ed.destroyed) return; // not text (a drawing): the ink stays
    const before = ed.pageData(g.pageId);
    const gone = new Set(strokes.map((st) => st.id));
    const after = { ...before, strokes: before.strokes.filter((st) => !gone.has(st.id)), texts: before.texts.slice() };
    const index = ed.pages.findIndex((p) => p.id === g.pageId);
    let box = after.texts.find((t) => t.id === this.targets.get(g.pageId));
    if (box) {
      // the words go on in the same paragraph (the box wraps on the ruled lines)
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
    }
    const fade = this.inkAway(g.pageId, strokes);
    const oldLen = prevLen(before, box.id);
    ed.commit(g.pageId, before, after);
    this.typeIn(g.pageId, box.id, oldLen);
    await fade;
  }

  // the ink blurs and fades where it was (a copy over the page; the page itself has it no more)
  inkAway(pageId, strokes) {
    const v = this.editor.viewer.viewById(pageId);
    if (!v || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
    const page = this.editor.pages.find((q) => q.id === pageId);
    const rect = v.el.getBoundingClientRect();
    const k = rect.width / page.w;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of strokes) for (let i = 0; i + 1 < st.p.length; i += 3) { x0 = Math.min(x0, st.p[i]); x1 = Math.max(x1, st.p[i]); y0 = Math.min(y0, st.p[i + 1]); y1 = Math.max(y1, st.p[i + 1]); }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `${x0 - 4} ${y0 - 4} ${x1 - x0 + 8} ${y1 - y0 + 8}`);
    Object.assign(svg.style, { position: 'fixed', left: rect.left + (x0 - 4) * k + 'px', top: rect.top + (y0 - 4) * k + 'px', width: (x1 - x0 + 8) * k + 'px', height: (y1 - y0 + 8) * k + 'px', pointerEvents: 'none', zIndex: 50, overflow: 'visible' });
    for (const st of strokes) {
      const path = document.createElementNS(ns, 'path');
      let d = '';
      for (let i = 0; i + 1 < st.p.length; i += 3) d += `${i ? 'L' : 'M'}${st.p[i]} ${st.p[i + 1]}`;
      path.setAttribute('d', d);
      Object.assign(path.style, { fill: 'none', stroke: st.c || '#333', strokeWidth: st.s || 2, strokeLinecap: 'round', strokeLinejoin: 'round' });
      svg.append(path);
    }
    document.body.append(svg);
    return svg.animate([{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(6px)', transform: 'scale(.97)' }], { duration: 260, easing: 'ease-out' }).finished.catch(() => {}).then(() => svg.remove());
  }

  // the new words come out of a blur, as if typed: a short-lived blur over just those words
  typeIn(pageId, boxId, from) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    requestAnimationFrame(() => {
      const v = this.editor.viewer.viewById(pageId);
      const el = v && v.el.querySelector(`.textbox[data-id="${boxId}"]`);
      if (!el) return;
      const r = document.createRange();
      let n = 0, startSet = false;
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        if (!startSet && n + t.length >= from) { r.setStart(t, Math.max(0, from - n)); startSet = true; }
        n += t.length;
        r.setEnd(t, t.length);
      }
      if (!startSet) return;
      for (const q of r.getClientRects()) {
        if (q.width < 1) continue;
        const veil = document.createElement('div');
        veil.className = 'live-type';
        Object.assign(veil.style, { left: q.left - 2 + 'px', top: q.top - 2 + 'px', width: q.width + 4 + 'px', height: q.height + 4 + 'px' });
        document.body.append(veil);
        veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' }).finished.catch(() => {}).then(() => veil.remove());
      }
    });
  }
}

// how much text the box had before (the new words start after it)
function prevLen(before, id) {
  const t = before.texts.find((x) => x.id === id);
  return t ? String(t.text || '').length : 0;
}
