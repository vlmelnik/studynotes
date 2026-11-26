// The reference reader: a PDF to read next to the notes – in its own small
// always-on-top window or docked into the main window. Pages render as they
// come into view, text can be selected and copied or dragged into the notes
// or the chat, Ctrl+wheel zooms, the state (page, zoom) moves between the two
// places.
import { h } from './ui.js';
import { icon } from './icons.js';
import { PdfDoc, TextLayer, isCancel } from './pdfdoc.js';

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export class ReaderView {
  /**
   * opts: { rel, file, title, page = 1, zoom = 1 (1 = page width), buttons: [elements], onState(state) }
   */
  constructor(opts) {
    this.o = opts;
    this.zoom = opts.zoom || 1;
    this.pageNo = h('span', { class: 'rd-pageno no-i18n' }, '');
    this.scroller = h('div', { class: 'rd-pages', tabindex: 0 });
    this.el = h('div', { class: 'reader' },
      h('div', { class: 'rd-bar' },
        h('span', { class: 'rd-title no-i18n', title: opts.title || '' }, opts.title || ''),
        this.pageNo,
        h('button', { class: 'icon-btn', title: 'Zoom out', 'aria-label': 'Zoom out', html: icon('zoomOut', 16), onclick: () => this.step(-1) }),
        h('button', { class: 'icon-btn', title: 'Zoom in', 'aria-label': 'Zoom in', html: icon('zoomIn', 16), onclick: () => this.step(1) }),
        ...(opts.buttons || [])),
      this.scroller);
    this.views = [];
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e);
    }, { passive: false });
    // selecting text copies it at once (also Ctrl+C); a short "Copied" shows it
    this.copied = h('span', { class: 'rd-copied', hidden: true }, 'Copied');
    this.el.querySelector('.rd-bar').insertBefore(this.copied, this.pageNo);
    const copy = () => {
      const sel = window.getSelection();
      const text = sel && !sel.isCollapsed && this.scroller.contains(sel.anchorNode) ? sel.toString().replace(/[ \t]+\n/g, '\n').trim() : '';
      if (!text || text === this.lastCopy) return;
      this.lastCopy = text;
      window.api.copyText(text).then(() => { this.copied.hidden = false; clearTimeout(this.copyT); this.copyT = setTimeout(() => { this.copied.hidden = true; }, 1200); }, () => {});
    };
    this.scroller.addEventListener('pointerup', () => setTimeout(copy, 10));
    this.el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { this.lastCopy = null; copy(); } });
    document.addEventListener('selectionchange', () => { const s = window.getSelection(); if (!s || s.isCollapsed) this.lastCopy = null; });
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.scroller);
  }

  get state() { return { rel: this.o.rel, file: this.o.file, title: this.o.title, page: this.current || 1, zoom: this.zoom }; }

  async open() {
    this.doc = await PdfDoc.open(this.o.rel, this.o.file || 'source.pdf');
    this.sizes = await this.doc.pageSizes();
    this.views = this.sizes.map((sz, i) => {
      const el = h('div', { class: 'rd-page', dataset: { n: i + 1 } });
      return { n: i + 1, sz, el, canvas: null, text: null, scale: 0, job: null };
    });
    this.scroller.replaceChildren(...this.views.map((v) => v.el));
    this.io = new IntersectionObserver((es) => { for (const e of es) { const v = this.views[Number(e.target.dataset.n) - 1]; v.visible = e.isIntersecting; if (v.visible) this.draw(v); } }, { root: this.scroller, rootMargin: '600px 0px' });
    for (const v of this.views) this.io.observe(v.el);
    this.layout();
    this.goTo(this.o.page || 1, false);
  }

  // the page width at zoom 1 is the reader's width
  baseScale(v) { return Math.max(0.1, (this.scroller.clientWidth - 24) / v.sz.w); }

  layout() {
    if (!this.views.length) return;
    const keep = this.current || 1;
    for (const v of this.views) {
      const s = this.baseScale(v) * this.zoom;
      v.el.style.width = Math.round(v.sz.w * s) + 'px';
      v.el.style.height = Math.round(v.sz.h * s) + 'px';
      if (v.visible && Math.abs(v.scale - s) > 0.01) this.draw(v);
    }
    this.goTo(keep, false);
  }

  async draw(v) {
    const s = this.baseScale(v) * this.zoom;
    if (Math.abs(v.scale - s) < 0.01 && v.canvas) return;
    v.scale = s;
    if (v.job) v.job.cancel();
    const dpr = window.devicePixelRatio || 1;
    v.job = this.doc.render(v.n, s * dpr, 0);
    try {
      const canvas = await v.job.promise;
      if (v.scale !== s) return;
      canvas.className = 'rd-canvas';
      canvas.style.width = '100%'; canvas.style.height = '100%';
      if (v.canvas) v.canvas.replaceWith(canvas); else v.el.prepend(canvas);
      v.canvas = canvas;
      // selectable text over the picture
      const layer = h('div', { class: 'rd-text textLayer' });
      const page = await this.doc.getPage(v.n);
      const vp = page.getViewport({ scale: s });
      layer.style.setProperty('--scale-factor', String(s));
      layer.style.setProperty('--total-scale-factor', String(s));
      const tl = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: vp });
      await tl.render();
      if (v.scale !== s) return;
      if (v.text) v.text.replaceWith(layer); else v.el.append(layer);
      v.text = layer;
    } catch (err) {
      if (!isCancel(err)) console.warn('reader page', v.n, err);
    } finally { v.job = null; }
  }

  onScroll() {
    const top = this.scroller.scrollTop + this.scroller.clientHeight / 3;
    let cur = 1;
    for (const v of this.views) if (v.el.offsetTop <= top) cur = v.n;
    if (cur !== this.current) {
      this.current = cur;
      this.pageNo.textContent = `${cur} / ${this.views.length}`;
      this.o.onState && this.o.onState(this.state);
    }
  }

  goTo(n, smooth = true) {
    const v = this.views[Math.max(0, Math.min(this.views.length - 1, n - 1))];
    if (!v) return;
    this.scroller.scrollTo({ top: v.el.offsetTop - 8, behavior: smooth ? 'smooth' : 'auto' });
    this.current = v.n;
    this.pageNo.textContent = `${v.n} / ${this.views.length}`;
  }

  step(dir) {
    const i = ZOOMS.findIndex((z) => z >= this.zoom - 0.001);
    const next = dir > 0 ? ZOOMS.find((z) => z > this.zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < this.zoom - 0.001);
    this.setZoom(next || ZOOMS[i] || this.zoom);
  }

  setZoom(z, e) {
    z = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z));
    if (Math.abs(z - this.zoom) < 0.001) return;
    // keep the point under the mouse (or the middle) where it is
    const r = this.scroller.getBoundingClientRect();
    const ay = e ? e.clientY - r.top : this.scroller.clientHeight / 2;
    const ax = e ? e.clientX - r.left : this.scroller.clientWidth / 2;
    const fy = (this.scroller.scrollTop + ay) / Math.max(1, this.scroller.scrollHeight);
    const fx = (this.scroller.scrollLeft + ax) / Math.max(1, this.scroller.scrollWidth);
    this.zoom = z;
    const cur = this.current;
    for (const v of this.views) { const s = this.baseScale(v) * z; v.el.style.width = Math.round(v.sz.w * s) + 'px'; v.el.style.height = Math.round(v.sz.h * s) + 'px'; }
    this.scroller.scrollTop = fy * this.scroller.scrollHeight - ay;
    this.scroller.scrollLeft = fx * this.scroller.scrollWidth - ax;
    for (const v of this.views) if (v.visible) this.draw(v);
    this.current = cur;
    this.o.onState && this.o.onState(this.state);
  }

  destroy() {
    this.ro.disconnect();
    if (this.io) this.io.disconnect();
    for (const v of this.views) if (v.job) v.job.cancel();
    if (this.doc) this.doc.destroy();
    this.el.remove();
  }
}
