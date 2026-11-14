'use strict';
// Small helpers shared by the main process, the renderer and the other
// shared modules (pure: no Node, Electron or DOM).

/** Line height of text boxes, as a multiple of the font size. */
const LINE_H = 1.3;

/** Escapes the characters that matter in HTML text. */
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Median of numbers (the upper middle one for an even count); undefined for an empty list. Leaves `a` as it is. */
const median = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];

/** Like median, but 0 for an empty list. */
const medianOr0 = (a) => (a.length ? median(a) : 0);

module.exports = { LINE_H, escHtml, median, medianOr0 };
