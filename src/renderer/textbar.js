// Floating dark text bar (GoodNotes style) shown under the text box that is
// being edited, or under selected text boxes. Every button goes through
// editor.applyTextStyle(), which styles the selected words, the whole box
// being edited, or all selected boxes.
import { h, showMenu, closeMenu } from './ui.js';
import { icon } from './icons.js';
import { FONTS, DEFAULT_FONT } from '../shared/fonts.js';
import { boxStyle, BOX_PRESETS } from '../shared/textbox.js';

export const TEXT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96];

// Size field: type any number, ▲▼ step through the common sizes, ▾ lists them.
// Used for text and for pen / highlighter / eraser (with their own lists).
export function sizeControl(value, apply, cls = 'tb-size', { list = TEXT_SIZES, min = 4, max = 400, title = 'Text size – type any number', unit = '' } = {}) {
  const round = (n) => Math.round(n * 10) / 10;
  const input = h('input', { class: cls, type: 'number', min: String(min), max: String(max), step: min < 1 ? '0.1' : '1', value: String(round(value)), title });
  const commit = () => { const n = parseFloat(input.value); if (n >= min && n <= max && Math.abs(n - value) > 0.01) apply(round(n)); else input.value = String(round(value)); };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
    if (e.key === 'Escape') { input.value = String(round(value)); input.blur(); }
  });
  const step = (dir) => {
    const cur = parseFloat(input.value) || value;
    const next = dir > 0 ? list.find((s) => s > cur + 0.01) : [...list].reverse().find((s) => s < cur - 0.01);
    if (next) apply(next);
  };
  const keep = (e) => e.preventDefault(); // keep the text selection
  const arrows = h('div', { class: 'size-arrows' },
    h('button', { title: 'Bigger', onmousedown: keep, onclick: () => step(1), html: '<svg viewBox="0 0 10 6"><path d="M1 5l4-4 4 4"/></svg>' }),
    h('button', { title: 'Smaller', onmousedown: keep, onclick: () => step(-1), html: '<svg viewBox="0 0 10 6"><path d="M1 1l4 4 4-4"/></svg>' }));
  const drop = h('button', { class: 'size-drop', title: 'Common sizes', onmousedown: keep, html: '<svg viewBox="0 0 10 6"><path d="M1 1l4 4 4-4"/></svg>',
    onclick: (e) => {
      const m = showMenu(list.map((s) => ({ label: String(s) + unit, checked: Math.abs(s - value) < 0.01, onClick: () => apply(s) })), 0, 0, e.currentTarget.parentElement);
      m.classList.add('dark-menu', 'size-list');
      m.addEventListener('mousedown', keep);
    } });
  return h('div', { class: 'size-ctl' }, input, drop, arrows);
}
const ALIGN_NEXT = { left: 'center', center: 'right', right: 'left' };
const ALIGN_ICON = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' };

// Small preview square of a box style (slash = no box).
function swatch(box) {
  if (!box) return h('span', { class: 'box-prev none' });
  return h('span', { class: 'box-prev', style: { background: box.bg || 'transparent', border: box.bc ? `1.5px solid ${box.bc}` : '1px solid rgba(255,255,255,.25)', borderRadius: Math.min(6, box.br || 0) + 'px' } });
}

export class TextBar {
  constructor(editor) {
    this.editor = editor;
    this.el = h('div', { class: 'text-bar', role: 'toolbar', 'aria-label': 'Text formatting' });
    // Keep the text selection when clicking buttons (inputs still get focus).
    this.el.addEventListener('mousedown', (e) => { if (!e.target.closest('input, select')) e.preventDefault(); });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.target = null; // { pageId, ids, editing }
    this.raf = 0;
  }

  mount(host) { host.append(this.el); }

  // Which text box(es) the bar is for right now, or null.
  currentTarget() {
    const ed = this.editor;
    if (ed.textEdit) return { pageId: ed.textEdit.pageId, ids: [ed.textEdit.id], editing: true };
    const sel = ed.tools && ed.tools.sel;
    if (sel && sel.textIds.size && !sel.strokeIds.size && !sel.itemIds.size) return { pageId: sel.pageId, ids: [...sel.textIds], editing: false };
    return null;
  }

  update() {
    const t = this.currentTarget();
    this.target = t;
    if (!t) { this.el.classList.remove('show'); return; }
    const texts = this.editor.pageData(t.pageId).texts.filter((x) => t.ids.includes(x.id));
    if (!texts.length) { this.el.classList.remove('show'); return; }
    this.render(texts[0], t);
    this.el.classList.add('show');
    this.position();
  }

