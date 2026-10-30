'use strict';
// Text box look shared by the screen and the PDF export.
// A box has an optional fill (bg), border colour (bc) and corner radius (br).
// Version 1.2 stored only bx: '' | 'border' | 'fill' – still understood.

const BOX_PAD_X = 6;
const BOX_PAD_Y = 4;
const BOX_BORDER = 1.5;

// Presets of the "Text box style" popup (first entry = no box).
const BOX_PRESETS = [
  null,
  { bg: '#3c4150', br: 8 }, { bg: '#b4ff52', br: 8 }, { bg: '#ffd9cf', br: 8 }, { bg: '#ffffff', br: 8 },
  { bg: '#f25a5a', br: 0 }, { bg: '#ffff5c', br: 0 }, { bg: '#eef4ff', br: 0 }, { bg: '#4a5a85', br: 0 }, { bc: '#1c1c1e', br: 0 },
];

/** { bg, bc, br } or null when the text has no box. */
function boxStyle(t) {
  let bg = t.bg || null, bc = t.bc || null, br = t.br != null ? t.br : 6;
  if (!bg && !bc) {
    if (t.bx === 'border') { bc = '#6f7785'; br = 0; }
    else if (t.bx === 'fill') { bg = '#fff6c8'; br = 3; }
  }
  return bg || bc ? { bg, bc, br } : null;
}

/** Outline of a rounded rectangle as a polygon (for the PDF). */
function roundedRect(x, y, w, h, r, seg = 6) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

module.exports = { BOX_PAD_X, BOX_PAD_Y, BOX_BORDER, BOX_PRESETS, boxStyle, roundedRect };
