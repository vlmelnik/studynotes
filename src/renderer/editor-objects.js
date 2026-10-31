// Text boxes (rich text), pictures, tables, clipboard paste, drag & drop and
// the insert dialogs. Installed on Editor.prototype.
import { h, toast, modal, encodeRel, promptDialog, parseRange } from './ui.js';
import { uid, textBBox, itemBBox } from './tools.js';
import { PdfDoc } from './pdfdoc.js';
import { round2 } from '../shared/geometry.js';
import { richToPlain, escapeHtml } from '../shared/richtext.js';
import { FONTS, DEFAULT_FONT } from '../shared/fonts.js';
import { stacked } from '../shared/stacking.js';
import { boxStyle, BOX_PAD_X, BOX_PAD_Y, BOX_BORDER } from '../shared/textbox.js';
import { renderFormFields } from './fill-sign.js';

const LINE_H = 1.3;
const MARKER = '⁣StudyNotes-clip:';
const MAX_IMAGE_SIDE = 3200;

function fontCss(ff) { return `"${(FONTS[ff] || FONTS[DEFAULT_FONT]).css}", "Segoe UI", sans-serif`; }

// ---------- HTML sanitising (to <b> <i> <u> <br> <div> only) ----------
const BLOCK = new Set(['div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'ul', 'ol', 'table', 'dt', 'dd']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template', 'svg', 'img', 'iframe', 'object', 'video', 'audio', 'canvas', 'button', 'input', 'select', 'textarea']);

// A styled span whose only content is another styled span becomes one span
// (inner values win). Keeps markup flat when a word is styled several times.
export function flattenSpans(root) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const sp of root.querySelectorAll('span')) {
      const kids = [...sp.childNodes].filter((n) => !(n.nodeType === 3 && n.nodeValue === ''));
      if (kids.length === 1 && kids[0].nodeType === 1 && kids[0].tagName === 'SPAN') {
        const inner = kids[0];
        for (const k of ['fs', 'ff', 'c']) if (inner.dataset[k]) sp.dataset[k] = inner.dataset[k];
        inner.replaceWith(...inner.childNodes);
        changed = true;
        break;
      }
      if (!sp.dataset.fs && !sp.dataset.ff && !sp.dataset.c) { sp.replaceWith(...sp.childNodes); changed = true; break; }
    }
  }
}

// <span data-…> with the matching inline style so the browser shows it.
export function spanOpen({ fs, ff, c }) {
  const attrs = [], css = [];
  const n = parseFloat(fs);
  if (n > 0 && n < 1000) { attrs.push(`data-fs="${round2(n)}"`); css.push(`font-size:${round2(n)}px`); }
  if (ff && FONTS[ff]) { attrs.push(`data-ff="${ff}"`); css.push(`font-family:${fontCss(ff).replace(/"/g, "'")}`); }
  if (c && /^#[0-9a-f]{6}$/i.test(c)) { attrs.push(`data-c="${c.toLowerCase()}"`); css.push(`color:${c.toLowerCase()}`); }
  if (!attrs.length) return '';
  return `<span ${attrs.join(' ')} style="${css.join(';')}">`;
}

// HTML stored in page files can come from another PC (Drive sync) or be
// edited by hand, so it is always cleaned before it reaches the DOM.
// Cached because pages re-render often and the HTML rarely changes.
const safeCache = new Map();
export function safeHtml(html) {
  let out = safeCache.get(html);
  if (out === undefined) {
    out = sanitizeHtml(html);
    if (safeCache.size > 2000) safeCache.clear();
    safeCache.set(html, out);
  }
  return out;
}

// external: HTML from another program (line breaks in its source are just
// spaces). Our own text boxes use pre-wrap: a "\n" there is a real new line.
// Character positions of a range inside a text box (text + <br> = 1 char),
// and back – survives re-rendering the box's markup.
function textOffset(root, node, off) {
  let n = 0;
  const walk = (x) => {
    if (x === node) {
      if (x.nodeType === 3) { n += off; return true; }
      for (let i = 0; i < off && i < x.childNodes.length; i++) n += textLen(x.childNodes[i]);
      return true;
    }
    if (x.nodeType === 3) { n += x.nodeValue.length; return false; }
    if (x.nodeName === 'BR') { n += 1; return false; }
    for (const c of x.childNodes) if (walk(c)) return true;
    return false;
  };
  walk(root);
  return n;
}
function textLen(x) {
  if (x.nodeType === 3) return x.nodeValue.length;
  if (x.nodeName === 'BR') return 1;
  let n = 0;
  for (const c of x.childNodes) n += textLen(c);
  return n;
}
function rangeOffsets(root, range) {
  if (!range || !root.contains(range.startContainer)) return null;
  return [textOffset(root, range.startContainer, range.startOffset), textOffset(root, range.endContainer, range.endOffset)];
}
function rangeAt(root, start, end) {
  const r = document.createRange();
  let n = 0, set = 0;
  const place = (x, which, at) => (which === 0 ? r.setStart(x, at) : r.setEnd(x, at));
  const walk = (x) => {
    if (set === 2) return;
    if (x.nodeType === 3) {
      const len = x.nodeValue.length;
      if (set === 0 && start <= n + len) { place(x, 0, start - n); set = 1; }
      if (set === 1 && end <= n + len) { place(x, 1, end - n); set = 2; return; }
      n += len;
      return;
    }
    if (x.nodeName === 'BR') {
      const parent = x.parentNode, idx = [...parent.childNodes].indexOf(x);
      if (set === 0 && start <= n) { r.setStart(parent, idx); set = 1; }
      if (set === 1 && end <= n) { r.setEnd(parent, idx); set = 2; return; }
      n += 1;
      if (set === 0 && start === n) { r.setStart(parent, idx + 1); set = 1; }
      return;
    }
    for (const c of x.childNodes) walk(c);
  };
  walk(root);
  if (set === 1) r.setEnd(root, root.childNodes.length);
  return set ? r : null;
}

export function sanitizeHtml(html, external = false) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      out.push(external ? escapeHtml(node.nodeValue.replace(/[\r\n]+/g, ' ')) : node.nodeValue.replace(/\r/g, '').split('\n').map(escapeHtml).join('<br>'));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === 'br') { out.push('<br>'); return; }
    const st = node.style || {};
    const bold = tag === 'b' || tag === 'strong' || /^(bold|[6-9]00)$/.test(st.fontWeight || '');
    const ital = tag === 'i' || tag === 'em' || st.fontStyle === 'italic';
    const under = tag === 'u' || /underline/.test(st.textDecoration || st.textDecorationLine || '');
    const block = BLOCK.has(tag);
    // Our own per-word size / font / colour (see shared/richtext.js).
    const ds = node.dataset || {};
    const span = tag === 'span' && (ds.fs || ds.ff || ds.c) ? spanOpen(ds) : '';
    if (block) out.push('<div>');
    if (tag === 'li') out.push('• ');
    if (span) out.push(span);
    if (bold) out.push('<b>');
    if (ital) out.push('<i>');
    if (under) out.push('<u>');
    for (const c of node.childNodes) walk(c);
    if (tag === 'td' || tag === 'th') out.push(' ');
    if (under) out.push('</u>');
    if (ital) out.push('</i>');
    if (bold) out.push('</b>');
    if (span) out.push('</span>');
    if (block) out.push('</div>');
  };
  for (const c of doc.body.childNodes) walk(c);
  return out.join('').replace(/<div><\/div>/g, '').replace(/(<br>)+$/, '');
}

