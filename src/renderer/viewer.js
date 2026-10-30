// Page viewer with virtualisation.
//  * Notebooks: pages stacked vertically; only pages near the viewport have
//    DOM nodes. PDF bitmaps are rendered on demand (visible first), kept in a
//    pixel-budget LRU cache, and re-rendered sharply when zooming settles.
//  * Ink and paper are drawn into "region" canvases that only cover the
//    visible part of a page (plus a margin). That keeps memory flat at any
//    zoom and makes the endless board possible.
//  * Boards (endless notebooks): one page in world coordinates whose box
//    grows in every direction while you scroll towards an edge.
import { h } from './ui.js';
import { drawStrokes, drawPaperRegion } from './inkrender.js';
import { isCancel } from './pdfdoc.js';
import { pageBackground } from '../shared/paper.js';

const GAP = 18;
const END_ZONE = 110;       // room for the "+" under the last page
const OVERSCROLL_MS = 500;  // keep scrolling (or pulling) this long to add a page
const MAX_CANVAS_PX = 16e6;      // per canvas
const CACHE_BUDGET_PX = 28e6;    // ≈ 110 MB of cached PDF bitmaps
const REGION_MARGIN = 0.5;       // extra area around the viewport (fraction of its size)
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

function dpr() { return window.devicePixelRatio || 1; }

class BitmapCache {
  constructor(budget) { this.budget = budget; this.map = new Map(); this.used = 0; }
  get(key) {
    const e = this.map.get(key);
    if (e) { this.map.delete(key); this.map.set(key, e); }
    return e;
  }
  set(key, canvas, scale) {
    const old = this.map.get(key);
    if (old) {
      this.used -= old.px;
      this.map.delete(key);
      if (old.canvas !== canvas && !old.canvas.isConnected) releaseCanvas(old.canvas);
    }
    const px = canvas.width * canvas.height;
    this.map.set(key, { canvas, scale, px });
    this.used += px;
    for (const [k, e] of this.map) {
      if (this.used <= this.budget) break;
      if (k === key || e.canvas.isConnected) continue;
      this.map.delete(k);
      this.used -= e.px;
      releaseCanvas(e.canvas);
    }
  }
  has(canvas) {
    for (const e of this.map.values()) if (e.canvas === canvas) return true;
    return false;
  }
  clear() { for (const e of this.map.values()) releaseCanvas(e.canvas); this.map.clear(); this.used = 0; }
}

// Chromium frees canvas memory only on GC; shrink to 0×0 to release it now.
export function releaseCanvas(c) {
  if (!c) return;
  if (c.parentNode) c.remove();
  c.width = 0;
  c.height = 0;
}

function contains(a, b) { return a && b && a[0] <= b[0] + 0.5 && a[1] <= b[1] + 0.5 && a[2] >= b[2] - 0.5 && a[3] >= b[3] - 0.5; }
function intersect(a, b) {
  const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[2] > r[0] && r[3] > r[1] ? r : null;
}

class PageView {
  constructor(viewer, index) {
    this.viewer = viewer;
    this.index = index;
    this.page = viewer.pages[index];
    this.el = h('div', { class: `page${this.page.kind === 'board' ? ' board' : ''}`, dataset: { pageId: this.page.id }, style: { background: pageBackground(this.page) } });
    this.bgHost = h('div', { class: 'page-bg' });
    this.paperCanvas = h('canvas', { class: 'region-canvas paper-canvas' });
    this.itemsLayer = h('div', { class: 'page-items' });
    this.inkCanvas = h('canvas', { class: 'region-canvas page-ink' });
    this.textLayer = h('div', { class: 'page-texts' });
    this.overlay = h('div', { class: 'page-overlay' });
    this.el.append(this.bgHost, this.itemsLayer, this.inkCanvas, this.textLayer, this.overlay);
    if (this.page.bm) {
      this.el.append(h('button', { class: 'page-bm', title: 'Bookmarked – click to remove', onclick: (e) => { e.stopPropagation(); viewer.editor.toggleBookmark(this.index); } }));
    }
    this.bgScale = 0;
    this.bgTask = null;
    this.ink = { rect: null, scale: 0 };
    this.paper = { rect: null, scale: 0 };
    this.inkSkip = null;
  }