  // Values shown in the bar: the selected words' style while editing, else the box's.
  displayed(t) {
    const out = { fs: t.fs, ff: t.ff || DEFAULT_FONT, c: t.c, b: !!t.b, i: !!t.i, u: !!t.u, al: t.al || 'left', box: boxStyle(t) };
    if (!this.target || !this.target.editing) return out;
    const s = window.getSelection();
    if (!s.rangeCount) return out;
    let node = s.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const box = node && node.closest('.textbox');
    if (!box) return out;
    const span = node.closest('span[data-fs], span[data-ff], span[data-c]');
    if (span && box.contains(span)) {
      if (span.dataset.fs) out.fs = +span.dataset.fs;
      if (span.dataset.ff) out.ff = span.dataset.ff;
      if (span.dataset.c) out.c = span.dataset.c;
    }
    out.b = document.queryCommandState('bold');
    out.i = document.queryCommandState('italic');
    out.u = document.queryCommandState('underline');
    return out;
  }

  render(t) {
    const ed = this.editor;
    const v = this.displayed(t);
    const apply = (change) => { ed.applyTextStyle(change); this.update(); };
    const btn = (ic, title, fn, active = false, cls = '') => h('button', {
      class: `tb-btn${active ? ' active' : ''} ${cls}`, title, 'aria-label': title,
      html: typeof ic === 'string' && ic.startsWith('<') ? ic : icon(ic, 20), onclick: fn,
    });
    const sep = () => h('span', { class: 'tb-sep2' });

    const colorBtn = h('button', {
      class: 'tb-color', title: 'Text colour', style: { background: v.c },
      onclick: (e) => this.colorMenu(e.currentTarget, (c) => apply({ color: c })),
    });
    const size = sizeControl(v.fs, (n) => apply({ size: n }));
    const font = h('button', {
      class: 'tb-font', title: 'Font', style: { fontFamily: `"${(FONTS[v.ff] || FONTS[DEFAULT_FONT]).css}"` },
      onclick: (e) => this.fontMenu(e.currentTarget, v.ff, (ff) => apply({ ff })),
    }, (FONTS[v.ff] || FONTS[DEFAULT_FONT]).label);

    this.el.replaceChildren(
      colorBtn,
      size,
      font,
      btn('<b>B</b>', 'Bold (Ctrl+B)', () => apply({ b: !v.b }), v.b, 'fmt'),
      btn('<i>I</i>', 'Italic (Ctrl+I)', () => apply({ i: !v.i }), v.i, 'fmt'),
      btn('<u>U</u>', 'Underline (Ctrl+U)', () => apply({ u: !v.u }), v.u, 'fmt'),
      btn(ALIGN_ICON[v.al], `Alignment: ${v.al}`, () => apply({ al: ALIGN_NEXT[v.al] })),
      btn('list', 'Bullet list', () => apply({ list: !String(t.text || '').startsWith('• ') }), String(t.text || '').startsWith('• ')),
      btn('formatPaint', 'Format painter: copy this style, then select other text', () => {
        ed.formatPainter = { ff: v.ff, size: v.fs, color: v.c, b: !!v.b, i: !!v.i, u: !!v.u };
        ed.el.classList.add('painting');
        ed.toast('Now select the text that should get this style');
      }, !!ed.formatPainter),
      h('button', { class: 'tb-btn tb-box' + (v.box ? ' active' : ''), title: 'Text box style', 'aria-label': 'Text box style', onclick: (e) => this.boxMenu(e.currentTarget, v.box, (box) => apply({ box })) }, swatch(v.box)),
      sep(),
      btn('cut', 'Cut', () => this.boxAction('cut')),
      btn('duplicate', 'Duplicate', () => this.boxAction('duplicate')),
      btn('trash', 'Delete', () => this.boxAction('delete'), false, 'danger'),
      btn('more', 'More', (e) => this.moreMenu(e.currentTarget)),
    );
  }

