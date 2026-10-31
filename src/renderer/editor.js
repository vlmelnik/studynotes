// Notebook editor: toolbar, options bar, page sidebar, viewer, tools,
// undo/redo, autosave. Text boxes, pictures, tables, paste and insert live in
// editor-objects.js; thumbnails and search in editor-panels.js.
import { h, iconButton, showMenu, closeMenu, promptDialog, confirmDialog, toast, debounce, parseRange, shortcutKey } from './ui.js';
import { icon } from './icons.js';
import { Viewer, MIN_ZOOM, MAX_ZOOM } from './viewer.js';
import { Tools, uid, textBBox, itemBBox } from './tools.js';
import { Thumbs, SearchPanel } from './editor-panels.js';
import { objectsMixin } from './editor-objects.js';
import { TextBar, sizeControl, TEXT_SIZES } from './textbar.js';
import { loadFormFields, signatureDialog, fillBar } from './fill-sign.js';
import { PdfDoc, isCancel, Util } from './pdfdoc.js';
import { normalize, fold } from '../main/search.js';
import { round2, BOX_SHAPES, LINE_SHAPES, mapCuts } from '../shared/geometry.js';
import { PAPERS, PAGE_SIZES } from '../shared/paper.js';
import { templatePicker } from './template-picker.js';
import { PEN_STYLES } from '../shared/ink.js';
import { FONTS } from '../shared/fonts.js';

const EMPTY = Object.freeze({ strokes: Object.freeze([]), texts: Object.freeze([]), items: Object.freeze([]) });
const UNDO_LIMIT = 300;

export const PALETTE = [
  '#1c1c1e', '#5b5b60', '#9a9a9f', '#ffffff', '#8b5a2b', '#d62828', '#e07a10', '#f2c200',
  '#7cb518', '#178f45', '#0f8fa8', '#2b9de9', '#1a4fd6', '#1d2f6f', '#7b3fbf', '#e0559a',
];
export const NEON_PALETTE = ['#39ff14', '#ff073a', '#00f0ff', '#fff01f', '#ff2ef0', '#ff9e00', '#bc13fe', '#1f51ff'];
export const HL_PALETTE = ['#ffe14d', '#8ef07a', '#ff9ccf', '#7fd3ff', '#ffb36b', '#c9a7ff', '#a6f0e8', '#ffd1a3'];
const PEN_SIZES = [0.8, 1.2, 2, 3.5, 6];
const HL_SIZES = [8, 14, 22];
const ERASER_SIZES = [10, 22, 44];
// Size lists for the size field (▾ / ▲▼); any number up to the maximum can be typed.
export const SIZE_LISTS = {
  pen: { list: [0.5, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60], min: 0.2, max: 60, title: 'Pen size (pt) – type any number' },
  hl: { list: [4, 6, 8, 10, 12, 14, 16, 18, 22, 26, 30, 36, 44, 52, 60, 80, 100, 120], min: 2, max: 120, title: 'Highlighter size (pt) – type any number' },
  eraser: { list: [6, 10, 14, 18, 22, 30, 44, 60, 80, 100, 150, 200, 300], min: 4, max: 300, title: 'Eraser size (px) – type any number' },
};
const SHAPE_ICONS = {
  line: 'line', arrow: 'arrow', darrow: 'darrow', rect: 'rect', roundrect: 'roundrect', ellipse: 'ellipse', triangle: 'triangle',
  rtriangle: 'rtriangle', diamond: 'diamond', pentagon: 'pentagon', hexagon: 'hexagon', star: 'starShape', parallelogram: 'parallelogram',
  bubble: 'bubble', cross: 'cross', cylinder: 'cylinder', axes: 'axes',
};
const SHAPE_LABELS = {
  line: 'Line', arrow: 'Arrow', darrow: 'Double arrow', rect: 'Rectangle', roundrect: 'Rounded rectangle', ellipse: 'Ellipse / circle',
  triangle: 'Triangle', rtriangle: 'Right triangle', diamond: 'Diamond', pentagon: 'Pentagon', hexagon: 'Hexagon', star: 'Star',
  parallelogram: 'Parallelogram', bubble: 'Speech bubble', cross: 'Cross', cylinder: 'Cylinder', axes: 'Coordinate axes',
};

export function defaultToolState() {
  return {
    tool: 'pen',
    pen: { color: PALETTE[0], size: 2, style: 'ball' },
    hl: { color: HL_PALETTE[0], size: HL_SIZES[1], straight: true },
    eraser: { mode: 'partial', size: ERASER_SIZES[1], hlOnly: false, exact: false, objects: false },
    shape: { kind: 'rect' },
    text: { size: 14, ff: 'carlito', b: false, i: false, u: false },
    laser: { color: '#ff2d2d', mode: 'trail' },
  };
}

export class Editor {
  constructor(app, doc) {
    this.app = app;
    this.doc = doc; // { rel, nb, pdfs: Map, pages: {id: data}, textIndexes: {src: index} }
    this.settings = app.settings;
    this.toolState = app.toolState;
    this.palette = PALETTE;
    this.undoStack = [];
    this.redoStack = [];
    this.dirtyPages = new Set();
    this.nbDirty = false;
    this.saving = Promise.resolve();
    // Saved ~0.4 s after the last change, at the latest 2 s after the first one.
    this.saveSoon = debounce(() => this.save(), 400, 2000);
    this.textEdit = null;
    this.cellEdit = null;
    this.destroyed = false;
    this._redrawPages = new Set();
    this.pdfLoading = new Map();
    this.images = new Map();

    this.el = h('div', { class: `editor${this.isBoard ? ' is-board' : ''}` });
    this.buildToolbar();
    this.body = h('div', { class: 'editor-body' });
    this.sidebar = new Thumbs(this);
    this.viewerHost = h('div', { class: 'viewer-host' });
    this.pageBadge = h('div', { class: 'page-badge' });
    this.zoomPill = this.buildZoomPill();
    this.textBar = new TextBar(this);
    this.viewerHost.append(this.pageBadge, this.optionsBar, this.zoomPill);
    // Endless board: always a way back to your notes.
    if (this.isBoard) {
      this.viewerHost.append(h('button', { class: 'board-center', title: 'Back to the centre of your notes', html: icon('center', 20), onclick: () => this.backToCenter() }));
    }
    this.textBar.mount(this.viewerHost);
    this.searchPanel = new SearchPanel(this);
    this.body.append(this.sidebar.el, this.viewerHost, this.searchPanel.el);
    this.el.append(this.topbar, this.body);

    this.viewer = new Viewer(this);
    this.viewer.onAltWheel = (e) => this.altWheel(e);
    this.viewer.onPageChange = (i) => this.onPageChange(i);
    this.viewer.onZoomChange = (z) => this.onZoomChange(z);
    this.tools = new Tools(this);
    this.viewer.scroller.addEventListener('scroll', () => this.textBar.schedulePosition(), { passive: true });
    // Show the style of the words under the cursor while editing text.
    this._onSelChange = () => {
      if (!this.textEdit || this.destroyed) return;
      const a = document.activeElement;
      if (a && a.closest && a.closest('.text-bar, .tool-options')) return;
      cancelAnimationFrame(this._selRaf);
      this._selRaf = requestAnimationFrame(() => this.textBar.update());
    };
    document.addEventListener('selectionchange', this._onSelChange);
    // Format painter: after picking it up, the next selected text (words in a
    // box, or whole boxes) gets that style.
    // It only arms with the next press outside the text bar, so the click that
    // picked the style up can't paint it straight back onto its source.
    this._onPaintDown = (e) => {
      this._paintArmed = !!this.formatPainter && !(e.target.closest && e.target.closest('.text-bar'));
    };
    this._onPaintUp = () => setTimeout(() => {
      const st = this.formatPainter;
      if (!st || this.destroyed || !this._paintArmed) return;
      const te = this.textEdit;
      const el = te && this.viewer.viewById(te.pageId)?.el.querySelector(`.textbox[data-id="${te.id}"]`);
      const ready = (el && this.textRangeIn(el)) || (this.tools.sel && this.tools.sel.textIds.size);
      if (!ready) return;
      this.formatPainter = null;
      this.el.classList.remove('painting');
      this.applyTextStyle(st);
      this.textBar.update();
    }, 0);
    window.addEventListener('pointerdown', this._onPaintDown, true);
    window.addEventListener('pointerup', this._onPaintUp, true);
    this.setTool(this.toolState.tool, true);
    if (this.settings.sidebarHidden || this.isBoard) this.el.classList.add('no-sidebar');
    this.installDrop();
  }