  get ox() { return this.page.ox || 0; }
  get oy() { return this.page.oy || 0; }
  get src() { return this.page.src || 'main'; }
  get key() { return this.page.kind === 'pdf' ? `${this.src}:${this.page.pdfPage}:${this.page.rot || 0}` : null; }
  bounds() { return [this.ox, this.oy, this.ox + this.page.w, this.oy + this.page.h]; }

  // Device pixels per page unit for full-page bitmaps (PDF), capped by memory.
  targetScale() {
    const p = this.page;
    return Math.min(this.viewer.zoom * dpr(), Math.sqrt(MAX_CANVAS_PX / (p.w * p.h)));
  }

  // Device pixels per page unit for region canvases (never capped: regions are small).
  regionScale() {
    return this.viewer.zoom * dpr();
  }

  position() {
    const L = this.viewer.layout[this.index];
    const s = this.el.style;
    s.left = L.x + 'px';
    s.top = L.y + 'px';
    s.width = L.w + 'px';
    s.height = L.h + 'px';
    const t = `scale(${this.viewer.zoom}) translate(${-this.ox}px, ${-this.oy}px)`;
    this.textLayer.style.transform = t;
    this.itemsLayer.style.transform = t;
    // Handles inside the scaled layer stay the same size on screen.
    this.textLayer.style.setProperty('--iz', String(1 / this.viewer.zoom));
    this.placeRegion(this.inkCanvas, this.ink.rect);
    this.placeRegion(this.paperCanvas, this.paper.rect);
  }

  // Position a region canvas in % of the page so it scales with zoom for free.
  placeRegion(canvas, rect) {
    if (!rect) return;
    const { w, h: ph } = this.page;
    const s = canvas.style;
    s.left = ((rect[0] - this.ox) / w) * 100 + '%';
    s.top = ((rect[1] - this.oy) / ph) * 100 + '%';
    s.width = ((rect[2] - rect[0]) / w) * 100 + '%';
    s.height = ((rect[3] - rect[1]) / ph) * 100 + '%';
  }

  // Area (page units) a region canvas should cover now, or null if invisible.
  wantedRegion() {
    const vis = this.viewer.visibleWorldRect(this.index);
    if (!vis) return null;
    const mw = (vis[2] - vis[0]) * REGION_MARGIN, mh = (vis[3] - vis[1]) * REGION_MARGIN;
    return { vis, rect: intersect([vis[0] - mw, vis[1] - mh, vis[2] + mw, vis[3] + mh], this.bounds()) };
  }

  // Returns true if the region canvas had to be (re)allocated.
  ensureRegion(state, canvas, force) {
    const want = this.wantedRegion();
    if (!want || !want.rect) return false;
    const scale = this.regionScale();
    const visible = intersect(want.vis, this.bounds());
    if (!force && state.rect && Math.abs(state.scale - scale) < 1e-3 && contains(state.rect, visible)) return false;
    let rect = want.rect;
    let sc = scale;
    const px = (rect[2] - rect[0]) * (rect[3] - rect[1]) * sc * sc;
    if (px > MAX_CANVAS_PX) {
      // Very large screens at high zoom: shrink the margin first.
      rect = visible;
    }
    const W = Math.max(1, Math.round((rect[2] - rect[0]) * sc));
    const H = Math.max(1, Math.round((rect[3] - rect[1]) * sc));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    state.rect = rect;
    state.scale = sc;
    this.placeRegion(canvas, rect);
    return true;
  }

  setBg(canvas, scale) {
    canvas.classList.add('bg-canvas');
    if (canvas.isConnected && canvas.parentNode !== this.bgHost) {
      // Same PDF page shown twice (duplicated page): copy the bitmap.
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      canvas = copy;
      canvas.classList.add('bg-canvas');
    }
    const old = this.bgHost.firstChild;
    if (old !== canvas) {
      this.bgHost.replaceChildren(canvas);
      if (old && old !== this.paperCanvas && !this.viewer.cache.has(old)) releaseCanvas(old);
    }
    this.bgScale = scale;
  }

  drawPaper(force = false) {
    if (this.paperCanvas.parentNode !== this.bgHost) this.bgHost.replaceChildren(this.paperCanvas);
    if (!this.ensureRegion(this.paper, this.paperCanvas, force) && !force) return;
    drawPaperRegion(this.paperCanvas.getContext('2d'), this.page, this.paper.rect, this.paper.scale);
    this.bgScale = this.paper.scale;
  }