const hasFormatting = (html) => /<(b|i|u)>|<span data-/i.test(html || '');

// ---------- table parsing ----------
function tableFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows = [];
  for (const tr of [...table.querySelectorAll('tr')].slice(0, 200)) {
    const cells = [];
    for (const td of [...tr.children].filter((c) => /^(td|th)$/i.test(c.tagName)).slice(0, 30)) {
      const text = td.innerText !== undefined && td.innerText !== '' ? td.innerText : td.textContent;
      const cell = { t: String(text || '').replace(/ /g, ' ').trim() };
      const bg = td.getAttribute('bgcolor') || (td.style && td.style.backgroundColor);
      if (bg && !/transparent|rgba\(0, 0, 0, 0\)/.test(bg)) cell.bg = toHex(bg);
      if (td.tagName.toLowerCase() === 'th' || td.querySelector('b,strong') || /bold|[6-9]00/.test((td.style && td.style.fontWeight) || '')) cell.b = true;
      const span = Math.min(10, parseInt(td.getAttribute('colspan') || '1', 10) || 1);
      cells.push(cell);
      for (let k = 1; k < span; k++) cells.push({ t: '' });
    }
    if (cells.length) rows.push(cells);
  }
  return rows.length ? rows : null;
}

function tableFromTsv(text) {
  const lines = String(text).replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  if (!lines.length || !lines.some((l) => l.includes('\t'))) return null;
  const rows = lines.slice(0, 200).map((l) => l.split('\t').slice(0, 30).map((t) => ({ t: t.trim() })));
  return Math.max(...rows.map((r) => r.length)) >= 2 ? rows : null;
}

function toHex(c) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillStyle = c;
  return ctx.fillStyle.startsWith('#') ? ctx.fillStyle : '#ffffff';
}

