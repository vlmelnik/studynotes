// The notes style editor (font, size, colours for white and dark paper) used
// for the app-wide style (Settings → AI assistant) and a notebook's own style
// (chat settings). `value` is a partial style; onChange gets the new partial.
import { h } from './ui.js';
import { FONTS } from '../shared/fonts.js';
import { DEFAULT_STYLE, notesStyle } from '../shared/notes-layout.js';

const COLORS = [['text', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['accent', 'Key terms'], ['boxBg', 'Box fill'], ['boxBorder', 'Box border']];

export function notesStyleEditor(value, onChange, { base = null, resetLabel = 'Reset to default' } = {}) {
  let cur = JSON.parse(JSON.stringify(value || {}));
  const root = h('div', { class: 'notes-style' });
  const emit = () => { onChange(cur); draw(); };
  const draw = () => {
    const eff = notesStyle(base, cur);
    const font = h('select', { class: 'rec-select', 'aria-label': 'Notes font', onchange: (e) => { cur.ff = e.target.value; emit(); } },
      ...Object.entries(FONTS).map(([k, f]) => h('option', { value: k, selected: eff.ff === k }, f.label)));
    const size = h('input', { type: 'number', min: 9, max: 32, step: 0.5, value: eff.fs, class: 'ai-num', 'aria-label': 'Notes text size',
      onchange: (e) => { const v = Number(e.target.value); if (v >= 9 && v <= 32) { cur.fs = v; emit(); } } });
    const grid = h('div', { class: 'ns-grid' }, h('span', {}), h('b', {}, 'White paper'), h('b', {}, 'Dark paper'));
    for (const [k, label] of COLORS) {
      grid.append(h('span', {}, label));
      for (const mode of ['light', 'dark']) {
        grid.append(h('input', { type: 'color', value: eff[mode][k], 'aria-label': `${label} (${mode === 'light' ? 'white' : 'dark'} paper)`,
          onchange: (e) => { cur[mode] = { ...(cur[mode] || {}), [k]: e.target.value }; emit(); } }));
      }
    }
    const preview = (mode) => {
      const c = eff[mode];
      return h('div', { class: `ns-preview ${mode}`, style: { fontFamily: `"${(FONTS[eff.ff] || FONTS[DEFAULT_STYLE.ff]).css}"`, fontSize: eff.fs + 'px' } },
        h('div', { style: { color: c.h1, fontSize: eff.fs * 1.5 + 'px', fontWeight: 700 } }, 'Heading'),
        h('div', { style: { color: c.text } }, 'Text with a ', h('b', { style: { color: c.accent } }, 'key term'), '.'),
        h('div', { style: { color: c.text, background: c.boxBg, border: `1.5px solid ${c.boxBorder}`, borderRadius: '6px', padding: '2px 6px', marginTop: '4px' } }, h('b', { style: { color: c.accent } }, 'Remember'), ': a framed statement'));
    };
    root.replaceChildren(
      h('div', { class: 'ns-fields' }, h('span', {}, 'Font'), font, h('span', {}, 'Size'),
        h('div', { class: 'row' }, size, h('button', { class: 'btn ghost small', onclick: () => { cur = {}; emit(); } }, resetLabel))),
      h('div', { class: 'ns-previews' }, preview('light'), preview('dark')),
      grid);
  };
  draw();
  return root;
}