  ensureBg(priority) {
    const p = this.page;
    if (p.kind !== 'pdf') return this.drawPaper();
    const target = this.targetScale();
    if (this.bgScale >= target * 0.97 && this.bgScale <= target * 1.5) return;
    const pdf = this.viewer.editor.pdfFor(this.src);
    if (!pdf) return; // still loading; the editor schedules an update when ready
    const cached = this.viewer.cache.get(this.key);
    if (cached) {
      if (cached.canvas.parentNode !== this.bgHost) this.setBg(cached.canvas, cached.scale);
      if (cached.scale >= target * 0.97) { this.bgScale = cached.scale; return; }
    }
    // While flying through the document, paint a cheap preview (or keep the
    // current bitmap) and render sharply once scrolling slows down.
    let scale = target;
    if (this.viewer.fastScrolling) {
      if (this.bgScale > 0 || cached) return;
      scale = Math.min(target, 0.45);
    }
    if (this.bgTask && Math.abs(this.bgTask.scale - scale) < 1e-3) {
      this.bgTask.setPriority(priority);
      return;
    }
    this.cancelBg();
    const job = pdf.render(p.pdfPage, scale, priority, p.rot || 0);
    this.bgTask = { scale, cancel: job.cancel, setPriority: job.setPriority };
    job.promise.then((canvas) => {
      this.bgTask = null;
      const cur = this.viewer.cache.get(this.key);
      if (!cur || cur.scale <= scale) this.viewer.cache.set(this.key, canvas, scale);
      if (this.el.isConnected) this.setBg(canvas, scale);
      if (scale < target && !this.viewer.fastScrolling) this.viewer.scheduleUpdate();
    }, (err) => {
      this.bgTask = null;
      if (!isCancel(err)) console.error('render failed', err);
    });
  }

  cancelBg() {
    if (this.bgTask) { this.bgTask.cancel(); this.bgTask = null; }
  }

  drawInk(force = false) {
    const data = this.viewer.editor.pageData(this.page.id);
    if (!data.strokes.length) {
      if (this.inkCanvas.width) { this.inkCanvas.width = 0; this.inkCanvas.height = 0; }
      this.ink.rect = null;
      return;
    }
    const realloc = this.ensureRegion(this.ink, this.inkCanvas, false);
    if (!realloc && !force) return;
    const r = this.ink.rect;
    if (!r) return;
    drawStrokes(this.inkCanvas.getContext('2d'), data.strokes, this.ink.scale, {
      ox: -r[0] * this.ink.scale, oy: -r[1] * this.ink.scale, skip: this.inkSkip, clip: r,
    });
  }

  // Draw one new pen stroke without redrawing the page.
  addStroke(st) {
    if (!this.ink.rect || !this.inkCanvas.width || st.t === 'hl') return this.drawInk(true);
    const r = this.ink.rect;
    drawStrokes(this.inkCanvas.getContext('2d'), [st], this.ink.scale, { ox: -r[0] * this.ink.scale, oy: -r[1] * this.ink.scale, clear: false });
  }

  // A temporary canvas over the visible part of the page (live strokes, selections).
  makeRegionCanvas(cls) {
    const want = this.wantedRegion();
    const rect = want ? intersect(want.vis, this.bounds()) || this.bounds() : this.bounds();
    const scale = this.regionScale();
    const c = h('canvas', { class: `region-canvas ${cls}` });
    c.width = Math.max(1, Math.round((rect[2] - rect[0]) * scale));
    c.height = Math.max(1, Math.round((rect[3] - rect[1]) * scale));
    this.placeRegion(c, rect);
    this.overlay.append(c);
    return { canvas: c, ctx: c.getContext('2d'), scale, rect };
  }

  destroy() {
    this.cancelBg();
    this.el.remove();
    const bg = this.bgHost.firstChild;
    this.bgHost.replaceChildren(); // detach so the cached bitmap can be reused elsewhere
    if (bg && bg !== this.paperCanvas && !this.viewer.cache.has(bg)) releaseCanvas(bg);
    releaseCanvas(this.paperCanvas);
    releaseCanvas(this.inkCanvas);
    this.overlay.querySelectorAll('canvas').forEach(releaseCanvas);
  }
}

