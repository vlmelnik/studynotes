'use strict';
// The main window split in two: notes on one side, the docked reference
// reader on the other, a divider between them. Pure; widths in px.

const DEFAULTS = { minPane: 280, divider: 6 };
const clampRatio = (ratio, width, { minPane, divider }) => {
  const free = width - divider;
  const lo = minPane / free, hi = 1 - minPane / free;
  return Math.min(hi, Math.max(lo, ratio));
};

function layout(state, width, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (state.mode !== 'split' || width < 2 * o.minPane + o.divider) return { notes: { x: 0, width }, reader: null, divider: null };
  const r = clampRatio(state.ratio == null ? 0.5 : state.ratio, width, o);
  const nw = Math.round((width - o.divider) * r), rw = width - o.divider - nw;
  if (state.notesSide === 'right') return { reader: { x: 0, width: rw }, divider: { x: rw, width: o.divider }, notes: { x: rw + o.divider, width: nw } };
  return { notes: { x: 0, width: nw }, divider: { x: nw, width: o.divider }, reader: { x: nw + o.divider, width: rw } };
}

/** The ratio for a divider dragged to x (its middle), clamped. */
function dragDivider(state, width, x, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const free = width - o.divider;
  const notesW = state.notesSide === 'right' ? width - (x + o.divider / 2) : x - o.divider / 2;
  return { ...state, ratio: clampRatio(notesW / free, width, o) };
}

const swap = (state) => ({ ...state, notesSide: state.notesSide === 'right' ? 'left' : 'right' });

function paneAt(l, x) {
  if (l.divider && x >= l.divider.x && x < l.divider.x + l.divider.width) return 'divider';
  if (l.reader && x >= l.reader.x && x < l.reader.x + l.reader.width) return 'reader';
  return 'notes';
}

module.exports = { layout, dragDivider, swap, paneAt };