  // Under the box; above it when there is no room below.
  position() {
    const t = this.target;
    if (!t) return;
    const v = this.editor.viewer.viewById(t.pageId);
    const host = this.el.parentElement;
    if (!v || !host) { this.el.classList.remove('show'); return; }
    let r = null;
    for (const id of t.ids) {
      const wrap = v.el.querySelector(`.textbox-wrap[data-id="${id}"]`);
      if (!wrap) continue;
      const b = wrap.getBoundingClientRect();
      r = r ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }
    if (!r) { this.el.classList.remove('show'); return; }
    const hr = host.getBoundingClientRect();
    const bw = this.el.offsetWidth, bh = this.el.offsetHeight;
    let x = (r.left + r.right) / 2 - hr.left - bw / 2;
    let y = r.bottom - hr.top + 14;
    if (y + bh > hr.height - 8) y = r.top - hr.top - bh - 14;
    x = Math.max(8, Math.min(x, hr.width - bw - 8));
    y = Math.max(8, Math.min(y, hr.height - bh - 8));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  schedulePosition() {
    if (this.raf || !this.target) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.position(); });
  }

  colorMenu(anchor, pick) {
    const ed = this.editor;
    const colors = [...new Set([...(ed.settings.recentColors || []), ...ed.palette])].slice(0, 24);
    const m = showMenu([], 0, 0, anchor);
    m.classList.add('dark-menu');
    const grid = h('div', { class: 'color-grid' },
      ...colors.map((c) => h('button', { class: 'swatch', style: { background: c }, title: c, onclick: () => { closeMenu(); ed.rememberColor(c); pick(c); } })),
      h('label', { class: 'swatch custom', title: 'Any colour' },
        h('input', { type: 'color', onchange: (e) => { closeMenu(); ed.rememberColor(e.target.value); pick(e.target.value); } })));
    m.append(grid);
  }

  // "Text box style": presets, or any fill / border / corners.
  boxMenu(anchor, current, pick) {
    const m = showMenu([], 0, 0, anchor);
    m.classList.add('dark-menu', 'box-menu');
    const same = (a, b) => (!a && !b) || (a && b && (a.bg || null) === (b.bg || null) && (a.bc || null) === (b.bc || null) && (a.br || 0) === (b.br || 0));
    const body = h('div', { class: 'box-body' });
    const tabs = h('div', { class: 'box-tabs' });
    const show = (which) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === which));
      body.replaceChildren(which === 'presets' ? presets() : custom());
    };
    const presets = () => h('div', { class: 'box-grid' }, ...BOX_PRESETS.map((p) => h('button', {
      class: 'box-swatch' + (same(p, current) ? ' on' : ''), title: p ? 'Box style' : 'No box',
      onclick: () => { closeMenu(); pick(p); },
    }, swatch(p))));
    const custom = () => {
      const cur = { bg: current && current.bg || null, bc: current && current.bc || null, br: current ? current.br || 0 : 6 };
      const colors = ['#ffffff', '#fff6c8', '#ffff5c', '#b4ff52', '#ffd9cf', '#eef4ff', '#f25a5a', '#3c4150', '#4a5a85', '#1c1c1e'];
      const row = (label, key) => h('div', { class: 'box-row' }, h('span', { class: 'box-label' }, label),
        h('button', { class: 'box-dot none' + (!cur[key] ? ' on' : ''), title: 'None', onclick: () => { cur[key] = null; done(); } }),
        ...colors.map((c) => h('button', { class: 'box-dot' + (cur[key] === c ? ' on' : ''), style: { background: c }, title: c, onclick: () => { cur[key] = c; done(); } })),
        h('label', { class: 'box-dot custom', title: 'Any colour' }, h('input', { type: 'color', value: cur[key] || '#ffffff', onchange: (e) => { cur[key] = e.target.value; done(); } })));
      const corners = h('div', { class: 'box-row' }, h('span', { class: 'box-label' }, 'Corners'),
        ...[['Square', 0], ['Round', 6], ['Extra round', 14]].map(([l, r]) => h('button', { class: 'box-chip' + (cur.br === r ? ' on' : ''), onclick: () => { cur.br = r; done(); } }, l)));
      const done = () => { pick(cur.bg || cur.bc ? { ...cur } : null); current = cur.bg || cur.bc ? { ...cur } : null; show('custom'); };
      return h('div', {}, row('Fill', 'bg'), row('Border', 'bc'), corners);
    };
    tabs.append(
      h('button', { dataset: { tab: 'presets' }, onclick: () => show('presets') }, 'Presets'),
      h('button', { dataset: { tab: 'custom' }, onclick: () => show('custom') }, 'Custom'));
    m.append(h('div', { class: 'box-title' }, 'Text box style'), tabs, body);
    show('presets');
  }

  fontMenu(anchor, current, pick) {
    showMenu(Object.entries(FONTS).map(([id, f]) => ({ label: f.label, checked: id === current, onClick: () => pick(id) })), 0, 0, anchor)
      .querySelectorAll('.mi-label').forEach((el, k) => { el.style.fontFamily = `"${Object.values(FONTS)[k].css}"`; });
  }

  moreMenu(anchor) {
    const ed = this.editor;
    showMenu([
      { label: 'Copy', icon: 'copy', onClick: () => this.boxAction('copy') },
      { label: 'Bring to front', icon: 'front', onClick: () => this.boxAction('front') },
      { label: 'Send to back', icon: 'back', onClick: () => this.boxAction('back') },
      'sep',
      { label: 'Paste formatting as plain text', icon: 'text', checked: !ed.settings.pasteFormatting, onClick: () => { ed.settings.pasteFormatting = !ed.settings.pasteFormatting; ed.app.saveSettings(); } },
    ], 0, 0, anchor);
  }

  // Box-level actions work the same whether the box is being edited or selected.
  boxAction(what) {
    const ed = this.editor;
    const t = this.target;
    if (!t) return;
    if (t.editing) {
      ed.finishEditing(true);
      const index = ed.pages.findIndex((p) => p.id === t.pageId);
      ed.tools.select(index, t.pageId, new Set(), new Set(t.ids), new Set());
    }
    const tools = ed.tools;
    if (!tools.sel) return;
    if (what === 'cut') tools.cut();
    else if (what === 'copy') tools.copy();
    else if (what === 'duplicate') tools.duplicate();
    else if (what === 'delete') tools.deleteSelection();
    else if (what === 'front') tools.order(1);
    else if (what === 'back') tools.order(-1);
    this.update();
  }
}