// ---------- images ----------
async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Normalise any image to PNG/JPEG bytes the PDF export can embed, downscaling huge photos.
async function prepareImage(bytes, mime) {
  const type = (mime || '').toLowerCase();
  const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
  const img = await blobToImage(blob);
  const w = img.naturalWidth, hgt = img.naturalHeight;
  const big = Math.max(w, hgt) > MAX_IMAGE_SIDE;
  if (!big && (type === 'image/png' || type === 'image/jpeg')) {
    return { bytes: new Uint8Array(bytes), ext: type === 'image/png' ? 'png' : 'jpg', w, h: hgt };
  }
  const k = big ? MAX_IMAGE_SIDE / Math.max(w, hgt) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(hgt * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const asJpeg = type === 'image/jpeg';
  const out = await new Promise((r) => c.toBlob(r, asJpeg ? 'image/jpeg' : 'image/png', 0.9));
  c.width = c.height = 0;
  return { bytes: new Uint8Array(await out.arrayBuffer()), ext: asJpeg ? 'jpg' : 'png', w, h: hgt };
}

function mimeFromName(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[ext] || '';
}

export const objectsMixin = {
  // ---------- text boxes ----------
  addText(pageId, t) {
    const before = this.pageData(pageId);
    this.setPageData(pageId, { ...before, texts: before.texts.concat([t]) });
    this.textEdit = { pageId, id: t.id, before };
    const v = this.viewer.viewById(pageId);
    const el = v && v.el.querySelector(`.textbox[data-id="${t.id}"]`);
    if (el) { el.setAttribute('contenteditable', 'true'); el.focus(); }
  },

  // Text boxes, pictures and tables in stacking order: back layer below the
  // ink, front layer above it (see shared/stacking.js).
  renderObjects(view) {
    const data = this.pageData(view.page.id);
    view.itemsLayer.replaceChildren();
    view.textLayer.replaceChildren();
    for (const [layer, host] of [['b', view.itemsLayer], ['f', view.textLayer]]) {
      for (const { kind, obj } of stacked(data, layer)) {
        const el = kind === 'text' ? this.textboxElement(view, obj) : this.itemElement(obj);
        if (el) host.append(el);
      }
    }
    renderFormFields(this, view);
    this.measureTables(view);
    this.measureTexts(view);
    if (this.tools && this.tools.sel && this.tools.sel.pageId === view.page.id) this.tools.refreshSelectionEls();
  },
  renderTexts(view) { this.renderObjects(view); },
  renderItems(view) { this.renderObjects(view); },

  // The frame around a text box (selection, hit-testing, export) uses the
  // height the text really has on screen. It changes with the width, the
  // font, pasted text … so every text box is watched; a new height is only a
  // measurement (stored with the next real change, not marked as changed).
  textResizeObserver() {
    if (!this._textRO) {
      this._textRO = new ResizeObserver((entries) => {
        const touched = new Set();
        for (const en of entries) {
          const el = en.target, info = el._tb;
          if (!info || !el.isConnected || !el.offsetHeight) continue;
          const d = this.doc.pages[info.pageId];
          const t = d && d.texts.find((q) => q.id === info.id);
          if (!t) continue;
          const hgt = round2(el.offsetHeight);
          const lines = Math.max(1, Math.round(el.offsetHeight / (t.fs * LINE_H)));
          if (Math.abs((t.h || 0) - hgt) < 0.5 && (t.lines || 1) === lines) continue;
          this.doc.pages[info.pageId] = { ...d, texts: d.texts.map((q) => (q.id === t.id ? { ...q, h: hgt, lines } : q)) };
          touched.add(info.pageId);
        }
        const sel = this.tools && this.tools.sel;
        if (sel && touched.has(sel.pageId)) this.tools.refreshSelectionEls();
      });
    }
    return this._textRO;
  },

  textboxElement(view, t) {
    const el = h('div', {
      class: 'textbox', dataset: { id: t.id }, spellcheck: 'true',
      style: {
        width: t.w + 'px', fontSize: t.fs + 'px', color: t.c, fontFamily: fontCss(t.ff),
        fontWeight: t.b ? '700' : '400', fontStyle: t.i ? 'italic' : 'normal', textDecoration: t.u ? 'underline' : 'none',
        textAlign: t.al || 'left',
      },
    });
    if (t.html) el.innerHTML = safeHtml(t.html); else el.textContent = t.text;
    const grip = h('div', { class: 'tb-handle grip', title: 'Drag to move' });
    const resizeL = h('div', { class: 'tb-handle resize left', title: 'Drag to change the width' });
    const resize = h('div', { class: 'tb-handle resize right', title: 'Drag to change the width' });
    const wrap = h('div', { class: 'textbox-wrap', dataset: { id: t.id }, style: { left: t.x + 'px', top: t.y + 'px', width: t.w + 'px' } }, el, grip, resizeL, resize);
    this.applyBoxLook(el, wrap, t, view.page);
    if (t.r) Object.assign(el.style, { transform: `rotate(${t.r}deg)`, transformOrigin: '50% 50%' });
    el._tb = { pageId: view.page.id, id: t.id };
    this.textResizeObserver().observe(el);
    this.setTextEditable(el);
    this.bindTextbox(view, t.id, el, grip, resize, wrap, resizeL);
    return wrap;
  },

  // Fill / border / corners, and the auto width of new boxes: they start thin
  // and grow while typing, up to the page edge, then the text wraps.
  applyBoxLook(el, wrap, t, page) {
    const box = boxStyle(t);
    Object.assign(el.style, box
      ? { background: box.bg || 'transparent', border: box.bc ? `${BOX_BORDER}px solid ${box.bc}` : 'none', borderRadius: box.br + 'px', padding: `${BOX_PAD_Y}px ${BOX_PAD_X}px` }
      : { background: '', border: '', borderRadius: '', padding: '' });
    wrap.classList.toggle('boxed', !!box);
    if (t.aw) {
      const maxW = this.textMaxWidth(page, t.x);
      el.style.width = 'max-content';
      el.style.maxWidth = maxW + 'px';
      wrap.style.width = 'auto';
      wrap.dataset.aw = '1';
    } else {
      el.style.width = t.w + 'px';
      el.style.maxWidth = '';
      wrap.style.width = t.w + 'px';
      delete wrap.dataset.aw;
    }
  },

  textMaxWidth(page, x) {
    if (!page || page.kind === 'board') return 640;
    return Math.max(40, page.w - (x - (page.ox || 0)) - 12);
  },

  setTextEditable(el) {
    const editing = this.textEdit && this.textEdit.id === el.dataset.id;
    if (this.toolState.tool === 'text' || editing) el.setAttribute('contenteditable', 'true');
    else { el.removeAttribute('contenteditable'); if (document.activeElement === el) el.blur(); }
  },

  // Double-click with the select tool: edit an existing text box.
  // at: { x, y } of a double-click → that word is selected (not everything)
  editText(pageId, id, at = null) {
    const v = this.viewer.viewById(pageId);
    const el = v && v.el.querySelector(`.textbox[data-id="${id}"]`);
    if (!el) return;
    this.textEdit = { pageId, id, before: this.pageData(pageId) };
    el.setAttribute('contenteditable', 'true');
    el.focus();
    const s = window.getSelection();
    const hit = at && document.caretRangeFromPoint && document.caretRangeFromPoint(at.x, at.y);
    const node = hit && hit.startContainer;
    if (node && node.nodeType === 3 && el.contains(node) && typeof Intl.Segmenter === 'function') {
      // the word under the pointer (caret positions sit between letters, so a
      // click on the left half of a letter lands before it: look at both sides)
      const off = hit.startOffset;
      const segs = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(node.data)];
      const at = (o) => segs.find((g) => g.index <= o && o < g.index + g.segment.length);
      let w = at(off);
      if (!(w && w.isWordLike) && off > 0) { const p = at(off - 1); if (p && p.isWordLike) w = p; }
      if (w && w.isWordLike) {
        const r = document.createRange();
        r.setStart(node, w.index);
        r.setEnd(node, w.index + w.segment.length);
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
    const r = document.createRange();
    r.selectNodeContents(el);
    s.removeAllRanges();
    s.addRange(r);
  },

  bindTextbox(view, id, el, grip, resize, wrap, resizeL) {
    const pageId = view.page.id;
    const find = () => this.pageData(pageId).texts.find((t) => t.id === id);
    el.addEventListener('focus', () => {
      document.execCommand('styleWithCSS', false, false);
      if (!this.textEdit || this.textEdit.id !== id) this.textEdit = { pageId, id, before: this.pageData(pageId) };
      wrap.classList.add('editing');
      this.textBar.update();
    });
    el.addEventListener('input', () => { this.syncTextFromDom(pageId, id, el); this.textBar.schedulePosition(); });
    el.addEventListener('blur', (e) => {
      wrap.classList.remove('editing');
      // Clicking into the text bar (e.g. the size field) keeps editing alive.
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.text-bar, .tool-options, .menu')) return;
      this.finishTextEdit();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
      e.stopPropagation(); // don't trigger tool shortcuts while typing
    });
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      if (this.settings.pasteFormatting && html) document.execCommand('insertHTML', false, sanitizeHtml(html, true));
      else document.execCommand('insertText', false, text.replace(/\u00a0/g, ' '));
    });
    // Move / resize with the handles (text tool, or select tool on a selected box).
    const drag = (handle, mode) => handle.addEventListener('pointerdown', (e) => {
      if (this.toolState.tool !== 'text' && this.toolState.tool !== 'select') return;
      if (this.tools.sel) this.tools.clearSelection(true);
      e.preventDefault(); e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const t0 = find();
      const before = this.pageData(pageId);
      const sx = e.clientX, sy = e.clientY, z = this.viewer.zoom;
      const move = (ev) => {
        const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
        if (mode === 'move') { wrap.style.left = t0.x + dx + 'px'; wrap.style.top = t0.y + dy + 'px'; }
        else if (mode === 'resizeL') {
          const w = Math.max(30, t0.w - dx);
          wrap.style.left = t0.x + t0.w - w + 'px'; wrap.style.width = w + 'px'; el.style.width = w + 'px'; el.style.maxWidth = '';
        } else { const w = Math.max(30, t0.w + dx); wrap.style.width = w + 'px'; el.style.width = w + 'px'; el.style.maxWidth = ''; }
      };
      const up = (ev) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
        if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
        // A width set by hand stays fixed (the box no longer grows by itself).
        const after = { ...before, texts: before.texts.map((t) => {
          if (t.id !== id) return t;
          if (mode === 'move') return { ...t, x: round2(t.x + dx), y: round2(t.y + dy) };
          if (mode === 'resizeL') { const w = Math.max(30, t.w - dx); return { ...t, x: round2(t.x + t.w - w), w: round2(w), aw: false }; }
          return { ...t, w: round2(Math.max(30, t.w + dx)), aw: false };
        }) };
        this.commit(pageId, before, after);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    drag(grip, 'move');
    drag(resize, 'resize');
    if (resizeL) drag(resizeL, 'resizeL');
  },

  syncTextFromDom(pageId, id, el) {
    const d = this.pageData(pageId);
    const t0 = d.texts.find((t) => t.id === id);
    if (!t0) return;
    const html = sanitizeHtml(el.innerHTML);
    const rich = hasFormatting(html);
    const text = rich ? richToPlain(html) : (el.innerText || '').replace(/\n$/, '');
    const lines = Math.max(1, Math.round(el.offsetHeight / (t0.fs * LINE_H)));
    const hgt = round2(el.offsetHeight);
    const texts = d.texts.map((t) => {
      if (t.id !== id) return t;
      const n = { ...t, text, lines, h: hgt };
      if (t.aw) n.w = round2(el.offsetWidth + 1); // layout px (the page layer is scaled by CSS)
      if (rich) n.html = html; else delete n.html;
      return n;
    });
    this.doc.pages[pageId] = { ...d, texts };
    this.markDirty(pageId);
    this.sidebar.invalidate(pageId);
  },

  finishTextEdit(blur = false) {
    const te = this.textEdit;
    if (!te) return;
    this.textEdit = null;
    const v = this.viewer && this.viewer.viewById(te.pageId);
    const el = v && v.el.querySelector(`.textbox[data-id="${te.id}"]`);
    if (el) {
      if (blur && document.activeElement === el) el.blur();
      if (this.toolState.tool !== 'text') el.removeAttribute('contenteditable');
      // The frame goes away as soon as editing ends – also when focus had moved
      // into the text bar (size field…) and the box itself never lost focus.
      const wrap = el.closest('.textbox-wrap');
      if (wrap) wrap.classList.remove('editing');
      // forget the text selection inside the box (it would catch later pastes)
      const s = window.getSelection();
      if (s && s.anchorNode && el.contains(s.anchorNode)) s.removeAllRanges();
    }
    const d = this.pageData(te.pageId);
    const t = d.texts.find((q) => q.id === te.id);
    if (t && !(t.text || '').trim()) {
      const after = { ...d, texts: d.texts.filter((q) => q.id !== te.id) };
      const existed = te.before.texts.some((q) => q.id === te.id);
      if (existed) { this.pushUndo(te.pageId, te.before, after, true); this.setPageData(te.pageId, after); }
      else this.setPageData(te.pageId, after);
      if (this.textBar) this.textBar.update();
      return;
    }
    const prev = te.before.texts.find((q) => q.id === te.id);
    const keys = ['text', 'html', 'b', 'i', 'u', 'ff', 'fs', 'c', 'al', 'bx', 'bg', 'bc', 'br'];
    if (t && (!prev || keys.some((k) => prev[k] !== t[k]))) this.pushUndo(te.pageId, te.before, d, true);
    if (this.textBar) this.textBar.update();
  },

  finishEditing(blur = false) {
    this.finishTextEdit(blur);
    this.finishCellEdit();
  },

  // ---------- text styling ----------
  // change: { ff, size, color, b, i, u, al, list, box: { bg, bc, br } | null }
  // Applies to (1) the selected words while editing, (2) the whole box being
  // edited when nothing is selected, or (3) every selected text box. The text
  // tool's defaults for new boxes follow the last choice.
  applyTextStyle(change) {
    const ts = this.toolState.text;
    if (change.ff) ts.ff = change.ff;
    if (change.size) ts.size = change.size;
    if (change.color) this.toolState.pen.color = change.color;
    for (const k of ['b', 'i', 'u']) if (change[k] !== undefined) ts[k] = change[k];
    if (change.al) ts.al = change.al;

    const te = this.textEdit;
    const el = te && this.viewer.viewById(te.pageId)?.el.querySelector(`.textbox[data-id="${te.id}"]`);
    if (el) {
      const range = this.textRangeIn(el);
      const inline = range && (change.ff || change.size || change.color || change.b !== undefined || change.i !== undefined || change.u !== undefined);
      if (inline) this.styleRange(el, change);
      else this.styleWholeBox(te.pageId, [te.id], change, el);
      this.syncTextFromDom(te.pageId, te.id, el);
      el.focus();
    } else if (this.tools.sel && this.tools.sel.textIds.size) {
      const sel = this.tools.sel;
      this.styleWholeBox(sel.pageId, [...sel.textIds], change, null, true);
    }
    this.renderOptions();
    this.app.saveToolState();
  },

  // The current non-empty text selection inside `el`, or null.
  textRangeIn(el) {
    const s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return null;
    const r = s.getRangeAt(0);
    return el.contains(r.commonAncestorContainer) ? r : null;
  },

  // Style only the selected characters.
  styleRange(el, change) {
    const offsets = rangeOffsets(el, this.textRangeIn(el));
    document.execCommand('styleWithCSS', false, false);
    for (const k of ['b', 'i', 'u']) {
      if (change[k] === undefined) continue;
      const cmd = { b: 'bold', i: 'italic', u: 'underline' }[k];
      if (document.queryCommandState(cmd) !== change[k]) document.execCommand(cmd);
    }
    const props = {};
    if (change.size) props.fs = change.size;
    if (change.ff) props.ff = change.ff;
    if (change.color) props.c = change.color;
    if (!Object.keys(props).length) return;
    // Mark the exact selection with a <font face> the browser splits for us,
    // then turn every marker into our <span data-…>.
    const MARK = 'sn-mark-' + Math.random().toString(36).slice(2, 8);
    document.execCommand('fontName', false, MARK);
    const marked = [...el.querySelectorAll(`font[face="${MARK}"]`)];
    for (const f of marked) {
      // Inner spans must not override the new value.
      for (const inner of f.querySelectorAll('span')) for (const k of Object.keys(props)) delete inner.dataset[k];
      const span = document.createElement('span');
      const ds = { ...props };
      // Keep the other properties of an enclosing span.
      const outer = f.parentElement && f.parentElement.closest('span[data-fs], span[data-ff], span[data-c]');
      if (outer && el.contains(outer)) for (const k of ['fs', 'ff', 'c']) if (!(k in ds) && outer.dataset[k]) ds[k] = outer.dataset[k];
      Object.assign(span.dataset, ds);
      span.append(...f.childNodes);
      f.replaceWith(span);
    }
    flattenSpans(el);
    // Re-render the markup cleanly, then select exactly the same characters
    // again (by position – other words with the same style stay unselected).
    el.innerHTML = sanitizeHtml(el.innerHTML);
    if (offsets) {
      const r = rangeAt(el, offsets[0], offsets[1]);
      const sel = window.getSelection();
      sel.removeAllRanges();
      if (r) sel.addRange(r);
    }
  },

  // Style whole text boxes; per-word values of the same property are removed
  // so the new value really applies to everything.
  styleWholeBox(pageId, ids, change, el, undoable = false) {
    const before = this.pageData(pageId);
    const idSet = new Set(ids);
    const strip = (html, keys) => {
      if (!html || !keys.length) return html;
      const tmp = document.createElement('div');
      tmp.innerHTML = safeHtml(html);
      for (const sp of tmp.querySelectorAll('span')) for (const k of keys) delete sp.dataset[k];
      return sanitizeHtml(tmp.innerHTML);
    };
    const keys = [change.size && 'fs', change.ff && 'ff', change.color && 'c'].filter(Boolean);
    const texts = before.texts.map((t) => {
      if (!idSet.has(t.id)) return t;
      const n = { ...t };
      if (change.ff) n.ff = change.ff;
      if (change.size) n.fs = change.size;
      if (change.color) n.c = change.color;
      for (const k of ['b', 'i', 'u']) {
        if (change[k] === undefined) continue;
        n[k] = change[k];
        if (n.html) n.html = n.html.replace(new RegExp(`</?${k}>`, 'gi'), '');
      }
      if (change.al) n.al = change.al;
      if (change.box !== undefined) {
        delete n.bx; delete n.bg; delete n.bc; delete n.br;
        if (change.box) {
          if (change.box.bg) n.bg = change.box.bg;
          if (change.box.bc) n.bc = change.box.bc;
          n.br = change.box.br || 0;
        }
      }
      if (change.list !== undefined) {
        const lines = (n.html ? null : String(n.text || '').split('\n'));
        if (lines) {
          n.text = lines.map((l) => (change.list ? (l.startsWith('• ') ? l : '• ' + l) : l.replace(/^• /, ''))).join('\n');
        } else {
          const toggle = (node) => {
            const tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            const first = tw.nextNode();
            if (!first) return;
            if (change.list && !first.nodeValue.startsWith('• ')) first.nodeValue = '• ' + first.nodeValue;
            if (!change.list) first.nodeValue = first.nodeValue.replace(/^• /, '');
          };
          // one bullet per paragraph: split on <br> / <div>
          const parts = n.html.split(/(<br>|<\/?div>)/i);
          n.html = parts.map((part) => {
            if (/^(<br>|<\/?div>)$/i.test(part) || !part) return part;
            const d = document.createElement('div'); d.innerHTML = safeHtml(part); toggle(d); return d.innerHTML;
          }).join('');
          n.text = richToPlain(n.html);
        }
      }
      if (n.html) {
        n.html = strip(n.html, keys);
        if (!hasFormatting(n.html)) { n.text = richToPlain(n.html); delete n.html; }
      }
      return n;
    });
    const after = { ...before, texts };
    if (undoable) {
      const s = this.tools.sel;
      const keep = s ? { index: s.index, pageId: s.pageId, strokeIds: s.strokeIds, textIds: s.textIds, itemIds: s.itemIds } : null;
      this.tools.clearSelection(true);
      this.commit(pageId, before, after);
      if (keep) this.tools.select(keep.index, keep.pageId, keep.strokeIds, keep.textIds, keep.itemIds);
    } else {
      // While editing: one undo step is recorded when editing finishes.
      this.doc.pages[pageId] = after;
      this.markDirty(pageId);
      if (el) {
        const t = texts.find((x) => x.id === ids[0]);
        Object.assign(el.style, {
          fontFamily: fontCss(t.ff), fontSize: t.fs + 'px', color: t.c, textAlign: t.al || 'left',
          fontWeight: t.b ? '700' : '400', fontStyle: t.i ? 'italic' : 'normal', textDecoration: t.u ? 'underline' : 'none',
        });
        const wrap = el.closest('.textbox-wrap');
        const view = this.viewer.viewById(pageId);
        if (wrap) this.applyBoxLook(el, wrap, t, view && view.page);
        if (t.html) el.innerHTML = safeHtml(t.html); else el.textContent = t.text;
      }
    }
  },

  // ---------- pictures & tables ----------
  assetUrl(src) { return `sn://lib/${encodeRel(this.rel)}/${src}`; },

  // Is (x, y) (page units) on a visible part of the picture? Transparent
  // pixels let clicks through to the ink / pictures behind it.
  imageHit(it, x, y, tol = 0) {
    const a = this.alphaMap(it.src);
    if (!a) return true; // not loaded yet: the whole rectangle counts
    let px = x - (it.x + it.w / 2), py = y - (it.y + it.h / 2);
    if (it.r) {
      const t = (-it.r * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      [px, py] = [px * c - py * s, px * s + py * c];
    }
    const u = px / it.w + 0.5, v = py / it.h + 0.5;
    const r = Math.max(1, Math.round((tol / it.w) * a.w));
    const cx = Math.round(u * (a.w - 1)), cy = Math.round(v * (a.h - 1));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const qx = cx + dx, qy = cy + dy;
        if (qx < 0 || qy < 0 || qx >= a.w || qy >= a.h) continue;
        if (a.data[qy * a.w + qx] > 24) return true;
      }
    }
    return false;
  },

  alphaMap(src) {
    this.alphaMaps ||= new Map();
    if (this.alphaMaps.has(src)) return this.alphaMaps.get(src);
    const img = this.loadedImage(src); // null until loaded
    if (!img) return null;
    const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), hh = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, hh);
    let rgba;
    try { rgba = g.getImageData(0, 0, w, hh).data; } catch { this.alphaMaps.set(src, null); return null; }
    const data = new Uint8Array(w * hh);
    for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
    const map = { w, h: hh, data };
    this.alphaMaps.set(src, map);
    return map;
  },

  // "Remove background": the picture is replaced by a new transparent PNG
  // (the original file stays, so undo brings it back).
  async removePictureBackground(pageId, id) {
    const it = this.pageData(pageId).items.find((q) => q.id === id);
    if (!it || this.bgBusy) return;
    this.bgBusy = true;
    const note = toast('Removing the background… (a few seconds)', { timeout: 60000 });
    try {
      this.loadedImage(it.src);
      const img = this.images.get(it.src);
      if (!img.complete) await new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });
      if (!img.naturalWidth) throw new Error('picture could not be loaded');
      // Always hand over PNG (pictures can be WebP/GIF/BMP).
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const png = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
      const out = await window.api.removeBackground(png);
      const src = await window.api.writeAsset(this.rel, out, 'png');
      const before = this.pageData(pageId);
      const after = { ...before, items: before.items.map((q) => (q.id === id ? { ...q, src } : q)) };
      const sel = this.tools.sel;
      const keep = sel && sel.pageId === pageId ? { index: sel.index, ids: sel.itemIds } : null;
      this.tools.clearSelection(true);
      this.commit(pageId, before, after);
      if (keep) this.tools.select(keep.index, pageId, new Set(), new Set(), keep.ids);
      toast('Background removed – Ctrl+Z brings it back', { timeout: 2500 });
    } catch (err) {
      toast('Could not remove the background: ' + (err && err.message || err), { error: true, timeout: 8000 });
    } finally {
      this.bgBusy = false;
      if (note && note.remove) note.remove();
    }
  },

  loadedImage(src) {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous'; // pixels readable (transparency hit test, background removal)
      img.src = this.assetUrl(src);
      img.onload = () => {
        for (const [pid, d] of Object.entries(this.doc.pages)) if (d.items && d.items.some((it) => it.src === src)) this.sidebar.invalidate(pid);
      };
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  },

  itemElement(it) {
    if (it.type === 'img') {
      // Rotation and transparency are on the <img>, so moving/scaling the
      // selection (a transform on the outer box) combines with them.
      return h('div', { class: 'item img-item', dataset: { id: it.id }, style: { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.h + 'px' } },
        h('img', { src: this.assetUrl(it.src), draggable: 'false', alt: '', style: { transform: it.r ? `rotate(${it.r}deg)` : '', opacity: it.o != null && it.o < 1 ? String(it.o) : '' } }));
    }
    if (it.type === 'table') return this.tableElement(it);
    return null; // unknown types (from newer versions) are kept in the data, not shown
  },

  tableElement(it) {
    const rows = it.cells || [];
    const table = h('table', { style: { fontFamily: fontCss(it.ff), fontSize: (it.fs || 12) + 'px', color: it.c || '#1c1c1e', width: it.cw.reduce((a, b) => a + b, 0) + 'px' } },
      h('colgroup', {}, ...it.cw.map((w) => h('col', { style: { width: w + 'px' } }))),
      ...rows.map((row, r) => h('tr', {}, ...it.cw.map((_, c) => {
        const cell = row[c] || {};
        const td = h('td', {
          dataset: { r, c },
          style: {
            background: cell.bg || (it.hdr && r === 0 ? '#eef2f7' : ''),
            fontWeight: cell.b || (it.hdr && r === 0) ? '700' : '', fontStyle: cell.i ? 'italic' : '', textDecoration: cell.u ? 'underline' : '',
            color: cell.c || '',
          },
        });
        if (cell.h) td.innerHTML = safeHtml(cell.h); else td.textContent = cell.t || '';
        return td;
      }))));
    return h('div', { class: 'item table-item', dataset: { id: it.id }, style: { left: it.x + 'px', top: it.y + 'px' } }, table);
  },

  // Row heights depend on the text – measure them and store (needed for
  // selection boxes and the PDF export). Silent: not an undo step.
  // The real height of text boxes (wrapped lines), so selection frames and
  // handles cover the whole text – also for pasted text never edited by hand.
  measureTexts(view) {
    requestAnimationFrame(() => {
      const pageId = view.page.id;
      const d = this.pageData(pageId);
      if (!d.texts.length || (this.textEdit && this.textEdit.pageId === pageId)) return;
      let changed = false;
      const texts = d.texts.map((t) => {
        const el = view.el.querySelector(`.textbox[data-id="${t.id}"]`);
        if (!el || !el.offsetHeight || t.h > 0) return t;
        const lines = Math.max(1, Math.round(el.offsetHeight / (t.fs * LINE_H)));
        if (lines === (t.lines || 1)) return t;
        changed = true;
        return { ...t, lines };
      });
      if (changed) {
        // only a measurement: stored with the next real change, the page
        // isn't marked as changed just by looking at it
        this.doc.pages[pageId] = { ...d, texts };
        if (this.tools.sel && this.tools.sel.pageId === pageId) this.tools.refreshSelectionEls();
      }
    });
  },

  measureTables(view) {
    requestAnimationFrame(() => {
      const pageId = view.page.id;
      const d = this.pageData(pageId);
      let changed = false;
      const items = d.items.map((it) => {
        if (it.type !== 'table') return it;
        const el = view.el.querySelector(`.item[data-id="${it.id}"] table`);
        if (!el) return it;
        const rh = [...el.rows].map((tr) => round2(tr.offsetHeight));
        if (!it.rh || rh.length !== it.rh.length || rh.some((x, i) => Math.abs(x - it.rh[i]) > 0.6)) {
          changed = true;
          return { ...it, rh };
        }
        return it;
      });
      if (changed) {
        this.doc.pages[pageId] = { ...d, items };
        this.markDirty(pageId);
      }
    });
  },

  editCell(pageId, itemId, r, c) {
    this.finishEditing();
    const v = this.viewer.viewById(pageId);
    const td = v && v.el.querySelector(`.item[data-id="${itemId}"] td[data-r="${r}"][data-c="${c}"]`);
    if (!td) return;
    this.cellEdit = { pageId, itemId, r, c, td, before: this.pageData(pageId) };
    td.setAttribute('contenteditable', 'true');
    td.classList.add('editing');
    td.focus();
    const range = document.createRange();
    range.selectNodeContents(td);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); td.blur(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        const it = this.pageData(pageId).items.find((x) => x.id === itemId);
        const cols = it.cw.length, rows = it.cells.length;
        let nr = r, nc = c + (e.shiftKey ? -1 : 1);
        if (nc >= cols) { nc = 0; nr++; }
        if (nc < 0) { nc = cols - 1; nr--; }
        this.finishCellEdit();
        if (nr >= rows) { this.tableOp(pageId, itemId, 'addRow'); }
        if (nr >= 0) requestAnimationFrame(() => this.editCell(pageId, itemId, nr, nc));
      }
    };
    const onPaste = (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    };
    td.addEventListener('keydown', onKey);
    td.addEventListener('paste', onPaste);
    td.addEventListener('blur', () => { td.removeEventListener('keydown', onKey); td.removeEventListener('paste', onPaste); this.finishCellEdit(); }, { once: true });
  },

  finishCellEdit() {
    const ce = this.cellEdit;
    if (!ce) return;
    this.cellEdit = null;
    ce.td.removeAttribute('contenteditable');
    ce.td.classList.remove('editing');
    const html = sanitizeHtml(ce.td.innerHTML);
    const rich = hasFormatting(html);
    const text = rich ? richToPlain(html) : (ce.td.innerText || '').replace(/\n$/, '');
    const before = ce.before;
    const it = before.items.find((x) => x.id === ce.itemId);
    if (!it) return;
    const old = (it.cells[ce.r] || [])[ce.c] || {};
    if ((old.t || '') === text && (old.h || '') === (rich ? html : '')) return;
    const cells = it.cells.map((row, r) => (r !== ce.r ? row : it.cw.map((_, c) => {
      const cell = row[c] || {};
      if (c !== ce.c) return cell;
      const n = { ...cell, t: text };
      if (rich) n.h = html; else delete n.h;
      return n;
    })));
    const after = { ...before, items: before.items.map((x) => (x.id === ce.itemId ? { ...x, cells, rh: undefined } : x)) };
    this.commit(ce.pageId, before, after);
  },

  tableOp(pageId, itemId, op) {
    const before = this.pageData(pageId);
    const it = before.items.find((x) => x.id === itemId);
    if (!it) return;
    const n = { ...it, cells: it.cells.map((r) => r.slice()), cw: it.cw.slice(), rh: undefined };
    const avg = n.cw.reduce((a, b) => a + b, 0) / n.cw.length;
    if (op === 'addRow') n.cells.push(n.cw.map(() => ({ t: '' })));
    if (op === 'addCol') { n.cw.push(round2(avg)); n.cells = n.cells.map((r) => r.concat([{ t: '' }])); }
    if (op === 'delRow' && n.cells.length > 1) n.cells.pop();
    if (op === 'delCol' && n.cw.length > 1) { n.cw.pop(); n.cells = n.cells.map((r) => r.slice(0, n.cw.length)); }
    if (op === 'header') n.hdr = !n.hdr;
    const sel = this.tools.sel;
    const keep = sel && sel.itemIds.has(itemId) ? { index: sel.index } : null;
    this.tools.clearSelection(true);
    this.commit(pageId, before, { ...before, items: before.items.map((x) => (x.id === itemId ? n : x)) });
    if (keep) requestAnimationFrame(() => requestAnimationFrame(() => this.tools.select(keep.index, pageId, new Set(), new Set(), new Set([itemId]))));
  },

  makeTable(rows, point) {
    const cols = Math.max(...rows.map((r) => r.length));
    const fs = 12;
    // Column widths from content length, within sensible bounds.
    const cw = Array.from({ length: cols }, (_, c) => {
      const longest = Math.max(4, ...rows.map((r) => ((r[c] && r[c].t) || '').split('\n').reduce((m, l) => Math.max(m, l.length), 0)));
      return round2(Math.min(220, Math.max(56, longest * fs * 0.55 + 10)));
    });
    const cells = rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] || { t: '' }));
    const total = cw.reduce((a, b) => a + b, 0);
    return {
      id: uid(), type: 'table', x: round2(point.x - total / 2), y: round2(point.y - 20), cw, cells, fs, ff: this.toolState.text.ff || DEFAULT_FONT,
      c: '#1c1c1e', hdr: rows.length > 1 && rows[0].every((c) => c.b),
    };
  },

  clampToPage(index, it) {
    const p = this.pages[index];
    if (p.kind === 'board') return it;
    const b = itemBBox(it);
    const w = b[2] - b[0], hh = b[3] - b[1];
    const ox = p.ox || 0, oy = p.oy || 0;
    it.x = round2(Math.max(ox + 8, Math.min(it.x, ox + p.w - w - 8)));
    it.y = round2(Math.max(oy + 8, Math.min(it.y, oy + p.h - hh - 8)));
    return it;
  },

  async insertImageBytes(bytes, mime, point) {
    const img = await prepareImage(bytes, mime);
    const src = await window.api.writeAsset(this.rel, img.bytes, img.ext);
    const page = this.pages[point.index];
    const vis = this.viewer.visibleWorldRect(point.index) || [0, 0, page.w, page.h];
    // Natural size in points (96 dpi screenshots → 0.75), fitted to the view and the page.
    let w = img.w * 0.75, hh = img.h * 0.75;
    const maxW = Math.min((vis[2] - vis[0]) * 0.7, page.kind === 'board' ? Infinity : page.w - 40);
    const maxH = (vis[3] - vis[1]) * 0.7;
    const k = Math.min(1, maxW / w, maxH / hh);
    w *= k; hh *= k;
    return this.clampToPage(point.index, { id: uid(), type: 'img', x: round2(point.x - w / 2), y: round2(point.y - hh / 2), w: round2(w), h: round2(hh), src });
  },

  async insertPictureDialog() {
    const files = await window.api.pickImages();
    if (!files.length) return;
    await this.placeImages(files.map((f) => ({ bytes: f.bytes, mime: mimeFromName(f.name) })), this.tools.pastePoint());
  },

  async placeImages(list, point) {
    const items = [];
    let p = { ...point };
    for (const f of list) {
      try {
        const it = await this.insertImageBytes(f.bytes, f.mime, p);
        items.push(it);
        p = { ...p, x: p.x + 20, y: p.y + 20 };
      } catch (err) {
        toast('Could not insert picture: ' + err.message, { error: true });
      }
    }
    if (items.length) this.tools.placeObjects(point.index, { items });
  },

  async insertTableDialog() {
    const v = await promptDialog('Insert table', '3 x 3', { label: 'Rows x columns', okLabel: 'Insert' });
    if (!v) return;
    const m = /^\s*(\d+)\s*[x×*,; ]\s*(\d+)\s*$/i.exec(v);
    if (!m) { toast('Write it like "3 x 4"', { error: true }); return; }
    const rows = Math.min(100, Math.max(1, +m[1])), cols = Math.min(20, Math.max(1, +m[2]));
    const point = this.tools.pastePoint();
    const t = this.makeTable(Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ t: '' }))), point);
    t.cw = t.cw.map(() => 90);
    t.x = round2(point.x - 45 * cols);
    this.tools.placeObjects(point.index, { items: [this.clampToPage(point.index, t)] });
  },

  // ---------- clipboard ----------
  onInternalCopy(clip) {
    this.app.clip = { ...clip, rel: this.rel };
  },

  writeClipboardMarker() {
    const c = this.app.clip;
    if (!c) return;
    // Plain text of the copied text boxes, followed by an invisible marker
    // that tells our paste handler to use the internal clipboard.
    const text = (c.texts || []).map((t) => t.text).join('\n');
    navigator.clipboard.writeText(text + MARKER + c.stamp).catch(() => {});
  },

  async onPaste(e) {
    const dt = e.clipboardData;
    if (!dt) return;
    e.preventDefault();
    const text = dt.getData('text/plain') || '';
    const html = dt.getData('text/html') || '';
    const files = [...dt.files];
    await this.pasteData({ text, html, files });
  },

  // "Paste" from the Insert menu (no paste event): use the async clipboard API.
  async pasteFromSystem() {
    try {
      const items = await navigator.clipboard.read();
      let text = '', html = '';
      const files = [];
      for (const item of items) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type === 'text/plain') text = await blob.text();
          else if (type === 'text/html') html = await blob.text();
          else if (type.startsWith('image/')) files.push(new File([blob], 'pasted', { type }));
        }
      }
      await this.pasteData({ text, html, files });
    } catch (err) {
      toast('Nothing to paste: ' + err.message, { error: true });
    }
  },

  async pasteData({ text, html, files }) {
    const point = this.tools.pastePoint();
    // 1. Our own objects (copied in StudyNotes).
    const mi = text.indexOf(MARKER);
    if (mi >= 0 && this.app.clip && text.slice(mi + MARKER.length) === String(this.app.clip.stamp)) {
      await this.pasteInternalClip(this.app.clip);
      return;
    }
    // 2. Tables (Excel, Word, web pages).
    const rows = (html && /<table/i.test(html) && tableFromHtml(html)) || null;
    if (rows) return this.tools.placeObjects(point.index, { items: [this.clampToPage(point.index, this.makeTable(rows, point))] });
    // 3. Pictures (screenshots, copied images).
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length) {
      return this.placeImages(await Promise.all(images.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }))), point);
    }
    // 4. Files copied in Explorer (pictures / PDFs). Chromium puts them into
    // the paste event's file list; the main-process lookup is the fallback.
    const pdfFile = files.find((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfFile) {
      const p = window.api.pathForFile(pdfFile);
      if (p) return this.insertPdfFile(p);
    }
    if (!text) {
      const copied = await window.api.clipboardFiles().catch(() => []);
      const imgs = copied.filter((f) => f.kind === 'image');
      if (imgs.length) return this.placeImages(imgs.map((f) => ({ bytes: f.bytes, mime: mimeFromName(f.name) })), point);
      const pdf = copied.find((f) => f.kind === 'pdf');
      if (pdf) return this.insertPdfFile(pdf.path);
    }
    // 5. Tab-separated text (spreadsheet cells without HTML).
    const tsv = tableFromTsv(text);
    if (tsv) return this.tools.placeObjects(point.index, { items: [this.clampToPage(point.index, this.makeTable(tsv, point))] });
    // 6. Text → new text box (plain by default; formatting if enabled).
    if (text.trim() || (html && this.settings.pasteFormatting)) {
      const ts = this.toolState.text;
      const rich = this.settings.pasteFormatting && html ? sanitizeHtml(html, true) : '';
      const plain = rich && hasFormatting(rich) ? richToPlain(rich) : text.replace(/\r/g, '').trim();
      const page = this.pages[point.index];
      const w = Math.min(420, page.kind === 'board' ? 420 : page.w - 60);
      const t = {
        id: uid(), x: round2(point.x - w / 2), y: round2(point.y - ts.size), w: round2(w), fs: ts.size, c: this.toolState.pen.color,
        text: plain, ff: ts.ff || DEFAULT_FONT, b: !!ts.b, i: !!ts.i, u: !!ts.u, lines: plain.split('\n').length,
      };
      if (rich && hasFormatting(rich)) t.html = rich;
      if (page.kind !== 'board') {
        t.x = round2(Math.max((page.ox || 0) + 20, Math.min(t.x, (page.ox || 0) + page.w - w - 20)));
        t.y = round2(Math.max((page.oy || 0) + 20, t.y));
      }
      this.tools.placeObjects(point.index, { texts: [t] });
      return;
    }
    toast('The clipboard is empty or contains nothing StudyNotes can paste');
  },

  async pasteInternalClip(clip) {
    // Pictures copied from another notebook: copy their files over.
    if (clip.rel !== this.rel) {
      for (const it of clip.items || []) {
        if (it.type !== 'img') continue;
        const res = await fetch(`sn://lib/${encodeRel(clip.rel)}/${it.src}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        await window.api.writeAsset(this.rel, bytes, it.src.split('.').pop());
      }
    }
    const index = this.tools.sel ? this.tools.sel.index : this.viewer.currentIndex;
    const samePage = clip.pageId === this.pages[index].id;
    // Same page: offset a little. Other page/notebook: same position, or under the pointer on boards.
    this.tools.pasteClip(clip, index, samePage ? 14 : 0);
  },

  // ---------- drag & drop onto the editor ----------
  installDrop() {
    const host = this.viewerHost;
    const over = (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      host.classList.add('drop-target');
    };
    const leave = (e) => { if (!host.contains(e.relatedTarget)) host.classList.remove('drop-target'); };
    const drop = async (e) => {
      host.classList.remove('drop-target');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const hit = this.viewer.hit(e.clientX, e.clientY);
      const point = hit ? { index: hit.index, x: hit.x, y: hit.y } : this.tools.pastePoint();
      const files = [...e.dataTransfer.files];
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (imgs.length) await this.placeImages(await Promise.all(imgs.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }))), point);
      const pdf = files.find((f) => /\.pdf$/i.test(f.name));
      if (pdf) await this.insertPdfFile(window.api.pathForFile(pdf), hit ? hit.index : undefined);
    };
    host.addEventListener('dragover', over);
    host.addEventListener('dragleave', leave);
    host.addEventListener('drop', drop);
    this._dropCleanup = () => { host.removeEventListener('dragover', over); host.removeEventListener('dragleave', leave); host.removeEventListener('drop', drop); };
  },

  // ---------- insert pages from a PDF ----------
  async insertPdfDialog(afterIndex) {
    try {
      const src = await window.api.addSourceDialog(this.rel);
      if (src) await this.insertFromSource(src, afterIndex);
    } catch (err) { toast('Could not insert the PDF: ' + err.message, { error: true }); }
  },

  async insertPdfFile(path, afterIndex) {
    try {
      const src = await window.api.addSourceFile(this.rel, path);
      await this.insertFromSource(src, afterIndex);
    } catch (err) { toast('Could not insert the PDF: ' + err.message, { error: true }); }
  },

  async insertFromSource(src, afterIndex = this.viewer.currentIndex) {
    const pdf = await PdfDoc.open(this.rel, src.file);
    const n = pdf.numPages;
    const choice = await new Promise((resolve) => {
      const range = h('input', { class: 'input', type: 'text', value: `1-${n}` });
      const pos = h('select', { class: 'input' },
        h('option', { value: 'after' }, `After the current page (${afterIndex + 1})`),
        h('option', { value: 'start' }, 'At the beginning'),
        h('option', { value: 'end' }, 'At the end'));
      const all = h('input', { type: 'radio', name: 'pdfrange', checked: true });
      const some = h('input', { type: 'radio', name: 'pdfrange' });
      range.addEventListener('focus', () => { some.checked = true; });
      modal({
        title: `Insert “${src.name}”`,
        width: 460,
        body: h('div', { class: 'form' },
          h('p', { class: 'modal-text' }, `${n} page${n === 1 ? '' : 's'} in this PDF.`),
          h('label', { class: 'check' }, all, h('span', {}, 'All pages')),
          h('label', { class: 'check' }, some, h('span', {}, 'Only pages', h('small', {}, 'e.g. 1-3, 7, 10-12'))),
          range,
          this.isBoard ? h('small', { class: 'hint' }, 'On a board the pages are placed as pictures next to each other.')
            : h('label', { class: 'field' }, h('span', {}, 'Where'), pos)),
        actions: [
          { label: 'Cancel', result: null },
          { label: 'Insert', primary: true, value: () => {
            const nums = all.checked ? Array.from({ length: n }, (_, i) => i + 1) : parseRange(range.value, n);
            if (!nums || !nums.length) { toast('Invalid page range', { error: true }); return false; }
            return { nums, where: pos.value };
          } },
        ],
        onClose: resolve,
      });
    });
    if (!choice) { pdf.destroy(); return; }
    const t = toast(`Inserting ${choice.nums.length} page${choice.nums.length === 1 ? '' : 's'}…`, { timeout: 120000 });
    try {
      if (this.isBoard) await this.placePdfOnBoard(pdf, choice.nums);
      else await this.insertPdfPages(src, pdf, choice.nums, choice.where, afterIndex);
    } finally {
      t.remove();
    }
  },

  async insertPdfPages(src, pdf, nums, where, afterIndex) {
    const sizes = [];
    for (const n of nums) {
      const vp = await pdf.viewport(n, 1);
      sizes.push({ w: round2(vp.width), h: round2(vp.height) });
    }
    this.doc.pdfs.set(src.id, pdf);
    const newPages = nums.map((n, i) => ({ id: uid(), kind: 'pdf', src: src.id, pdfPage: n, w: sizes[i].w, h: sizes[i].h }));
    const before = this.pages;
    const after = before.slice();
    const at = where === 'start' ? 0 : where === 'end' ? after.length : afterIndex + 1;
    after.splice(at, 0, ...newPages);
    const sourcesBefore = { ...(this.doc.nb.sources || {}) };
    const sourcesAfter = { ...sourcesBefore, [src.id]: { file: src.file, name: src.name } };
    this.pushPagesUndo(before, after, at, { before: sourcesBefore, after: sourcesAfter });
    this.viewer.scrollToPage(at, null, true);
    this.startIndexing(src.id);
    toast(`Inserted ${nums.length} page${nums.length === 1 ? '' : 's'}`);
  },

  async placePdfOnBoard(pdf, nums) {
    const point = this.tools.pastePoint();
    const items = [];
    let x = point.x, y = point.y;
    for (const n of nums) {
      const vp = await pdf.viewport(n, 1);
      const canvas = await pdf.render(n, 2, 0).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      canvas.width = canvas.height = 0;
      const src = await window.api.writeAsset(this.rel, new Uint8Array(await blob.arrayBuffer()), 'png');
      items.push({ id: uid(), type: 'img', x: round2(x), y: round2(y), w: round2(vp.width), h: round2(vp.height), src });
      x += vp.width + 24;
    }
    pdf.destroy();
    this.tools.placeObjects(point.index, { items });
  },
};

export { tableFromHtml, tableFromTsv };
