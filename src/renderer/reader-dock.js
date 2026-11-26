// The reference reader docked into the main window: one side of a split
// view next to the notes (drag the divider, swap the sides), and the way out
// into its own floating window and back – both with a smooth move.
import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { ReaderView } from './reader-view.js';
import { layout, dragDivider, swap } from '../shared/split-layout.js';

export class ReaderDock {
  constructor(app) {
    this.app = app;
    this.view = null;
    this.pane = h('div', { class: 'rd-pane' });
    this.divider = h('div', { class: 'rd-divider', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the reader' });
    this.divider.addEventListener('pointerdown', (e) => this.drag(e));
    this.ro = new ResizeObserver(() => this.fit());
    window.api.onReaderDocked((st) => {
      // dropped on the left edge: the reader goes left, the notes right
      if (st.side) { this.app.settings.readerSplit = { ...this.split, mode: 'split', notesSide: st.side === 'left' ? 'right' : 'left' }; this.app.saveSettings(); }
      this.open(st, { glide: true });
    });
    // a blue strip at the edge where the dragged reader window would dock
    this.strip = h('div', { class: 'rd-zone', hidden: true });
    document.body.append(this.strip);
    window.api.onReaderZone((side) => {
      const ed = this.app.active;
      this.strip.hidden = !side || !ed;
      if (this.strip.hidden) return;
      const r = ed.body.getBoundingClientRect();
      Object.assign(this.strip.style, { top: r.top + 'px', height: r.height + 'px', left: side === 'left' ? r.left + 'px' : '', right: side === 'right' ? (window.innerWidth - r.right) + 'px' : '' });
    });
    window.api.onReaderUndocked(() => this.remove());
  }

  get split() { return { mode: 'split', ratio: 0.5, notesSide: 'left', ...(this.app.settings.readerSplit || {}) }; }

  /** Opens a PDF in the reader: floating window (default) or docked here. */
  show(state, where = 'float') {
    if (where === 'dock') return this.open(state);
    if (this.view) this.remove();
    return window.api.readerOpen(state);
  }

  async open(state, { glide = false } = {}) {
    if (this.view) this.view.destroy();
    const undock = h('button', { class: 'icon-btn', title: 'Take the reader out into its own window', 'aria-label': 'Undock', html: icon('pageLandscape', 16), onclick: () => this.undock() });
    const swapBtn = h('button', { class: 'icon-btn', title: 'Swap sides', 'aria-label': 'Swap sides', html: icon('combine', 16), onclick: () => { this.app.settings.readerSplit = swap(this.split); this.app.saveSettings(); this.fit(); } });
    const close = h('button', { class: 'icon-btn', title: 'Close the reader', 'aria-label': 'Close the reader', html: icon('close', 16), onclick: () => this.remove() });
    this.view = new ReaderView({ ...state, buttons: [swapBtn, undock, close] });
    this.view.el.querySelector('.rd-bar').title = 'Drag out to take the reader into its own window';
    this.pane.replaceChildren(this.view.el);
    this.attach();
    const bar = this.view.el.querySelector('.rd-bar');
    bar.addEventListener('pointerdown', (e) => this.dragOut(e));
    if (glide) { const c = this.split.notesSide === 'right' ? 'rd-in-left' : 'rd-in-right'; this.pane.classList.add('rd-in', c); setTimeout(() => this.pane.classList.remove('rd-in', c), 420); }
    try { await this.view.open(); } catch (err) { toast(String(err.message || err), { error: true }); this.remove(); }
  }

  // into the open notebook's area (again after switching tabs)
  attach() {
    const ed = this.app.active;
    if (!this.view || !ed) { this.pane.remove(); this.divider.remove(); return; }
    if (this.pane.parentNode !== ed.body) {
      ed.body.append(this.divider, this.pane);
      this.ro.disconnect();
      this.ro.observe(ed.body);
    }
    this.fit();
  }

  fit() {
    const ed = this.app.active;
    if (!this.view || !ed || !this.pane.isConnected) return;
    const st = this.split;
    const l = layout(st, ed.body.clientWidth, { minPane: 280, divider: 6 });
    this.pane.hidden = this.divider.hidden = !l.reader;
    if (!l.reader) return;
    this.pane.style.width = l.reader.width + 'px';
    ed.body.classList.toggle('rd-left', st.notesSide === 'right');
    ed.viewer.scheduleUpdate && ed.viewer.scheduleUpdate();
  }

  drag(e) {
    e.preventDefault();
    const ed = this.app.active;
    const r = ed.body.getBoundingClientRect();
    this.divider.setPointerCapture(e.pointerId);
    const move = (ev) => { this.app.settings.readerSplit = dragDivider(this.split, r.width, ev.clientX - r.left); this.fit(); };
    const up = () => { this.divider.removeEventListener('pointermove', move); this.divider.removeEventListener('pointerup', up); this.app.saveSettings(); };
    this.divider.addEventListener('pointermove', move);
    this.divider.addEventListener('pointerup', up);
  }

  // pull the docked pane out by its header, like a Chrome tab: past 40 px it becomes its own window
  dragOut(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      this.pane.style.transform = `translate(${dx * 0.25}px, ${dy * 0.25}px)`;
      if (Math.hypot(dx, dy) > 40) { done(); this.undock(); }
    };
    const done = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); this.pane.style.transform = ''; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
  }

  async undock() {
    if (!this.view) return;
    const r = this.pane.getBoundingClientRect();
    await window.api.readerUndock(this.view.state, { x: r.left, y: r.top, width: r.width, height: r.height });
  }

  remove() {
    if (this.view) this.view.destroy();
    this.view = null;
    this.pane.remove();
    this.divider.remove();
    if (this.app.active) { this.app.active.body.classList.remove('rd-left'); this.app.active.viewer.scheduleUpdate && this.app.active.viewer.scheduleUpdate(); }
  }
}

/** The ⋯ menu entry: this notebook's PDF or another one, floating or docked. */
export function readerMenuItems(editor) {
  const app = editor.app;
  const page = editor.pages[editor.viewer.currentIndex];
  const src = page && page.kind === 'pdf' ? (page.src || 'main') : (editor.pages.find((p) => p.kind === 'pdf') || {}).src || (editor.pages.some((p) => p.kind === 'pdf') ? 'main' : null);
  const items = [];
  if (src) {
    const file = src === 'main' ? 'source.pdf' : `sources/${src}.pdf`;
    const st = { rel: editor.rel, file, title: editor.doc.nb.title, page: page && page.kind === 'pdf' ? page.pdfPage : 1 };
    items.push({ label: 'Reader: this PDF in its own window', icon: 'pageLandscape', onClick: () => app.reader.show(st, 'float') });
    items.push({ label: 'Reader: this PDF next to the notes', icon: 'sidebar', onClick: () => app.reader.show(st, 'dock') });
  }
  items.push({ label: 'Reader: another PDF…', icon: 'importPdf', shortcut: 'Ctrl+D', onClick: () => openPdfWindow(editor) });
  return items;
}

/** Ctrl+D / Insert → PDF window: any PDF, only to read – it is not added to the library. */
export async function openPdfWindow(editor) {
  const st = await window.api.readerPick();
  if (st) editor.app.reader.show(st, 'float');
}
