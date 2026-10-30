// Page thumbnails sidebar and the in-notebook search panel.
import { h, iconButton, debounce } from './ui.js';
import { drawStrokes, drawPaper } from './inkrender.js';
import { isCancel } from './pdfdoc.js';
import { searchNotebook, normalize, fold } from '../main/search.js';
import { itemBBox } from './tools.js';

const THUMB_W = 124;

export class Thumbs {
  constructor(editor) {
    this.editor = editor;
    this.el = h('div', { class: 'sidebar' });
    this.list = h('div', { class: 'thumb-list' });
    // All pages / only bookmarked pages
    this.onlyBm = false;
    this.filter = h('div', { class: 'thumb-filter' },
      h('button', { class: 'active', dataset: { f: 'all' }, onclick: () => this.setFilter(false) }, 'All pages'),
      h('button', { dataset: { f: 'bm' }, onclick: () => this.setFilter(true) }, h('span', { class: 'bm-ic', html: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>' }), 'Bookmarks'));
    this.emptyBm = h('div', { class: 'thumb-empty' }, 'No bookmarks yet. Right-click a page → Bookmark page.');
    this.el.append(this.filter, this.list);
    this.items = [];
    this.pending = new Map(); // pageId -> timer
    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const item = en.target._item;
        item.visible = en.isIntersecting;
        if (en.isIntersecting && !item.rendered) this.renderThumb(item);
        if (!en.isIntersecting && item.job) { item.job.cancel(); item.job = null; }
      }
    }, { root: this.el, rootMargin: '400px 0px' });
    this.dragFrom = null;
  }

  build() {
    this.io.disconnect();
    for (const it of this.items) { if (it.job) it.job.cancel(); it.canvas.width = it.canvas.height = 0; }
    this.list.replaceChildren();
    if (this.editor.isBoard) { this.items = []; return; }
    this.items = this.editor.pages.map((p, i) => {
      const hh = Math.round((THUMB_W * p.h) / p.w);
      const canvas = h('canvas', { class: 'thumb-canvas', width: '0', height: '0', style: { height: hh + 'px' } });
      const el = h('div', { class: 'thumb', draggable: 'true', dataset: { index: i } },
        h('div', { class: 'thumb-frame', style: { height: hh + 'px' } }, canvas),
        h('div', { class: 'thumb-num' }, String(i + 1)),
        p.bm ? h('span', { class: 'thumb-bm', title: 'Bookmarked' }) : null);
      const item = { page: p, index: i, el, canvas, rendered: false, visible: false, job: null };
      el._item = item;
      el.addEventListener('click', () => this.editor.viewer.scrollToPage(item.index));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.editor.pageMenu(item.index, e.clientX, e.clientY); });
      el.addEventListener('dragstart', (e) => { this.dragFrom = item.index; e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); this.clearDrop(); });
      el.addEventListener('dragover', (e) => {
        if (this.dragFrom === null) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        this.clearDrop();
        el.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        let to = item.index + (e.clientY < r.top + r.height / 2 ? 0 : 1);
        const from = this.dragFrom;
        this.dragFrom = null;
        this.clearDrop();
        if (from === null) return;
        if (to > from) to--;
        this.editor.movePage(from, to);
      });
      this.list.append(el);
      this.io.observe(el);
      return item;
    });
    this.setActive(this.editor.viewer.currentIndex);
    this.applyFilter();
  }

  setFilter(onlyBm) {
    this.onlyBm = onlyBm;
    this.filter.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'bm') === onlyBm));
    this.applyFilter();
  }

  applyFilter() {
    let shown = 0;
    for (const it of this.items) {
      const show = !this.onlyBm || !!it.page.bm;
      it.el.style.display = show ? '' : 'none';
      if (show) shown++;
    }
    if (this.onlyBm && !shown) this.list.append(this.emptyBm); else this.emptyBm.remove();
  }

  clearDrop() {
    this.list.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  }

  setActive(i) {
    const prev = this.list.querySelector('.thumb.active');
    if (prev) prev.classList.remove('active');
    const it = this.items[i];
    if (!it) return;
    it.el.classList.add('active');
    if (!this.editor.el.classList.contains('no-sidebar')) {
      const r = it.el.getBoundingClientRect(), sr = this.el.getBoundingClientRect();
      if (r.top < sr.top || r.bottom > sr.bottom) it.el.scrollIntoView({ block: 'nearest' });
    }
  }

  invalidate(pageId) {
    if (this.pending.has(pageId)) return;
    this.pending.set(pageId, setTimeout(() => {
      this.pending.delete(pageId);
      const it = this.items.find((x) => x.page.id === pageId);
      if (it && it.visible) this.renderThumb(it);
      else if (it) it.rendered = false;
    }, 600));
  }

  renderThumb(item) {
    item.rendered = true;
    const p = item.page;
    const scale = (THUMB_W * (window.devicePixelRatio || 1)) / p.w;
    const finish = (bg) => {
      const c = item.canvas;
      c.width = Math.round(p.w * scale);
      c.height = Math.round(p.h * scale);
      const ctx = c.getContext('2d');
      if (bg) ctx.drawImage(bg, 0, 0, c.width, c.height);
      else drawPaper(ctx, p, scale);
      const data = this.editor.pageData(p.id);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const it of data.items) {
        const b = itemBBox(it);
        const img = it.type === 'img' && this.editor.loadedImage(it.src);
        if (img) ctx.drawImage(img, b[0], b[1], b[2] - b[0], b[3] - b[1]);
        else { ctx.fillStyle = '#d8dde6'; ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawStrokes(ctx, data.strokes, scale, { clear: false });
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const t of data.texts) {
        ctx.fillStyle = t.c;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(t.x, t.y + t.fs * 0.2, Math.min(t.w, (t.text || '').length * t.fs * 0.5), Math.max(1, (t.lines || 1) * t.fs * 1.3 - t.fs * 0.4));
        ctx.globalAlpha = 1;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    if (p.kind !== 'pdf') return finish(null);
    const pdf = this.editor.pdfFor(p.src || 'main');
    if (!pdf) { item.rendered = false; return; }
    if (item.job) item.job.cancel();
    const job = pdf.render(p.pdfPage, scale, 100 + item.index / 1e5, p.rot || 0);
    item.job = job;
    job.promise.then((canvas) => { item.job = null; finish(canvas); canvas.width = canvas.height = 0; }, (err) => {
      item.job = null;
      item.rendered = false;
      if (!isCancel(err)) console.warn(err);
    });
  }

  // A PDF finished loading: render thumbnails that were waiting for it.
  refreshMissing() {
    for (const it of this.items) if (it.visible && !it.rendered) this.renderThumb(it);
  }

  destroy() {
    this.io.disconnect();
    for (const it of this.items) if (it.job) it.job.cancel();
    for (const t of this.pending.values()) clearTimeout(t);
  }
}

export class SearchPanel {
  constructor(editor) {
    this.editor = editor;
    this.input = h('input', { class: 'input', type: 'search', placeholder: 'Search text in this notebook' });
    this.status = h('div', { class: 'search-status' });
    this.results = h('div', { class: 'search-results' });
    this.el = h('div', { class: 'search-panel' },
      h('div', { class: 'search-head' }, this.input, iconButton('close', 'Close', () => this.close())),
      this.status, this.results);
    this.run = debounce(() => this.search(), 200);
    this.input.addEventListener('input', () => this.run());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const first = this.results.querySelector('.result'); if (first) first.click(); }
      if (e.key === 'Escape') this.close();
    });
    this.indexing = new Map(); // src -> [n, total]
  }

  open() {
    this.editor.el.classList.add('searching');
    this.input.focus();
    this.input.select();
    this.search();
  }

  close() {
    this.editor.el.classList.remove('searching');
    this.editor.viewer.scroller.focus({ preventScroll: true });
  }

  toggle() {
    if (this.editor.el.classList.contains('searching')) this.close(); else this.open();
  }

  indexProgress(src, n, total) {
    if (n < total) this.indexing.set(src, [n, total]); else this.indexing.delete(src);
    if (this.editor.el.classList.contains('searching')) this.updateStatus(this.lastCount);
  }

  updateStatus(count) {
    this.lastCount = count;
    const parts = [];
    if (count !== undefined) parts.push(count === 0 ? 'No results' : `${count} result${count === 1 ? '' : 's'}`);
    for (const [n, total] of this.indexing.values()) parts.push(`indexing PDF ${n}/${total}…`);
    const idx = this.editor.doc.textIndexes || {};
    const main = idx.main;
    if (main && main.complete && !Object.values(main.pages).some((s) => s && s.trim())) {
      parts.push('this PDF has no text layer (scanned) – only typed notes are searchable');
    }
    this.status.textContent = parts.join(' · ');
  }

  search() {
    const q = this.input.value;
    this.results.replaceChildren();
    if (!q.trim()) { this.updateStatus(); return; }
    const d = this.editor.doc;
    const hits = searchNotebook(d.nb, d.textIndexes || {}, d.pages, q, 500);
    this.updateStatus(hits.length);
    const board = this.editor.isBoard;
    for (const hit of hits) {
      const sn = hit.snippet;
      const nq = normalize(q).trim();
      const i = fold(sn).indexOf(nq);
      const snip = h('div', { class: 'result-snippet' });
      if (i >= 0) snip.append(sn.slice(0, i), h('mark', {}, sn.slice(i, i + nq.length)), sn.slice(i + nq.length));
      else snip.textContent = sn;
      this.results.append(h('button', { class: 'result', onclick: () => this.editor.goToHit(hit, q) },
        h('div', { class: 'result-page' }, board ? 'Board' : `Page ${hit.pageIndex + 1}`, hit.source === 'note' ? h('span', { class: 'tag' }, 'note') : null),
        snip));
    }
  }
}