export class Viewer {
  constructor(editor) {
    this.editor = editor;
    this.pages = editor.doc.nb.pages;
    this.isBoard = editor.doc.nb.kind === 'board';
    this.zoom = 1;
    this.layout = [];
    this.views = new Map(); // index -> PageView
    this.cache = new BitmapCache(CACHE_BUDGET_PX);
    this.scroller = h('div', { class: `viewer${this.isBoard ? ' board-viewer' : ''}`, tabindex: '-1' });
    this.content = h('div', { class: 'viewer-content' });
    this.scroller.append(this.content);
    // "+" under the last page: click it, or keep scrolling down for 2 s.
    if (!this.isBoard) {
      this.endZone = h('div', { class: 'page-end' },
        h('button', { class: 'page-end-btn', title: 'Add a page (or keep scrolling down)', onclick: () => this.editor.appendPage() },
          h('span', { class: 'page-end-ring', html: '<svg viewBox="0 0 44 44"><circle class="track" cx="22" cy="22" r="20"/><circle class="bar" cx="22" cy="22" r="20" pathLength="100"/></svg>' }),
          h('span', { class: 'page-end-plus', html: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>' })));
      this.content.append(this.endZone);
    }
    this.currentIndex = 0;
    this.onPageChange = null;
    this.onZoomChange = null;
    this._raf = 0;
    this._zoomTimer = 0;
    this._zAnim = null;

    this.fastScrolling = false;
    this._lastScroll = { t: 0, y: 0 };
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scroller.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.resizeObs = new ResizeObserver(() => {
      if (this.fitMode) this.fitWidth(true); else { this.computeLayout(); this.scheduleUpdate(); }
    });
    this.resizeObs.observe(this.scroller);
    this.watchDpr();
  }

  onScroll() {
    const now = performance.now();
    const y = this.scroller.scrollTop;
    const dt = now - this._lastScroll.t;
    const v = dt > 0 ? Math.abs(y - this._lastScroll.y) / dt : 0; // px per ms
    this._lastScroll = { t: now, y };
    // > ~1.5 screens per second counts as "flying"
    if (dt < 100 && v > (this.scroller.clientHeight * 1.5) / 1000) this.fastScrolling = true;
    clearTimeout(this._scrollIdle);
    this._scrollIdle = setTimeout(() => { this.fastScrolling = false; this.scheduleUpdate(); }, 120);
    this.scheduleUpdate();
  }

  watchDpr() {
    const mq = window.matchMedia(`(resolution: ${dpr()}dppx)`);
    const onChange = () => { this.invalidateAll(); this.watchDpr(); };
    mq.addEventListener('change', onChange, { once: true });
  }

  mount(parent) {
    parent.append(this.scroller);
    this.computeLayout();
  }

  setPages(pages) {
    this.pages = pages;
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.computeLayout();
    this.scheduleUpdate();
  }

  computeLayout() {
    const vw = this.scroller.clientWidth || 800;
    if (this.isBoard) {
      const p = this.pages[0];
      this.layout = [{ x: 0, y: 0, w: p.w * this.zoom, h: p.h * this.zoom }];
      this.content.style.width = this.layout[0].w + 'px';
      this.content.style.height = this.layout[0].h + 'px';
    } else {
      let y = GAP;
      let maxW = 0;
      this.layout = this.pages.map((p) => {
        const w = p.w * this.zoom, ph = p.h * this.zoom;
        maxW = Math.max(maxW, w);
        const L = { x: 0, y, w, h: ph };
        y += ph + GAP;
        return L;
      });
      const contentW = Math.max(vw, maxW + GAP * 2);
      for (const L of this.layout) L.x = Math.round((contentW - L.w) / 2);
      this.content.style.width = contentW + 'px';
      if (this.endZone) {
        // centred under the last page
        const last = this.layout[this.layout.length - 1];
        Object.assign(this.endZone.style, { top: y + 'px', left: (last ? last.x : 0) + 'px', width: (last ? last.w : contentW) + 'px' });
        y += END_ZONE;
      }
      this.content.style.height = y + 'px';
    }
    for (const v of this.views.values()) {
      if (v.index < this.layout.length) v.position();
    }
  }

  // Board: extend the page box when the view gets near an edge.
  growBoard() {
    if (!this.isBoard) return false;
    const p = this.pages[0];
    const s = this.scroller;
    const vw = s.clientWidth / this.zoom, vh = s.clientHeight / this.zoom;
    const gx = Math.max(1600, vw * 2), gy = Math.max(1200, vh * 2);
    let left = s.scrollLeft / this.zoom, top = s.scrollTop / this.zoom;
    const growL = left < vw * 0.6, growT = top < vh * 0.6;
    const growR = left + vw > p.w - vw * 0.6, growB = top + vh > p.h - vh * 0.6;
    if (!(growL || growT || growR || growB)) return false;
    if (growL) { p.ox -= gx; p.w += gx; left += gx; }
    if (growT) { p.oy -= gy; p.h += gy; top += gy; }
    if (growR) p.w += gx;
    if (growB) p.h += gy;
    {
      // Grow the content first, then restore the view on the same world point.
      this.computeLayout();
      s.scrollLeft = left * this.zoom;
      s.scrollTop = top * this.zoom;
      for (const v of this.views.values()) { v.ink.rect = null; v.paper.rect = null; }
      this.editor.onBoardResized && this.editor.onBoardResized();
    }
    return true;
  }

  // First page index whose bottom is below `y`.
  indexAtY(y) {
    let lo = 0, hi = this.layout.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const L = this.layout[mid];
      if (L.y + L.h < y) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  visibleRange() {
    const top = this.scroller.scrollTop, bottom = top + this.scroller.clientHeight;
    if (!this.layout.length) return [0, -1];
    const first = this.indexAtY(top);
    let last = first;
    while (last + 1 < this.layout.length && this.layout[last + 1].y < bottom) last++;
    return [first, last];
  }

  // Visible part of a page in page (world) units, or null.
  visibleWorldRect(index) {
    const L = this.layout[index];
    const p = this.pages[index];
    if (!L || !p) return null;
    const s = this.scroller;
    const z = this.zoom;
    const x0 = (s.scrollLeft - L.x) / z, y0 = (s.scrollTop - L.y) / z;
    const r = [x0, y0, x0 + s.clientWidth / z, y0 + s.clientHeight / z];
    const local = intersect(r, [0, 0, p.w, p.h]);
    if (!local) return null;
    const ox = p.ox || 0, oy = p.oy || 0;
    return [local[0] + ox, local[1] + oy, local[2] + ox, local[3] + oy];
  }

  scheduleUpdate() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.update(); });
  }

  update() {
    if (this.isBoard && !this._zAnim) this.growBoard();
    const [first, last] = this.visibleRange();
    if (last < first) return;
    const keepFrom = Math.max(0, first - 4), keepTo = Math.min(this.pages.length - 1, last + 4);
    for (const [i, v] of this.views) {
      if (i < keepFrom || i > keepTo || v.page !== this.pages[i]) { v.destroy(); this.views.delete(i); }
    }
    const from = Math.max(0, first - 2), to = Math.min(this.pages.length - 1, last + 2);
    const mid = this.scroller.scrollTop + this.scroller.clientHeight / 2;
    for (let i = from; i <= to; i++) {
      let v = this.views.get(i);
      if (!v) {
        v = new PageView(this, i);
        v.position();
        this.content.append(v.el);
        this.views.set(i, v);
        this.editor.renderObjects(v);
      }
      // While a zoom gesture is in progress, existing pages keep their
      // stretched bitmaps; only brand-new pages get rendered.
      if (this._sharpPending && v.bgScale) continue;
      const visible = i >= first && i <= last;
      const L = this.layout[i];
      const dist = Math.abs(L.y + L.h / 2 - mid);
      v.ensureBg(visible ? dist / 1e6 : 10 + dist / 1e6);
      v.drawInk();
    }
    // Page indicator = page covering the middle of the viewport.
    let cur = this.indexAtY(mid);
    if (cur > last) cur = last;
    if (cur !== this.currentIndex) {
      this.currentIndex = cur;
      this.onPageChange && this.onPageChange(cur);
    }
  }

  view(index) { return this.views.get(index); }
  viewById(pageId) {
    for (const v of this.views.values()) if (v.page.id === pageId) return v;
    return null;
  }

  invalidateInk(pageId) {
    const v = this.viewById(pageId);
    if (v) v.drawInk(true);
  }

  invalidateAll() {
    for (const v of this.views.values()) { v.bgScale = 0; v.ink.rect = null; v.paper.rect = null; }
    this.scheduleUpdate();
  }

  // Map client coordinates to a page and page (world) coordinates.
  hit(clientX, clientY, clampIndex = null) {
    const r = this.scroller.getBoundingClientRect();
    const cx = clientX - r.left + this.scroller.scrollLeft;
    const cy = clientY - r.top + this.scroller.scrollTop;
    let index = clampIndex;
    if (index === null) {
      index = this.indexAtY(cy);
      const L = this.layout[index];
      if (!L || cy < L.y - GAP / 2 || cy > L.y + L.h + GAP / 2 || cx < L.x || cx > L.x + L.w) return null;
    }
    const L = this.layout[index];
    const p = this.pages[index];
    return { index, page: p, x: (cx - L.x) / this.zoom + (p.ox || 0), y: (cy - L.y) / this.zoom + (p.oy || 0) };
  }

  // Client position of the page's world origin (0,0) – so that
  // (clientX - left) / zoom gives world coordinates.
  pageClientRect(index) {
    const r = this.scroller.getBoundingClientRect();
    const L = this.layout[index];
    const p = this.pages[index];
    return {
      left: r.left - this.scroller.scrollLeft + L.x - (p.ox || 0) * this.zoom,
      top: r.top - this.scroller.scrollTop + L.y - (p.oy || 0) * this.zoom,
      width: L.w, height: L.h,
    };
  }

  // ---------- zoom ----------
  onWheel(e) {
    if (e.altKey && this.onAltWheel) { e.preventDefault(); this.onAltWheel(e); return; }
    if (!(e.ctrlKey || e.metaKey)) { this.overscroll(e); return; }
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
    // Touchpad pinches send many tiny deltas: follow them directly. Mouse
    // wheel notches are animated.
    const smooth = Math.abs(e.deltaY) >= 40 || e.deltaMode === 1;
    this.zoomTo(this.zoomTarget() * factor, e.clientX, e.clientY, smooth);
  }

  // Scrolling on past the end: fill the ring around "+" over 2 s, then add a page.
  overscroll(e) {
    if (!this.endZone || e.deltaY <= 0) { this.resetOverscroll(); return; }
    const s = this.scroller;
    if (s.scrollTop < s.scrollHeight - s.clientHeight - 2) { this.resetOverscroll(); return; }
    this.pullPastEnd();
  }

  pullPastEnd() {
    if (!this.endZone || this._addingPage) return;
    const now = performance.now();
    if (!this._over) this._over = { start: now };
    clearTimeout(this._overIdle);
    this._overIdle = setTimeout(() => this.resetOverscroll(), 350); // stopped scrolling
    const p = Math.min(1, (now - this._over.start) / OVERSCROLL_MS);
    this.endZone.classList.add('charging');
    this.endZone.style.setProperty('--p', String(p));
    if (p >= 1) {
      this.resetOverscroll();
      // one page per gesture: ignore the rest of this scroll / pull for a moment
      this._addingPage = true;
      setTimeout(() => { this._addingPage = false; }, 700);
      this.editor.appendPage();
    }
  }

  resetOverscroll() {
    this._over = null;
    clearTimeout(this._overIdle);
    if (this.endZone) { this.endZone.classList.remove('charging'); this.endZone.style.setProperty('--p', '0'); }
  }

  zoomTarget() { return this._zAnim ? this._zAnim.target : this.zoom; }

  // Smooth zoom: ease towards the target, keeping (clientX, clientY) fixed.
  zoomTo(z, clientX, clientY, animate = true) {
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (!animate) { this._zAnim = null; this.setZoom(z, clientX, clientY); return; }
    const r = this.scroller.getBoundingClientRect();
    if (clientX === undefined) { clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; }
    const running = !!this._zAnim;
    this._zAnim = { target: z, x: clientX, y: clientY };
    if (running) return;
    const step = () => {
      const a = this._zAnim;
      if (!a) return;
      const ratio = a.target / this.zoom;
      if (Math.abs(Math.log(ratio)) < 0.004) {
        this._zAnim = null;
        this.setZoom(a.target, a.x, a.y);
        if (this.isBoard) this.scheduleUpdate();
        return;
      }
      this.setZoom(this.zoom * Math.pow(ratio, 0.32), a.x, a.y);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setZoom(z, clientX, clientY, keepFit = false) {
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (Math.abs(z - this.zoom) < 1e-5 && this.layout.length) return;
    if (!keepFit) this.fitMode = false;
    const r = this.scroller.getBoundingClientRect();
    if (clientX === undefined) { clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; }
    // Keep the point under the cursor fixed.
    const anchor = this.hit(clientX, clientY, this.indexAtY(clientY - r.top + this.scroller.scrollTop));
    this.zoom = z;
    this.computeLayout();
    if (anchor) {
      const L = this.layout[anchor.index];
      const p = this.pages[anchor.index];
      this.scroller.scrollLeft = L.x + (anchor.x - (p.ox || 0)) * z - (clientX - r.left);
      this.scroller.scrollTop = L.y + (anchor.y - (p.oy || 0)) * z - (clientY - r.top);
    }
    this.scheduleUpdate();
    this.onZoomChange && this.onZoomChange(z);
    // Re-render sharply once zooming pauses (stretched bitmaps meanwhile).
    clearTimeout(this._zoomTimer);
    for (const v of this.views.values()) v.cancelBg();
    this._sharpPending = true;
    this._zoomTimer = setTimeout(() => {
      if (this._zAnim) return;
      this._sharpPending = false;
      this.update();
    }, 160);
  }

  fitWidth(silent) {
    if (this.isBoard) return this.zoomTo(1);
    const vw = this.scroller.clientWidth || 800;
    const maxW = Math.max(...this.pages.map((p) => p.w), 1);
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (vw - GAP * 2) / maxW));
    if (this.fitMode && this.layout.length && Math.abs(z - this.zoom) < 1e-4) {
      // Height-only resize (e.g. the options bar changed): just re-centre.
      // No re-render and no zoom event – that would drop the selection.
      this.computeLayout();
      this.scheduleUpdate();
      return;
    }
    const idx = this.currentIndex;
    const L = this.layout[idx];
    const frac = L ? (this.scroller.scrollTop - L.y) / L.h : 0;
    this._zAnim = null;
    this.zoom = z;
    this.fitMode = true;
    this.computeLayout();
    const L2 = this.layout[idx];
    if (L2) this.scroller.scrollTop = L2.y + frac * L2.h;
    this.invalidateAll();
    this.onZoomChange && this.onZoomChange(z);
  }

  // Board: centre the view on a world point.
  centerOn(x, y) {
    const p = this.pages[0];
    this.scroller.scrollLeft = (x - p.ox) * this.zoom - this.scroller.clientWidth / 2;
    this.scroller.scrollTop = (y - p.oy) * this.zoom - this.scroller.clientHeight / 2;
    this.scheduleUpdate();
  }

  scrollToPage(index, yPage = null, smooth = false) {
    if (this.isBoard) {
      if (yPage !== null) this.centerOn(this.pages[0].ox + this.pages[0].w / 2, yPage);
      return;
    }
    const L = this.layout[Math.max(0, Math.min(index, this.layout.length - 1))];
    if (!L) return;
    const top = yPage === null ? L.y - GAP / 2 : L.y + yPage * this.zoom - this.scroller.clientHeight / 3;
    this.scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    this.scheduleUpdate();
  }

  // Highlight a rect (page units) briefly, e.g. for a search hit.
  flash(index, rects) {
    const v = this.view(index);
    if (!v) return;
    for (const [x, y, w, hh] of rects) {
      const el = h('div', { class: 'flash', style: {
        left: (x - v.ox) * this.zoom + 'px', top: (y - v.oy) * this.zoom + 'px', width: w * this.zoom + 'px', height: hh * this.zoom + 'px',
      } });
      v.overlay.append(el);
      setTimeout(() => el.remove(), 2600);
    }
  }

  destroy() {
    this.resizeObs.disconnect();
    this._zAnim = null;
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.cache.clear();
    this.scroller.remove();
  }
}