  get isBoard() { return this.doc.nb.kind === 'board'; }
  // A PDF file from the computer opened with StudyNotes (notes are written into it).
  get isExternal() { return this.rel.startsWith('.external/'); }

  // Called by App after the element is in the DOM.
  mount() {
    this.viewer.mount(this.viewerHost);
    loadFormFields(this);
    if (this.fillMode) this.viewerHost.append(fillBar(this));
    const vs = this.doc.nb.view || {};
    if (this.isBoard) {
      this.viewer.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vs.zoom || 1));
      this.viewer.computeLayout();
      this.onZoomChange(this.viewer.zoom);
      const c = vs.cx != null ? [vs.cx, vs.cy] : this.boardContentCenter();
      this.viewer.centerOn(c[0], c[1]);
    } else {
      if (vs.zoom && !vs.fit) {
        this.viewer.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vs.zoom));
        this.viewer.computeLayout();
        this.onZoomChange(this.viewer.zoom);
      } else {
        this.viewer.fitWidth();
      }
      this.sidebar.build();
      const start = this.doc.startPage ?? vs.page ?? 0;
      this.viewer.scrollToPage(start, this.doc.startPage != null ? null : (vs.y ?? null));
      if (vs.y != null && this.doc.startPage == null) {
        const L = this.viewer.layout[start];
        if (L) this.viewer.scroller.scrollTop = L.y + vs.y * this.viewer.zoom;
      }
    }
    this.viewer.update();
    this.onPageChange(this.viewer.currentIndex);
    for (const src of Object.keys(this.doc.nb.sources || {})) this.startIndexing(src);
    this.viewer.scroller.focus({ preventScroll: true });
    this._mounted = true;
    if (this.doc.nb.newerVersion) {
      toast('This notebook was saved by a newer StudyNotes version. Unknown content is kept but may not be shown.', { timeout: 8000 });
    }
  }

  // Alt + mouse wheel: resize what is selected; otherwise the size of the
  // current tool (pen, highlighter, eraser) or of the text being written.
  altWheel(e) {
    this._altAcc = (this._altAcc || 0) + (e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY);
    if (Math.abs(this._altAcc) < 40) return;
    const dir = this._altAcc < 0 ? 1 : -1;
    this._altAcc = 0;
    if (this.tools.sel) { this.tools.scaleSelectionBy(dir > 0 ? 1.08 : 1 / 1.08); return; }
    const ts = this.toolState;
    // next listed size; beyond the list (a typed 120 pt, say) the size stays
    const pick = (list, cur) => (dir > 0
      ? (list.find((v) => v > cur + 0.01) ?? cur)
      : ([...list].reverse().find((v) => v < cur - 0.01) ?? cur));
    if (this.textEdit || ts.tool === 'text') {
      const n = pick(TEXT_SIZES, ts.text.size);
      if (n !== ts.text.size) this.applyTextStyle({ size: n });
      return;
    }
    const kind = ts.tool === 'shape' ? 'pen' : ts.tool;
    const L = SIZE_LISTS[kind];
    if (!L) return;
    ts[kind].size = pick(L.list, ts[kind].size);
    this.renderOptions();
    this.app.saveToolState();
    this.toast(`Size ${ts[kind].size}${kind === 'eraser' ? ' px' : ''}`);
  }

  backToCenter() {
    const [cx, cy] = this.boardContentCenter();
    this.viewer.zoomTo(1, undefined, undefined, false);
    this.viewer.centerOn(cx, cy);
  }

  boardContentCenter() {
    const d = this.pageData(this.pages[0].id);
    let b = null;
    const add = (q) => { b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] : q.slice(); };
    for (const st of d.strokes) { const p = st.p; for (let i = 0; i < p.length; i += 3) add([p[i], p[i + 1], p[i], p[i + 1]]); }
    for (const t of d.texts) add(textBBox(t));
    for (const it of d.items) add(itemBBox(it));
    return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
  }

  // When a tab becomes active again.
  activate() {
    this.viewer.computeLayout();
    this.viewer.scheduleUpdate();
    this.viewer.scroller.focus({ preventScroll: true });
  }

  get rel() { return this.doc.rel; }
  get pages() { return this.doc.nb.pages; }

  // ---------- PDFs (a notebook can contain pages of several PDFs) ----------
  pdfFor(src = 'main') {
    const ready = this.doc.pdfs.get(src);
    if (ready) return ready;
    if (!this.pdfLoading.has(src)) {
      const s = this.doc.nb.sources && this.doc.nb.sources[src];
      if (!s) return null;
      const p = PdfDoc.open(this.rel, s.file).then((pdf) => {
        if (this.destroyed) { pdf.destroy(); return; }
        this.doc.pdfs.set(src, pdf);
        this.viewer.scheduleUpdate();
        this.sidebar.refreshMissing();
      }, (err) => {
        console.error(err);
        toast(`Could not open the PDF "${s.name || src}": ${err.message}`, { error: true });
      });
      this.pdfLoading.set(src, p);
    }
    return null;
  }

  // ---------- data ----------
  pageData(pageId) {
    return this.doc.pages[pageId] || EMPTY;
  }

  setPageData(pageId, data, { redraw = 'now', texts } = {}) {
    const prev = this.pageData(pageId);
    if (!data.items) data = { ...data, items: [] };
    this.doc.pages[pageId] = data;
    this.markDirty(pageId);
    if (redraw === 'frame') {
      this._redrawPages.add(pageId);
      if (!this._redrawRaf) {
        this._redrawRaf = requestAnimationFrame(() => {
          this._redrawRaf = 0;
          for (const id of this._redrawPages) this.viewer.invalidateInk(id);
          this._redrawPages.clear();
        });
      }
    } else if (redraw === 'now') {
      this.viewer.invalidateInk(pageId);
    }
    const v = this.viewer.viewById(pageId);
    if (v && ((texts !== false && prev.texts !== data.texts) || prev.items !== data.items)) this.renderObjects(v);
    this.sidebar.invalidate(pageId);
  }

  pushUndo(pageId, before, after, fromTextEdit = false) {
    // Close an open text edit first so history stays in order.
    if (!fromTextEdit) this.finishEditing();
    this.undoStack.push({ pageId, before, after });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.updateUndoButtons();
  }

  commit(pageId, before, after) {
    this.pushUndo(pageId, before, after);
    this.setPageData(pageId, after);
  }

  addStroke(pageId, st) {
    this.finishEditing();
    const before = this.pageData(pageId);
    const after = { ...before, strokes: before.strokes.concat([st]) };
    this.pushUndo(pageId, before, after);
    this.doc.pages[pageId] = after;
    this.markDirty(pageId);
    const v = this.viewer.viewById(pageId);
    if (v) v.addStroke(st);
    this.sidebar.invalidate(pageId);
  }

  addStrokes(pageId, strokes) {
    const before = this.pageData(pageId);
    this.commit(pageId, before, { ...before, strokes: before.strokes.concat(strokes) });
  }

  markDirty(pageId) {
    if (pageId) this.dirtyPages.add(pageId);
    this.nbDirty = true;
    this.setSaveState('dirty');
    this.saveSoon();
  }

  onBoardResized() {
    this.nbDirty = true;
    this.saveSoon();
  }

  undo() {
    if (this.destroyed || this.tools.cur) return; // not in the middle of a gesture
    this.finishEditing();
    this.tools.clearSelection();
    const e = this.undoStack.pop();
    if (!e) return;
    this.redoStack.push(e);
    this.applyHistory(e, 'before');
  }

  redo() {
    if (this.destroyed || this.tools.cur) return;
    this.finishEditing();
    this.tools.clearSelection();
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push(e);
    this.applyHistory(e, 'after');
  }

  applyHistory(e, which) {
    if (e.kind === 'pages') {
      if (e.sources) this.doc.nb.sources = e.sources[which];
      if (e.data) { this.doc.pages[e.data.pageId] = e.data[which]; this.dirtyPages.add(e.data.pageId); }
      this.applyPages(e[which]);
      if (e.focus != null) this.viewer.scrollToPage(Math.min(e.focus, this.pages.length - 1));
    } else {
      this.setPageData(e.pageId, e[which]);
      const idx = this.pages.findIndex((p) => p.id === e.pageId);
      const [first, last] = this.viewer.visibleRange();
      if (idx >= 0 && (idx < first || idx > last)) this.viewer.scrollToPage(idx);
    }
    this.updateUndoButtons();
  }

  // ---------- saving ----------
  setSaveState(s) {
    if (!this.saveEl) return;
    this.saveEl.dataset.state = s;
    this.saveEl.title = s === 'saved' ? 'All changes saved' : s === 'error' ? 'Saving failed – will retry' : 'Saving…';
  }

  // Closing the app: after the final save nothing more is written (the sync
  // that follows may bring newer files from the other PC).
  freezeSaves() {
    this.saveSoon.cancel();
    this.savesFrozen = true;
  }

  save() {
    if (this.savesFrozen) return this.saving;
    this.saving = this.saving.then(() => this._save()).then(() => { this.lastSaveError = null; }, (err) => {
      console.error(err);
      this.lastSaveError = err;
      this.setSaveState('error');
      toast('Could not save: ' + err.message, { error: true });
      if (!this.destroyed) this.saveSoon();
    });
    return this.saving;
  }

  async _save() {
    const ids = [...this.dirtyPages];
    this.dirtyPages.clear();
    const nbDirty = this.nbDirty;
    this.nbDirty = false;
    if (!ids.length && !nbDirty) { this.setSaveState('saved'); return; }
    this.setSaveState('saving');
    try {
      for (const id of ids) {
        // The whole object is written, so fields from newer versions survive.
        await window.api.writePage(this.rel, id, this.pageData(id));
      }
      this.recordView();
      await window.api.writeNotebook(this.rel, this.doc.nb);
    } catch (err) {
      for (const id of ids) this.dirtyPages.add(id);
      this.nbDirty = true;
      throw err;
    }
    if (!this.dirtyPages.size && !this.nbDirty) this.setSaveState('saved');
  }

  recordView() {
    if (!this.viewer.layout.length) return;
    if (this.isBoard) {
      const s = this.viewer.scroller, p = this.pages[0], z = this.viewer.zoom;
      this.doc.nb.view = {
        zoom: round2(z * 1000) / 1000,
        cx: round2((s.scrollLeft + s.clientWidth / 2) / z + p.ox),
        cy: round2((s.scrollTop + s.clientHeight / 2) / z + p.oy),
      };
      return;
    }
    const i = this.viewer.currentIndex;
    const L = this.viewer.layout[i];
    this.doc.nb.view = {
      page: i,
      y: L ? round2((this.viewer.scroller.scrollTop - L.y) / this.viewer.zoom) : 0,
      zoom: round2(this.viewer.zoom * 1000) / 1000,
      fit: !!this.viewer.fitMode,
    };
  }

  // Saves everything; throws if something could not be written.
  async flush() {
    if (this.destroyed) return;
    this.finishEditing();
    this.saveSoon.cancel();
    this.nbDirty = true; // persist view position
    // Repeat while something (scroll position, a late edit) re-marked the
    // notebook dirty during the save; fail only on a real write error.
    for (let i = 0; i < 5; i++) {
      await this.save();
      this.saveSoon.cancel();
      if (this.lastSaveError) throw this.lastSaveError;
      if (!this.dirtyPages.size && !this.nbDirty) return;
    }
  }

  destroy() {
    this.destroyed = true;
    this.indexingStopped = true;
    this.tools.clearSelection(true);
    this.tools.laser.destroy();
    document.removeEventListener('selectionchange', this._onSelChange);
    window.removeEventListener('pointerup', this._onPaintUp, true);
    window.removeEventListener('pointerdown', this._onPaintDown, true);
    this.viewer.destroy();
    this.sidebar.destroy();
    this.el.remove();
    if (this._dropCleanup) this._dropCleanup();
  }

  // ---------- toolbar ----------
  // Blue bar with the tools in the middle (GoodNotes style). Tool options
  // live in a dark strip that floats under the bar (renderOptions).
  buildToolbar() {
    const tb = (this.topbar = h('div', { class: 'topbar' }));
    const left = h('div', { class: 'tb-left' },
      this.isBoard ? null : iconButton('sidebar', 'Pages (Ctrl+Shift+B)', () => this.toggleSidebar(), 'bar-btn'),
      iconButton('search', 'Search (Ctrl+F)', () => this.searchPanel.toggle(), 'bar-btn'),
      this.titleEl = h('button', { class: 'nb-title', title: 'Rename', onclick: () => this.rename() }, this.doc.nb.title),
      this.saveEl = h('span', { class: 'save-dot', dataset: { state: 'saved' } }));

    const toolBtn = (tool, ic, title) => h('button', {
      class: 'tool-btn', dataset: { tool }, title, 'aria-label': title, html: icon(ic, 24),
      onclick: () => this.setTool(tool),
    });
    this.toolButtons = [
      toolBtn('select', 'select', 'Select & move (V)'),
      toolBtn('lasso', 'lasso', 'Lasso (L)'),
      toolBtn('pen', 'pen', 'Pen (P)'),
      toolBtn('hl', 'highlighter', 'Highlighter (H)'),
      toolBtn('eraser', 'eraser', 'Eraser (E)'),
      toolBtn('text', 'text', 'Text (T)'),
      toolBtn('shape', 'shapes', 'Shapes (S)'),
      toolBtn('laser', 'laser', 'Laser pointer (K)'),
      toolBtn('hand', 'hand', 'Hand / pan (Space)'),
    ];
    const imageBtn = h('button', { class: 'tool-btn', title: 'Insert picture', 'aria-label': 'Insert picture', html: icon('image', 24), onclick: () => this.insertPictureDialog() });
    this.undoBtn = iconButton('undo', 'Undo (Ctrl+Z)', () => this.undo(), 'bar-btn');
    this.redoBtn = iconButton('redo', 'Redo (Ctrl+Y)', () => this.redo(), 'bar-btn');
    const center = h('div', { class: 'tb-center' }, ...this.toolButtons.slice(0, 7), imageBtn, ...this.toolButtons.slice(7));

    const right = h('div', { class: 'tb-right' },
      this.undoBtn, this.redoBtn, h('span', { class: 'tb-sep' }),
      iconButton('insert', 'Insert picture, table, PDF pages…', (e) => this.insertMenu(e.currentTarget), 'bar-btn'),
      this.isBoard ? null : h('div', { class: 'split-btn' },
        iconButton('addPage', 'Add a page after this one (same style)', () => this.addPageSameStyle(), 'bar-btn'),
        h('button', { class: 'bar-btn split-arrow', title: 'Choose page style / position', html: icon('chevronDown', 14), onclick: (e) => this.addPageMenu(e.currentTarget) })),
      this.isBoard ? null : iconButton('pageDelete', 'Delete this page (Ctrl+Z brings it back)', () => this.deletePage(this.viewer.currentIndex), 'bar-btn page-del'),
      iconButton('send', 'Send by e-mail or Telegram', (e) => this.sendMenu(e.currentTarget), 'bar-btn'),
      iconButton('export', 'Export PDF', (e) => this.exportMenu(e.currentTarget), 'bar-btn'),
      iconButton('more', 'More', (e) => this.moreMenu(e.currentTarget), 'bar-btn'));
    tb.append(left, center, right);

    this.optionsBar = h('div', { class: 'tool-options' });
    this.updateUndoButtons();
  }

  updateUndoButtons() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = !this.undoStack.length;
    this.redoBtn.disabled = !this.redoStack.length;
  }

  setTool(tool, initial = false) {
    if (!initial && tool !== 'lasso' && tool !== 'select') this.tools.clearSelection();
    if (tool !== 'text') this.finishEditing(true);
    this.toolState.tool = tool;
    for (const b of this.toolButtons) b.classList.toggle('active', b.dataset.tool === tool);
    this.el.dataset.tool = tool;
    this.viewer && this.viewer.scroller.querySelectorAll('.textbox').forEach((el) => this.setTextEditable(el));
    if (tool !== 'eraser') this.tools && this.tools.eraserCursor.remove();
    if (tool !== 'laser' && this.tools) this.tools.laser.hide();
    this.renderOptions();
    if (!initial) this.app.saveToolState();
  }

  // ---------- tool options (dark strip under the toolbar) ----------
  renderOptions() {
    const ts = this.toolState;
    const bar = this.optionsBar;
    bar.replaceChildren();
    const save = () => { this.renderOptions(); this.app.saveToolState(); };
    const group = (...c) => h('div', { class: 'opt-group' }, ...c.filter(Boolean));
    const sep = () => h('span', { class: 'opt-sep' });
    const ibtn = (ic, title, active, fn, cls = '') => h('button', {
      class: `opt-btn${active ? ' active' : ''} ${cls}`, title, 'aria-label': title, html: icon(ic, 22), onclick: fn,
    });
    // Line-width presets drawn as bars of the real thickness, then the size
    // field (type a number, ▾ list, ▲▼) like for text.
    const sizes = (list, current, onPick, k = 1, kind = 'pen') => group(
      ...list.map((sz, i) => h('button', {
        class: `opt-btn size${Math.abs(sz - current) < 1e-6 ? ' active' : ''}`, title: `Size ${i + 1}`,
        onclick: () => { onPick(sz); save(); },
      }, h('span', { class: 'size-bar', style: { height: Math.max(1.5, Math.min(14, sz * k)) + 'px' } }))),
      sizeControl(current, (v) => { onPick(v); save(); }, 'opt-size tool-size', SIZE_LISTS[kind]));
    // Quick colours: current + recent + a few defaults, and "+" for everything else.
    const swatches = (current, onPick, base = PALETTE) => {
      const list = [];
      for (const c of [current, ...(this.settings.recentColors || []), ...base]) {
        if (!list.includes(c)) list.push(c);
        if (list.length === 5) break;
      }
      return group(...list.map((c) => h('button', {
        class: `opt-swatch${c.toLowerCase() === String(current).toLowerCase() ? ' active' : ''}`,
        style: { background: c }, title: c, onclick: () => { onPick(c); this.rememberColor(c); save(); },
      })), h('button', {
        class: 'opt-swatch add', title: 'More colours', html: icon('plus', 16),
        onclick: (e) => this.textBar.colorMenu(e.currentTarget, (c) => { onPick(c); save(); }),
      }));
    };

    switch (ts.tool) {
      case 'pen': {
        const neon = ts.pen.style === 'neon';
        const typeIcon = { ball: 'pBall', fountain: 'pFountain', pencil: 'pPencil', marker: 'pMarker', brush: 'pBrush', neon: 'pNeon' };
        bar.append(
          group(...Object.entries(PEN_STYLES).map(([k, v]) => ibtn(typeIcon[k] || 'pen', v.label, (ts.pen.style || 'ball') === k, () => { ts.pen.style = k; save(); }))),
          sep(), sizes(PEN_SIZES, ts.pen.size, (sz) => { ts.pen.size = sz; }, 1.6),
          sep(), swatches(ts.pen.color, (c) => { ts.pen.color = c; }, neon ? NEON_PALETTE : PALETTE),
          sep(), this.favoritesStrip('pen'),
          ibtn('shapes', 'Draw & hold → clean shape', this.settings.shapeHold, () => { this.settings.shapeHold = !this.settings.shapeHold; this.app.saveSettings(); save(); }));
        break;
      }
      case 'hl':
        bar.append(sizes(HL_SIZES, ts.hl.size, (sz) => { ts.hl.size = sz; }, 0.55, 'hl'),
          sep(), swatches(ts.hl.color, (c) => { ts.hl.color = c; }, HL_PALETTE),
          sep(), this.favoritesStrip('hl'),
          ibtn('line', 'Straight lines', ts.hl.straight, () => { ts.hl.straight = !ts.hl.straight; save(); }),
          h('button', { class: `opt-chip${ts.hl.snap !== false ? ' active' : ''}`, title: 'On printed PDF text the highlighter follows the text lines', onclick: () => { ts.hl.snap = ts.hl.snap === false; save(); } }, 'Snap to text'));
        break;
      case 'eraser':
        bar.append(
          group(h('button', { class: `opt-chip${ts.eraser.mode === 'partial' ? ' active' : ''}`, onclick: () => { ts.eraser.mode = 'partial'; save(); } }, 'Partial'),
            h('button', { class: `opt-chip${ts.eraser.mode === 'stroke' ? ' active' : ''}`, onclick: () => { ts.eraser.mode = 'stroke'; save(); } }, 'Whole stroke')),
          sep(), sizes(ERASER_SIZES, ts.eraser.size, (sz) => { ts.eraser.size = sz; }, 0.3, 'eraser'),
          ts.eraser.mode === 'partial' ? h('button', { class: `opt-chip${ts.eraser.exact ? ' active' : ''}`, title: 'Erase exactly the circle of the eraser', onclick: () => { ts.eraser.exact = !ts.eraser.exact; save(); } }, 'Exact circle') : '',
          sep(), h('button', { class: `opt-chip${ts.eraser.hlOnly ? ' active' : ''}`, onclick: () => { ts.eraser.hlOnly = !ts.eraser.hlOnly; if (ts.eraser.hlOnly) ts.eraser.objects = false; save(); } }, 'Highlighter only'),
          h('button', { class: `opt-chip${ts.eraser.objects ? ' active' : ''}`, title: 'Also erase text boxes and pictures you touch', onclick: () => { ts.eraser.objects = !ts.eraser.objects; if (ts.eraser.objects) ts.eraser.hlOnly = false; save(); } }, 'Text & pictures too'),
          h('button', { class: 'opt-chip', onclick: () => this.clearPage() }, this.isBoard ? 'Clear board' : 'Clear page'));
        break;
      case 'shape': {
        const kind = ts.shape.kind;
        const quick = ['line', 'arrow', 'rect', 'roundrect', 'ellipse', 'triangle'];
        bar.append(
          group(...quick.map((k) => ibtn(SHAPE_ICONS[k], SHAPE_LABELS[k], k === kind, () => { ts.shape.kind = k; save(); })),
            ibtn(quick.includes(kind) ? 'more' : SHAPE_ICONS[kind], quick.includes(kind) ? 'More shapes' : SHAPE_LABELS[kind], !quick.includes(kind), (e) => this.shapeMenu(e.currentTarget))),
          sep(), sizes(PEN_SIZES, ts.pen.size, (sz) => { ts.pen.size = sz; }, 1.6),
          sep(), swatches(ts.pen.color, (c) => { ts.pen.color = c; }),
          sep(), h('button', {
            class: 'opt-chip fill-chip' + (ts.shape.fill ? ' active' : ''), title: 'Fill the inside of new shapes',
            onclick: (e) => this.fillMenu(e.currentTarget, ts.shape.fill || null, (f) => { ts.shape.fill = f; save(); }),
          }, h('span', { class: 'fill-prev' + (ts.shape.fill ? '' : ' none'), style: ts.shape.fill ? { background: ts.shape.fill } : {} }), 'Fill'));
        break;
      }
      case 'text': {
        const t = ts.text;
        const size = sizeControl(t.size, (n) => this.applyTextStyle({ size: n }), 'opt-size');
        const keep = (e) => e.preventDefault(); // keep the text selection
        const fmt = (key, label, title) => h('button', { class: `opt-btn fmt${t[key] ? ' active' : ''}`, title, onmousedown: keep, onclick: () => this.applyTextStyle({ [key]: !t[key] }), html: label });
        bar.append(
          h('button', { class: 'opt-chip font', style: { fontFamily: `"${(FONTS[t.ff] || FONTS.carlito).css}"` }, onmousedown: keep,
            onclick: (e) => this.textBar.fontMenu(e.currentTarget, t.ff || 'carlito', (ff) => this.applyTextStyle({ ff })) }, (FONTS[t.ff] || FONTS.carlito).label),
          size, sep(),
          group(fmt('b', '<b>B</b>', 'Bold (Ctrl+B)'), fmt('i', '<i>I</i>', 'Italic (Ctrl+I)'), fmt('u', '<u>U</u>', 'Underline (Ctrl+U)')),
          sep(), swatches(ts.pen.color, (c) => { this.applyTextStyle({ color: c }); }));
        break;
      }
      case 'laser':
        bar.append(
        h('button', { class: `opt-chip${ts.laser.mode === 'dot' ? ' active' : ''}`, onclick: () => { ts.laser.mode = 'dot'; save(); } }, 'Dot'),
        h('button', { class: `opt-chip${ts.laser.mode !== 'dot' ? ' active' : ''}`, onclick: () => { ts.laser.mode = 'trail'; save(); } }, 'Trail'));
        break;
      default: break; // select, lasso, hand: no options → strip hidden
    }
    bar.classList.toggle('empty', !bar.childElementCount);
  }

  // Any pen size: slider and a number field.
  // Fill colour for shapes: none, quick colours, any colour; light tints too.
  fillMenu(anchor, current, pick) {
    const m = showMenu([], 0, 0, anchor);
    m.classList.add('dark-menu');
    const colors = ['#ffffff', '#fff6c8', '#ffd9cf', '#d9f2ff', '#dff7d6', '#efe3ff', '#ffff5c', '#b4ff52', '#f25a5a', '#2b9de9', '#3c4150', '#1c1c1e'];
    const done = (c) => { closeMenu(); if (c) this.rememberColor(c); pick(c); };
    m.append(h('div', { class: 'color-grid' },
      h('button', { class: 'swatch none' + (!current ? ' active' : ''), title: 'No fill', onclick: () => done(null) }),
      ...[...new Set([...(this.settings.recentColors || []).slice(0, 4), ...colors])].slice(0, 17).map((c) => h('button', {
        class: 'swatch' + (c === current ? ' active' : ''), style: { background: c }, title: c, onclick: () => done(c),
      })),
      h('label', { class: 'swatch custom', title: 'Any colour' }, h('input', { type: 'color', onchange: (e) => done(e.target.value) }))));
  }

  shapeMenu(anchor) {
    const menu = h('div', { class: 'shape-grid' }, ...LINE_SHAPES.concat(BOX_SHAPES).map((k) => h('button', {
      class: `icon-btn${k === this.toolState.shape.kind ? ' active' : ''}`, title: SHAPE_LABELS[k], html: icon(SHAPE_ICONS[k], 20),
      onclick: () => { this.toolState.shape.kind = k; this.renderOptions(); this.app.saveToolState(); menu.closest('.menu').remove(); },
    })));
    const m = showMenu([], 0, 0, anchor);
    m.append(menu);
  }

  // ---------- favourite & recent pens ----------
  penConfig(kind) {
    const ts = this.toolState;
    return kind === 'hl' ? { tool: 'hl', color: ts.hl.color, size: ts.hl.size } : { tool: 'pen', style: ts.pen.style || 'ball', color: ts.pen.color, size: ts.pen.size };
  }

  samePen(a, b) { return a.tool === b.tool && a.color === b.color && a.size === b.size && (a.style || '') === (b.style || ''); }

  applyPen(cfg) {
    const ts = this.toolState;
    if (cfg.tool === 'hl') Object.assign(ts.hl, { color: cfg.color, size: cfg.size });
    else Object.assign(ts.pen, { color: cfg.color, size: cfg.size, style: cfg.style || 'ball' });
    this.setTool(cfg.tool);
  }

  rememberPen(kind) {
    const cfg = this.penConfig(kind);
    const list = (this.settings.recentPens || []).filter((p) => !this.samePen(p, cfg));
    list.unshift(cfg);
    this.settings.recentPens = list.slice(0, 6);
    this.app.saveSettings();
  }

  rememberColor(c) {
    const list = (this.settings.recentColors || []).filter((x) => x !== c);
    list.unshift(c);
    this.settings.recentColors = list.slice(0, 8);
    this.app.saveSettings();
  }

  quickColors() {
    const out = [];
    for (const c of [this.toolState.pen.color, ...(this.settings.recentColors || []), '#1c1c1e', '#1a4fd6', '#d62828', '#178f45', '#e07a10']) {
      if (!out.includes(c)) out.push(c);
      if (out.length === 6) break;
    }
    return out;
  }

  favoritesStrip(kind) {
    const favs = (this.settings.favorites || []).filter((f) => f.tool === kind);
    const recent = (this.settings.recentPens || []).filter((r) => r.tool === kind && !favs.some((f) => this.samePen(f, r))).slice(0, 4);
    const cur = this.penConfig(kind);
    const chip = (cfg, fav) => h('button', {
      class: `pen-chip${this.samePen(cfg, cur) ? ' active' : ''}${fav ? ' fav' : ''}`,
      title: `${fav ? 'Favourite' : 'Recent'}: ${cfg.tool === 'hl' ? 'Highlighter' : (PEN_STYLES[cfg.style] || PEN_STYLES.ball).label}, size ${cfg.size}${fav ? ' (right-click to remove)' : ''}`,
      onclick: () => this.applyPen(cfg),
      oncontextmenu: (e) => {
        e.preventDefault();
        if (!fav) return;
        this.settings.favorites = (this.settings.favorites || []).filter((f) => !this.samePen(f, cfg));
        this.app.saveSettings();
        this.renderOptions();
      },
    }, h('span', { class: `pen-dot ${cfg.style || cfg.tool}`, style: { background: cfg.color, width: Math.min(16, 4 + cfg.size * (kind === 'hl' ? 0.5 : 2)) + 'px' } }));
    const isFav = favs.some((f) => this.samePen(f, cur));
    return h('div', { class: 'opt-group favs' },
      ...favs.map((f) => chip(f, true)),
      recent.length && favs.length ? h('span', { class: 'mini-sep' }) : null,
      ...recent.map((r) => chip(r, false)),
      h('button', {
        class: `icon-btn sm star${isFav ? ' active' : ''}`, title: isFav ? 'Already a favourite' : 'Save this pen as favourite',
        html: icon('star', 17),
        onclick: () => {
          if (isFav) return;
          this.settings.favorites = (this.settings.favorites || []).concat([cur]).slice(-12);
          this.app.saveSettings();
          this.renderOptions();
          toast('Pen saved to favourites', { timeout: 1200 });
        },
      }));
  }

  // Zoom % in the bottom-right corner: appears while zooming, then fades out.
  buildZoomPill() {
    const label = h('button', { class: 'zp-label', title: this.isBoard ? 'Reset zoom (Ctrl+0)' : 'Fit width (Ctrl+0)', onclick: () => this.viewer.fitWidth() }, '100%');
    const pill = h('div', { class: 'zoom-pill' },
      h('button', { class: 'zp-btn', title: 'Zoom out (Ctrl+-)', html: icon('minus', 16), onclick: () => this.viewer.zoomTo(this.viewer.zoomTarget() / 1.25) }),
      label,
      h('button', { class: 'zp-btn', title: 'Zoom in (Ctrl++)', html: icon('plus', 16), onclick: () => this.viewer.zoomTo(this.viewer.zoomTarget() * 1.25) }));
    this.zoomLabel = label;
    pill.addEventListener('pointerenter', () => { this._zoomHover = true; clearTimeout(this._zoomT); });
    pill.addEventListener('pointerleave', () => { this._zoomHover = false; this.showZoomPill(); });
    return pill;
  }

  showZoomPill() {
    this.zoomPill.classList.add('show');
    clearTimeout(this._zoomT);
    if (!this._zoomHover) this._zoomT = setTimeout(() => this.zoomPill.classList.remove('show'), 1600);
  }

  onZoomChange(z) {
    if (this.zoomLabel) this.zoomLabel.textContent = Math.round(z * 100) + '%';
    if (this._mounted) this.showZoomPill();
    if (this.tools && this.tools.sel) this.tools.clearSelection();
    if (this.textBar) this.textBar.schedulePosition();
    this.nbDirty = true;
    this.saveSoon();
  }

  onPageChange(i) {
    if (!this.isBoard) {
      this.pageBadge.textContent = `${i + 1} / ${this.pages.length}`;
      this.pageBadge.classList.add('show');
      clearTimeout(this._badgeT);
      this._badgeT = setTimeout(() => this.pageBadge.classList.remove('show'), 1400);
      this.sidebar.setActive(i);
    }
    this.nbDirty = true;
    this.saveSoon();
  }

  onSelectionChange() { if (this.textBar) this.textBar.update(); }
  toast(msg) { toast(msg, { timeout: 1200 }); }

  toggleSidebar() {
    if (this.isBoard) return;
    this.el.classList.toggle('no-sidebar');
    this.settings.sidebarHidden = this.el.classList.contains('no-sidebar');
    this.app.saveSettings();
  }

  async rename() {
    const name = await promptDialog('Rename notebook', this.doc.nb.title, { okLabel: 'Rename' });
    if (!name || name === this.doc.nb.title) return;
    await this.renameTo(name);
  }

  // Also used by the library when the notebook is open in a tab.
  async renameTo(name) {
    if (this.isExternal) { toast('This is a PDF file on your computer – rename it in Explorer.', { timeout: 4000 }); return; }
    try {
      await this.flush();
      // Run inside the save queue so no write can target the old path meanwhile.
      this.saving = this.saving.then(async () => {
        const renamed = await window.api.rename(this.rel, name);
        this.doc.rel = renamed;
        const nb = await window.api.readNotebook(renamed);
        this.doc.nb.title = nb.title;
      });
      await this.saving;
      this.titleEl.textContent = this.doc.nb.title;
      this.app.onEditorRenamed(this);
    } catch (err) {
      this.saving = Promise.resolve();
      toast(err.message, { error: true });
    }
  }

  // Style of a page for a new page next to it (a PDF page gives the
  // notebook's default paper in the same size).
  styleOf(p) {
    const nb = this.doc.nb;
    const def = { paper: nb.paperDefault && nb.paperDefault !== 'board' ? nb.paperDefault : 'blank', pc: nb.pcDefault };
    if (!p) return { ...def, w: 595.28, h: 841.89 };
    // A cover or a PDF page gives the notebook's normal paper in the same size.
    if (p.kind !== 'paper' || p.paper === 'cover') return { ...def, w: p.w, h: p.h };
    return { paper: p.paper, pc: p.pc, w: p.w, h: p.h };
  }

  addPageSameStyle(before = false) {
    const i = this.viewer.currentIndex;
    this.insertPage(i, this.styleOf(this.pages[i]), before ? 'before' : 'after');
  }

  // Last page reached and "+" clicked (or kept scrolling): new page at the end.
  appendPage() {
    const last = this.pages.length - 1;
    this.insertPage(last, this.styleOf(this.pages[last]), 'after');
  }

  addPageMenu(anchor) {
    const i = this.viewer.currentIndex;
    let where = 'after';
    const cur = this.styleOf(this.pages[i]).paper;
    const m = showMenu([], 0, 0, anchor);
    m.classList.add('addpage-menu');
    const pos = h('div', { class: 'addpage-pos' },
      ...[['before', 'Before this page'], ['after', 'After this page']].map(([k, l]) => h('button', {
        class: 'chip sm' + (k === where ? ' active' : ''), dataset: { where: k },
        onclick: (e) => { where = k; pos.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.where === k)); e.stopPropagation(); },
      }, l)));
    const base = this.styleOf(this.pages[i]);
    const list = h('div', { class: 'addpage-list' }, ...PAPERS.map(([k, label]) => h('button', {
      class: 'menu-item' + (k === cur ? ' checked' : ''),
      onclick: () => { closeMenu(); this.insertPage(i, { ...base, paper: k }, where); },
    }, h('span', { class: 'mi-icon', html: icon('page', 18) }), h('span', { class: 'mi-label' }, label + (k === cur ? ' (same as this page)' : '')))));
    const more = h('button', { class: 'menu-item', onclick: () => { closeMenu(); this.addPageFromPicker(where); } },
      h('span', { class: 'mi-icon', html: icon('templates', 18) }), h('span', { class: 'mi-label' }, 'More templates, colours, landscape…'));
    m.append(h('div', { class: 'menu-header' }, 'Add page'), pos, more, h('div', { class: 'menu-sep' }), list);
  }

  async addPageFromPicker(where = 'after') {
    const i = this.viewer.currentIndex;
    const s = this.styleOf(this.pages[i]);
    const r = await templatePicker({ mode: 'page', initial: { paper: s.paper, pc: s.pc || 'cream', landscape: s.w > s.h, where } });
    if (!r) return;
    let [w, hh] = PAGE_SIZES[r.size] || [s.w, s.h];
    if (r.landscape !== (w > hh)) [w, hh] = [hh, w];
    this.insertPage(i, { paper: r.paper, pc: r.pc, w, h: hh }, r.where);
  }

  insertMenu(anchor) {
    showMenu([
      { label: 'Picture…', icon: 'image', onClick: () => this.insertPictureDialog() },
      { label: 'Table…', icon: 'table', onClick: () => this.insertTableDialog() },
      { label: 'Signature…', icon: 'signature', onClick: () => signatureDialog(this) },
      { label: 'Text box', icon: 'text', onClick: () => this.setTool('text') },
      { label: 'Pages from a PDF…', icon: 'importPdf', onClick: () => this.insertPdfDialog() },
      'sep',
      { label: 'Paste (Ctrl+V)', icon: 'copy', onClick: () => this.pasteFromSystem() },
    ], 0, 0, anchor);
  }

  exportMenu(anchor) {
    showMenu(this.isBoard ? [
      { label: 'Export board as PDF…', icon: 'export', onClick: () => this.exportPages(null) },
    ] : [
      { label: 'Export notebook…', icon: 'export', onClick: () => this.exportPages(null) },
      { label: `Export current page (${this.viewer.currentIndex + 1})…`, icon: 'page', onClick: () => this.exportPages([this.pages[this.viewer.currentIndex].id]) },
      { label: 'Export page range…', icon: 'copy', onClick: () => this.exportRange() },
    ], 0, 0, anchor);
  }

  sendMenu(anchor) {
    const cur = this.pages[this.viewer.currentIndex];
    const pageLabel = `page ${this.viewer.currentIndex + 1}`;
    const items = [
      { header: 'E-mail (PDF attached)' },
      ...(this.isBoard ? [] : [{ label: `Current ${pageLabel}`, icon: 'mail', onClick: () => this.send('mail', [cur.id], pageLabel) }]),
      { label: this.isBoard ? 'Board' : 'Whole notebook', icon: 'mail', onClick: () => this.send('mail', null) },
      'sep',
      { header: 'Telegram' },
      ...(this.isBoard ? [] : [{ label: `Current ${pageLabel}`, icon: 'telegram', onClick: () => this.send('telegram', [cur.id], pageLabel) }]),
      { label: this.isBoard ? 'Board' : 'Whole notebook', icon: 'telegram', onClick: () => this.send('telegram', null) },
    ];
    showMenu(items, 0, 0, anchor);
  }

  async send(via, ids, label) {
    await this.flush();
    const t = toast('Preparing PDF…', { timeout: 60000 });
    try {
      const r = await window.api.send(this.rel, ids, via, label);
      t.remove();
      if (via === 'mail') {
        if (r.method === 'fallback') toast('No mail program found to attach to – a new e-mail opened and the PDF is shown in Explorer. Drag it into the e-mail.', { timeout: 9000 });
        else toast(`New e-mail opened in ${r.method === 'outlook' ? 'Outlook' : 'Thunderbird'} with the PDF attached`, { timeout: 4000 });
      } else if (r.copied) {
        toast('Telegram is opening – choose a chat and press Ctrl+V to send the PDF', { timeout: 9000 });
      } else {
        toast('Telegram is opening – drag the PDF from the Explorer window into the chat', { timeout: 9000 });
      }
    } catch (err) {
      t.remove();
      toast('Sending failed: ' + err.message, { error: true });
    }
  }

  async exportRange() {
    const v = await promptDialog('Export pages', `1-${this.pages.length}`, { label: 'Pages, e.g. 1-5, 8, 11-13', okLabel: 'Export' });
    if (!v) return;
    const nums = parseRange(v, this.pages.length);
    if (!nums) { toast('Invalid page range', { error: true }); return; }
    if (!nums.length) return;
    this.exportPages(nums.map((n) => this.pages[n - 1].id));
  }

  // Fill & sign "Save PDF": a PDF from the computer is saved into itself,
  // anything else is exported.
  async saveIntoPdf() {
    await this.flush();
    if (!this.isExternal) return this.exportPages(this.pages.map((p) => p.id));
    try { await window.api.extWrite(this.rel); toast('Saved into the PDF file', { timeout: 1500 }); } catch { /* error toast comes from the app */ }
  }

  async exportPages(ids) {
    await this.flush();
    const t = toast('Exporting…', { timeout: 60000 });
    try {
      const file = await window.api.exportPdf(this.rel, ids);
      t.remove();
      if (file) toast('Exported to ' + file);
    } catch (err) {
      t.remove();
      toast('Export failed: ' + err.message, { error: true });
    }
  }

  moreMenu(anchor) {
    const s = this.settings;
    showMenu([
      { label: this.isBoard ? 'Reset zoom' : 'Fit width', icon: 'fit', onClick: () => this.viewer.fitWidth() },
      { label: 'Actual size (100%)', icon: 'zoomIn', onClick: () => this.viewer.zoomTo(1) },
      'sep',
      ...(this.isBoard ? [] : (() => {
        const i = this.viewer.currentIndex;
        const p = this.pages[i];
        return [
          { header: `This page (${i + 1})` },
          { label: p.bm ? 'Remove bookmark' : 'Bookmark this page', icon: 'bookmark', onClick: () => this.toggleBookmark(i) },
          { label: 'Rotate page right 90°', icon: 'rotateR', onClick: () => this.rotatePage(i, 1) },
          { label: 'Rotate page left 90°', icon: 'rotateL', onClick: () => this.rotatePage(i, -1) },
          { label: 'Duplicate page', icon: 'duplicate', onClick: () => this.duplicatePage(i) },
          'sep',
          { label: 'Go to page…', icon: 'page', onClick: () => this.gotoPrompt() },
        ];
      })()),
      { label: s.mouseDraws ? 'Mouse draws: on' : 'Mouse draws: off', icon: 'pen', checked: s.mouseDraws, onClick: () => { s.mouseDraws = !s.mouseDraws; this.app.saveSettings(); toast(s.mouseDraws ? 'Mouse can draw' : 'Mouse scrolls, only the pen draws'); } },
      { label: s.pasteFormatting ? 'Paste keeps formatting: on' : 'Paste keeps formatting: off', icon: 'text', checked: s.pasteFormatting, onClick: () => { s.pasteFormatting = !s.pasteFormatting; this.app.saveSettings(); toast(s.pasteFormatting ? 'Pasted text keeps bold / italic / lists' : 'Text is pasted as plain text'); } },
      { label: document.documentElement.dataset.theme === 'dark' ? 'Dark mode: on' : 'Dark mode: off', icon: 'moon', checked: document.documentElement.dataset.theme === 'dark', onClick: () => this.app.toggleDark() },
      'sep',
      { label: 'Keyboard shortcuts', icon: 'more', onClick: () => this.app.showShortcuts() },
    ], 0, 0, anchor);
  }

  async gotoPrompt() {
    const v = await promptDialog('Go to page', String(this.viewer.currentIndex + 1), { okLabel: 'Go' });
    const n = parseInt(v, 10);
    if (n >= 1 && n <= this.pages.length) this.viewer.scrollToPage(n - 1);
  }

  async clearPage() {
    const page = this.pages[this.viewer.currentIndex];
    const before = this.pageData(page.id);
    if (!before.strokes.length && !before.texts.length && !before.items.length) return;
    const what = this.isBoard ? 'the board' : `page ${this.viewer.currentIndex + 1}`;
    if (!(await confirmDialog('Clear', `Remove all ink, text, pictures and tables from ${what}? You can undo this.`, { okLabel: 'Clear', danger: true }))) return;
    this.commit(page.id, before, { ...before, strokes: [], texts: [], items: [] });
  }

  // ---------- page structure ----------
  pushPagesUndo(before, after, focus, sources) {
    this.finishEditing();
    this.undoStack.push({ kind: 'pages', before, after, focus, sources });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    if (sources) this.doc.nb.sources = sources.after;
    this.applyPages(after);
    this.updateUndoButtons();
  }

  applyPages(arr) {
    this.tools.clearSelection(true);
    this.doc.nb.pages = arr;
    this.viewer.setPages(arr);
    this.sidebar.build();
    this.nbDirty = true;
    this.saveSoon();
    this.onPageChange(Math.min(this.viewer.currentIndex, arr.length - 1));
  }

  // style: paper name, or { paper, pc, w, h }
  insertPage(index, style, where = 'after') {
    const ref = this.pages[index] || this.pages[this.pages.length - 1];
    const s = typeof style === 'string' ? { paper: style } : style;
    const np = { id: uid(), kind: 'paper', paper: s.paper, w: s.w || (ref ? ref.w : 595.28), h: s.h || (ref ? ref.h : 841.89) };
    if (s.pc && s.pc !== 'cream') np.pc = s.pc;
    const at = where === 'before' ? index : index + 1;
    const before = this.pages;
    const after = before.slice();
    after.splice(at, 0, np);
    this.pushPagesUndo(before, after, at);
    this.viewer.scrollToPage(at, null, true);
  }

  // Turn a page by 90° (dir = 1 clockwise, -1 anticlockwise) with everything on it.
  rotatePage(index, dir = 1) {
    const p = this.pages[index];
    if (!p || p.kind === 'board') return;
    const W = p.w, H = p.h;
    // clockwise: (x, y) -> (H - y, x); anticlockwise: (x, y) -> (y, W - x)
    const pt = dir > 0 ? (x, y) => [H - y, x] : (x, y) => [y, W - x];
    const rect = (x, y, w, hh) => { // box keeps its own orientation; new top-left
      const [a, b] = pt(x, y), [c, d] = pt(x + w, y + hh);
      return [Math.min(a, c), Math.min(b, d)];
    };
    const d = this.pageData(p.id);
    const nd = {
      ...d,
      strokes: d.strokes.map((st) => {
        const q = st.p.slice();
        for (let i = 0; i < q.length; i += 3) { const [x, y] = pt(q[i], q[i + 1]); q[i] = round2(x); q[i + 1] = round2(y); }
        const n = { ...st, p: q };
        if (st.k) { n.k = mapCuts(st.k, pt); if (!n.k) delete n.k; } // eraser cuts turn with the ink
        return n;
      }),
      texts: d.texts.map((t) => { const [x, y] = rect(t.x, t.y, t.w, t.h || t.fs * 1.3); return { ...t, x: round2(x), y: round2(y) }; }),
      items: d.items.map((it) => {
        if (it.type === 'img') {
          const [cx, cy] = pt(it.x + it.w / 2, it.y + it.h / 2);
          const r = (((it.r || 0) + (dir > 0 ? 90 : 270)) % 360) || undefined;
          const n = { ...it, x: round2(cx - it.w / 2), y: round2(cy - it.h / 2), r };
          if (!r) delete n.r;
          return n;
        }
        const b = itemBBox(it);
        const [x, y] = rect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
        return { ...it, x: round2(x), y: round2(y) };
      }),
    };
    const rot = ((((p.rot || 0) + (dir > 0 ? 90 : 270)) % 360) + 360) % 360;
    const np = { ...p, w: H, h: W, rot };
    if (!rot) delete np.rot;
    const before = this.pages;
    const after = before.map((q, i) => (i === index ? np : q));
    this.finishEditing();
    this.undoStack.push({ kind: 'pages', before, after, focus: index, data: { pageId: p.id, before: d, after: nd } });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.doc.pages[p.id] = nd;
    this.dirtyPages.add(p.id);
    this.applyPages(after);
    this.updateUndoButtons();
    this.viewer.scrollToPage(index, null, true);
  }

  toggleBookmark(index) {
    const p = this.pages[index];
    if (!p) return;
    const np = { ...p };
    if (p.bm) delete np.bm; else np.bm = 1;
    const before = this.pages;
    this.pushPagesUndo(before, before.map((q, i) => (i === index ? np : q)), index);
    toast(np.bm ? `Page ${index + 1} bookmarked` : 'Bookmark removed', { timeout: 1200 });
  }

  duplicatePage(index) {
    const p = this.pages[index];
    const np = { ...p, id: uid() };
    delete np.bm; // the copy is not bookmarked
    const d = this.pageData(p.id);
    if (d.strokes.length || d.texts.length || d.items.length) {
      this.doc.pages[np.id] = {
        ...d,
        strokes: d.strokes.map((s) => ({ ...s, id: uid() })),
        texts: d.texts.map((t) => ({ ...t, id: uid() })),
        items: d.items.map((it) => ({ ...it, id: uid() })),
      };
      this.dirtyPages.add(np.id);
    }
    const before = this.pages;
    const after = before.slice();
    after.splice(index + 1, 0, np);
    this.pushPagesUndo(before, after, index + 1);
  }

  async deletePage(index) {
    if (this.pages.length <= 1) { toast('A notebook needs at least one page'); return; }
    const before = this.pages;
    const after = before.filter((_, i) => i !== index);
    this.pushPagesUndo(before, after, Math.min(index, after.length - 1));
    const entry = this.undoStack[this.undoStack.length - 1];
    // "Undo" only brings this page back – never undoes something done since
    toast(`Page ${index + 1} deleted`, { action: { label: 'Undo', onClick: () => {
      if (this.undoStack[this.undoStack.length - 1] === entry) this.undo();
      else toast('Something changed since – use Ctrl+Z to step back');
    } } });
  }

  movePage(from, to) {
    if (from === to || to < 0 || to >= this.pages.length) return;
    const before = this.pages;
    const after = before.slice();
    const [p] = after.splice(from, 1);
    after.splice(to, 0, p);
    this.pushPagesUndo(before, after, to);
  }

  pageMenu(index, x, y) {
    showMenu([
      { header: `Page ${index + 1}` },
      ...PAPERS.slice(0, 6).map(([k, label]) => ({ label: `Insert ${label.toLowerCase()} page after`, icon: 'addPage', onClick: () => this.insertPage(index, k) })),
      { label: 'Insert pages from a PDF after…', icon: 'importPdf', onClick: () => this.insertPdfDialog(index) },
      'sep',
      { label: 'Duplicate page', icon: 'duplicate', onClick: () => this.duplicatePage(index) },
      { label: this.pages[index].bm ? 'Remove bookmark' : 'Bookmark page', icon: 'bookmark', onClick: () => this.toggleBookmark(index) },
      { label: 'Rotate right 90°', icon: 'rotateR', onClick: () => this.rotatePage(index, 1) },
      { label: 'Rotate left 90°', icon: 'rotateL', onClick: () => this.rotatePage(index, -1) },
      { label: 'Add page before', icon: 'addPage', onClick: () => this.insertPage(index, this.styleOf(this.pages[index]), 'before') },
      { label: 'Move up', icon: 'chevronLeft', disabled: index === 0, onClick: () => this.movePage(index, index - 1) },
      { label: 'Move down', icon: 'chevronRight', disabled: index === this.pages.length - 1, onClick: () => this.movePage(index, index + 1) },
      { label: 'Export this page…', icon: 'export', onClick: () => this.exportPages([this.pages[index].id]) },
      { label: 'Send this page by e-mail', icon: 'mail', onClick: () => this.send('mail', [this.pages[index].id], `page ${index + 1}`) },
      'sep',
      { label: 'Delete page', icon: 'trash', danger: true, onClick: () => this.deletePage(index) },
    ], x, y);
  }

  // ---------- keyboard ----------
  onKey(e) {
    const k = shortcutKey(e);
    const ctrl = e.ctrlKey || e.metaKey;
    const sel = this.tools.sel;
    if (ctrl && !e.shiftKey && k === 'z') return this.undo(), true;
    if (ctrl && (k === 'y' || (e.shiftKey && k === 'z'))) return this.redo(), true;
    if (ctrl && k === 'f') return this.searchPanel.open(), true;
    if (ctrl && e.shiftKey && k === 'b') return this.toggleSidebar(), true;
    if (ctrl && sel && sel.textIds.size && ['b', 'i', 'u'].includes(k)) {
      const texts = this.pageData(sel.pageId).texts.filter((t) => sel.textIds.has(t.id));
      const all = texts.every((t) => t[k]);
      this.tools.restyle({ [k]: !all });
      return true;
    }
    if (ctrl && k === 's') {
      this.flush().then(async () => {
        if (this.isExternal) await window.api.extWrite(this.rel).then(() => toast('Saved into the PDF file', { timeout: 1200 }), () => {});
        else { toast('Saved', { timeout: 900 }); this.app.syncAll({ quiet: true }); }
      });
      return true;
    }
    if (ctrl && k === 'c') { if (this.tools.copy()) this.writeClipboardMarker(); return true; }
    if (ctrl && k === 'x') { if (this.tools.sel) { this.tools.copy(); this.writeClipboardMarker(); this.tools.deleteSelection(); } return true; }
    if (ctrl && k === 'd') return this.tools.duplicate(), true;
    if (ctrl && k === 'g') { if (this.tools.sel) this.tools.group(!e.shiftKey); return true; }
    if (ctrl && k === 'a') return this.selectAll(), true;
    if (ctrl && (k === '=' || k === '+')) return this.viewer.zoomTo(this.viewer.zoomTarget() * 1.25), true;
    if (ctrl && k === '-') return this.viewer.zoomTo(this.viewer.zoomTarget() / 1.25), true;
    if (ctrl && k === '0') return this.viewer.fitWidth(), true;
    if (ctrl) return false; // Ctrl+V is handled by the paste event
    if ((k === 'delete' || k === 'backspace') && sel) return this.tools.deleteSelection(), true;
    if (k === 'escape') { this.tools.clearSelection(); this.searchPanel.close(); this.textBar.update(); return true; }
    const map = { v: 'select', p: 'pen', h: 'hl', e: 'eraser', l: 'lasso', s: 'shape', t: 'text', k: 'laser' };
    if (map[k]) return this.setTool(map[k]), true;
    if (this.isBoard) return false;
    if (k === 'pagedown' || (k === 'arrowright' && !e.shiftKey)) return this.viewer.scrollToPage(this.viewer.currentIndex + 1), true;
    if (k === 'pageup' || (k === 'arrowleft' && !e.shiftKey)) return this.viewer.scrollToPage(this.viewer.currentIndex - 1), true;
    if (k === 'home') return this.viewer.scrollToPage(0), true;
    if (k === 'end') return this.viewer.scrollToPage(this.pages.length - 1), true;
    return false;
  }

  selectAll() {
    const i = this.viewer.currentIndex;
    const p = this.pages[i];
    const d = this.pageData(p.id);
    if (this.toolState.tool !== 'lasso' && this.toolState.tool !== 'select') this.setTool('select');
    this.tools.select(i, p.id, new Set(d.strokes.map((s) => s.id)), new Set(d.texts.map((t) => t.id)), new Set(d.items.map((it) => it.id)));
  }

  // ---------- background text indexing (for search) ----------
  async startIndexing(src = 'main') {
    if (this.isBoard) return;
    let pdf = this.doc.pdfs.get(src);
    if (!pdf) {
      this.pdfFor(src);
      await this.pdfLoading.get(src);
      pdf = this.doc.pdfs.get(src);
      if (!pdf) return;
    }
    this.doc.textIndexes = this.doc.textIndexes || {};
    let idx = this.doc.textIndexes[src];
    if (!idx || idx.count !== pdf.numPages) idx = { pages: {}, complete: false, count: pdf.numPages };
    this.doc.textIndexes[src] = idx;
    if (idx.complete) return;
    // Only index the pages this notebook actually uses.
    const used = new Set(this.pages.filter((p) => p.kind === 'pdf' && (p.src || 'main') === src).map((p) => p.pdfPage));
    let sinceSave = 0;
    let done = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      if (this.indexingStopped) break;
      if (idx.pages[n] !== undefined || !used.has(n)) { done++; continue; }
      await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 300 }) : setTimeout(r, 16)));
      try { idx.pages[n] = await pdf.pageText(n); } catch (err) { if (this.indexingStopped || pdf.destroyed) break; idx.pages[n] = ''; }
      done++;
      this.searchPanel.indexProgress(src, done, pdf.numPages);
      if (++sinceSave >= 40 && !this.destroyed) { sinceSave = 0; await window.api.writeText(this.rel, idx, src).catch(() => {}); }
    }
    if (this.destroyed) return;
    if (!this.indexingStopped) {
      idx.complete = used.size === pdf.numPages || [...used].every((n) => idx.pages[n] !== undefined);
      await window.api.writeText(this.rel, idx, src).catch(() => {});
      this.searchPanel.indexProgress(src, pdf.numPages, pdf.numPages);
    } else if (sinceSave) {
      await window.api.writeText(this.rel, idx, src).catch(() => {});
    }
  }

  // Rectangles (page units) of a query on a PDF page, for highlighting.
  async findTextRects(pageIndex, query) {
    const page = this.pages[pageIndex];
    const pdf = page && page.kind === 'pdf' ? this.doc.pdfs.get(page.src || 'main') : null;
    if (!pdf) return [];
    const q = normalize(query).trim();
    try {
      const [tc, vp] = await Promise.all([pdf.textContent(page.pdfPage), pdf.viewport(page.pdfPage, 1, page.rot || 0)]);
      const rects = [];
      for (const it of tc.items) {
        if (!it.str) continue;
        const norm = fold(it.str);
        let from = norm.indexOf(q);
        while (from >= 0) {
          const tx = Util.transform(vp.transform, it.transform);
          const fh = Math.hypot(tx[2], tx[3]);
          const width = it.width * vp.scale;
          const angle = Math.atan2(tx[1], tx[0]);
          const x0 = tx[4] + Math.cos(angle) * (width * from) / norm.length;
          const y0 = tx[5] + Math.sin(angle) * (width * from) / norm.length;
          const w = (width * q.length) / norm.length;
          if (Math.abs(angle) < 0.01) rects.push([x0 - 1, y0 - fh * 0.85, w + 2, fh * 1.1]);
          else rects.push([Math.min(tx[4], tx[4] + Math.cos(angle) * width) - 2, Math.min(tx[5], tx[5] + Math.sin(angle) * width) - fh, Math.abs(Math.cos(angle) * width) + fh, Math.abs(Math.sin(angle) * width) + fh]);
          from = norm.indexOf(q, from + q.length);
        }
      }
      return rects;
    } catch (err) {
      if (!isCancel(err)) console.warn(err);
      return [];
    }
  }

  async goToHit(hit, query) {
    this.viewer.scrollToPage(hit.pageIndex);
    if (hit.source === 'pdf') {
      const rects = await this.findTextRects(hit.pageIndex, query);
      if (rects.length) {
        this.viewer.scrollToPage(hit.pageIndex, rects[0][1]);
        this.viewer.update();
        this.viewer.flash(hit.pageIndex, rects);
      }
      return;
    }
    const d = this.pageData(this.pages[hit.pageIndex].id);
    const q = normalize(query).trim();
    const t = d.texts.find((x) => normalize(x.text).includes(q));
    let box = t ? textBBox(t) : null;
    if (!box) {
      const tb = d.items.find((it) => it.type === 'table' && normalize((it.cells || []).flat().map((c) => c.t || '').join(' ')).includes(q));
      if (tb) box = itemBBox(tb);
    }
    if (!box) return;
    if (this.isBoard) this.viewer.centerOn((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    else this.viewer.scrollToPage(hit.pageIndex, box[1]);
    this.viewer.update();
    this.viewer.flash(hit.pageIndex, [[box[0] - 3, box[1] - 3, box[2] - box[0] + 6, box[3] - box[1] + 6]]);
  }
}

Object.assign(Editor.prototype, objectsMixin);
