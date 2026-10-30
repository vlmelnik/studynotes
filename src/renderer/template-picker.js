// GoodNotes-style template picker: a "Cover" tab and a "Paper" tab with
// thumbnails, paper colour (cream / white / dark), page size and orientation.
// Used for new notebooks (both tabs) and for adding pages (paper only).
import { h, modal } from './ui.js';
import { icon } from './icons.js';
import { drawPaper } from './inkrender.js';
import { PAPERS, PAPER_GROUPS, PAPER_COLORS, PAGE_SIZES, COVERS } from '../shared/paper.js';

const LABEL = Object.fromEntries(PAPERS);
const THUMB_W = 116;

function thumbCanvas(page) {
  const portrait = page.h >= page.w;
  const tw = portrait ? THUMB_W * 0.78 : THUMB_W;
  const scale = tw / page.w;
  const dpr = window.devicePixelRatio || 1;
  const c = h('canvas', { class: 'tp-canvas', style: { width: Math.round(page.w * scale) + 'px', height: Math.round(page.h * scale) + 'px' } });
  c.width = Math.round(page.w * scale * dpr);
  c.height = Math.round(page.h * scale * dpr);
  drawPaper(c.getContext('2d'), page, scale * dpr);
  return c;
}

/**
 * @param {object} o
 * @param {'notebook'|'page'} o.mode
 * @param {object} [o.initial] { title, paper, pc, size, landscape, cover, where }
 * @returns {Promise<null | { title, paper, pc, size, landscape, cover, where }>}
 */
export function templatePicker({ mode = 'notebook', initial = {} } = {}) {
  return new Promise((resolve) => {
    const st = {
      title: initial.title || 'Untitled Notebook',
      paper: initial.paper || 'lined',
      pc: initial.pc || 'cream',
      size: initial.size || 'A4',
      landscape: !!initial.landscape,
      cover: initial.cover === undefined ? COVERS[0][1][0] : initial.cover,
      where: initial.where || 'after',
      tab: mode === 'page' ? 'paper' : 'cover',
    };
    const dims = () => {
      let [w, hh] = PAGE_SIZES[st.size] || PAGE_SIZES.A4;
      if (st.landscape !== (w > hh)) [w, hh] = [hh, w];
      return [w, hh];
    };
    const body = h('div', { class: 'tp-body' });
    const tabs = h('div', { class: 'tp-tabs' });
    const bar = h('div', { class: 'tp-bar' });

    const select = (options, value, onChange, cls = '') => {
      const s = h('select', { class: `tp-select ${cls}` }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const renderBar = () => {
      const orient = h('div', { class: 'tp-orient' },
        h('button', { class: !st.landscape ? 'on' : '', title: 'Portrait', html: icon('page', 18), onclick: () => { st.landscape = false; render(); } }),
        h('button', { class: st.landscape ? 'on' : '', title: 'Landscape', html: icon('pageLandscape', 18), onclick: () => { st.landscape = true; render(); } }));
      bar.replaceChildren(...[
        select(Object.keys(PAGE_SIZES).filter((k) => !/landscape/i.test(k)).map((k) => [k, k]), st.size, (v) => { st.size = v; render(); }),
        st.tab === 'paper' ? select(Object.entries(PAPER_COLORS).map(([k, c]) => [k, c.label]), st.pc, (v) => { st.pc = v; render(); }, 'tp-pc') : null,
        orient,
        mode === 'page' ? h('div', { class: 'tp-where' },
          ...[['before', 'Before this page'], ['after', 'After this page']].map(([k, l]) => h('button', { class: st.where === k ? 'on' : '', dataset: { where: k }, onclick: () => { st.where = k; render(); } }, l))) : null].filter(Boolean));
    };
    const tile = (canvas, label, active, onClick, extra) => h('button', { class: `tp-tile${active ? ' active' : ''}`, title: label, onclick: onClick },
      h('div', { class: 'tp-thumb' }, canvas), h('div', { class: 'tp-label' }, label), extra || null);
    const group = (name, tiles) => h('section', { class: 'tp-group' }, h('h4', {}, name), h('div', { class: 'tp-row' }, ...tiles));

    const renderBody = () => {
      const [w, hh] = dims();
      if (st.tab === 'cover') {
        const none = tile(h('div', { class: 'tp-nocover', style: { width: (hh >= w ? THUMB_W * 0.78 : THUMB_W) + 'px', height: Math.round((hh >= w ? THUMB_W * 0.78 : THUMB_W) * hh / w) + 'px' } }, 'No cover'),
          'No cover', !st.cover, () => { st.cover = null; render(); });
        body.replaceChildren(
          ...COVERS.map(([gname, list]) => group(gname, list.map((c) => tile(
            thumbCanvas({ kind: 'paper', paper: 'cover', cover: c, w, h: hh }), c.name,
            !!st.cover && st.cover.name === c.name, () => { st.cover = c; render(); })))),
          group('Other', [none]));
      } else {
        body.replaceChildren(...PAPER_GROUPS.map(([gname, kinds]) => group(gname, kinds.map((k) => tile(
          thumbCanvas({ kind: 'paper', paper: k, pc: st.pc, w, h: hh }), LABEL[k] || k, st.paper === k,
          () => { st.paper = k; render(); })))));
      }
    };
    const renderTabs = () => {
      tabs.replaceChildren(...(mode === 'page' ? [['paper', 'Paper']] : [['cover', 'Cover'], ['paper', 'Paper']]).map(([k, l]) => h('button', {
        class: st.tab === k ? 'on' : '', dataset: { tab: k }, onclick: () => { st.tab = k; render(); },
      }, l)));
    };
    const render = () => {
      const top = body.scrollTop;
      renderTabs(); renderBar(); renderBody();
      body.scrollTop = top;
    };
    const title = h('input', { class: 'input tp-title', type: 'text', value: st.title, placeholder: 'Title' });
    title.addEventListener('input', () => { st.title = title.value; });
    render();
    modal({
      title: mode === 'page' ? 'Add page' : 'New notebook',
      width: 760,
      body: h('div', { class: 'tp' }, mode === 'notebook' ? title : null, tabs, bar, body),
      actions: [
        { label: 'Cancel', result: null },
        { label: mode === 'page' ? 'Add page' : 'Create', primary: true, value: () => ({ ...st, title: (st.title || '').trim() || 'Untitled Notebook' }) },
      ],
      onClose: (v) => resolve(v || null),
    });
  });
}
