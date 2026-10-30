'use strict';
// Paper backgrounds as plain geometry, drawn both on canvas and in the export.

const PAPERS = [
  ['blank', 'Blank'],
  ['lined', 'Lined'],
  ['narrow', 'Narrow ruled'],
  ['college', 'College ruled'],
  ['grid', 'Grid 5 mm'],
  ['grid10', 'Grid 10 mm'],
  ['engineering', 'Engineering'],
  ['dotted', 'Dotted'],
  ['isometric', 'Isometric'],
  ['hex', 'Hexagon'],
  ['cornell', 'Cornell notes'],
  ['todo', 'To-do list'],
  ['music', 'Music staff'],
  ['legal', 'Legal'],
  ['columns3', 'Three columns'],
  ['weekly', 'Weekly planner'],
  ['monthly', 'Monthly planner'],
  ['accounting', 'Accounting'],
];

// Groups shown in the template picker.
const PAPER_GROUPS = [
  ['Essentials', ['blank', 'dotted', 'narrow', 'lined', 'grid', 'grid10']],
  ['Writing papers', ['college', 'legal', 'cornell', 'columns3', 'engineering', 'isometric', 'hex', 'music']],
  ['Planner', ['todo', 'weekly', 'monthly', 'accounting']],
];

// Paper colours: what you see, and what the PDF export uses (cream exports as white).
const PAPER_COLORS = {
  cream: { label: 'Cream paper', bg: '#FAF6E8', export: '#ffffff' },
  white: { label: 'White paper', bg: '#ffffff', export: '#ffffff' },
  dark: { label: 'Dark paper', bg: '#26272b', export: '#26272b' },
};

// Notebook covers (first page). style: 'simple' (spine on the left, title
// line) or 'solid' (stripe near the right edge).
const COVERS = [
  ['Simple', [
    { name: 'Simple', style: 'simple', color: '#b5a088', accent: '#ffffff' },
    { name: 'Simple yellow', style: 'simple', color: '#b5a088', accent: '#f7e858' },
    { name: 'Simple all black', style: 'simple', color: '#353841', accent: '#0d0d0f' },
    { name: 'Simple black', style: 'simple', color: '#b5a088', accent: '#353841' },
    { name: 'Simple blue', style: 'simple', color: '#b5a088', accent: '#7eaee8' },
  ]],
  ['Solid', [
    { name: 'Baby blue', style: 'solid', color: '#a3c8f0', accent: '#1a7cf5' },
    { name: 'Blue', style: 'solid', color: '#0f4c8c', accent: '#a3c8f0' },
    { name: 'Green', style: 'solid', color: '#7da86c', accent: '#9bd24f' },
    { name: 'Gray', style: 'solid', color: '#383b44', accent: '#9bd24f' },
    { name: 'Pink', style: 'solid', color: '#f6d6cf', accent: '#e05a5a' },
    { name: 'Red', style: 'solid', color: '#b4483d', accent: '#f2c2a0' },
    { name: 'Purple', style: 'solid', color: '#6b4fa0', accent: '#d6c3ff' },
  ]],
];

/** Background of a page on screen, or (exp = true) in the PDF. */
function pageBackground(page, exp = false) {
  if (!page || page.kind === 'pdf') return '#ffffff';
  if (page.kind === 'board') return '#fbfaf8';
  if (page.paper === 'cover' && page.cover) return page.cover.color;
  const c = PAPER_COLORS[page.pc] || PAPER_COLORS.cream;
  return exp ? c.export : c.bg;
}

const PAGE_SIZES = {
  A4: [595.28, 841.89],
  'A4 landscape': [841.89, 595.28],
  A5: [419.53, 595.28],
  A3: [841.89, 1190.55],
  B5: [498.9, 708.66],
  Letter: [612, 792],
  'Slide 16:9': [960, 540],
};

const LIGHT = {
  line: '#c5d3e6',
  grid: '#d9e1ec',
  gridMajor: '#b3c3d9',
  dot: '#aab6c6',
  margin: '#efb2b2',
  box: '#9fb0c6',
  staff: '#8d99a8',
};
const DARK = {
  line: '#4a5060',
  grid: '#3c414c',
  gridMajor: '#596071',
  dot: '#5f6573',
  margin: '#8a4f55',
  box: '#68707f',
  staff: '#727a89',
};

const MM = 2.8346;

// Returns { lines: [[x1,y1,x2,y2,color,width]], dots: [[x,y,r,color]] }
// For unbounded boards pass the area to cover as `area` = [x0, y0, x1, y1].
// Returns also rects: [[x, y, w, h, color]] (covers).
function paperGeometry(kind, w, h, area, pc, cover) {
  const COLORS = pc === 'dark' ? DARK : LIGHT;
  const lines = [];
  const dots = [];
  const rects = [];
  const [ax0, ay0, ax1, ay1] = area || [0, 0, w, h];
  const ruled = (gap, top, margin) => {
    for (let y = top; y < h - 24; y += gap) lines.push([0, y, w, y, COLORS.line, 0.6]);
    if (margin) lines.push([margin, 0, margin, h, COLORS.margin, 0.8]);
  };
  // Grid lines aligned to a global origin, so boards can render any area.
  const grid = (gap, color, width) => {
    for (let x = Math.ceil(ax0 / gap) * gap; x < ax1; x += gap) if (x > 0 || area) lines.push([x, ay0, x, ay1, color, width]);
    for (let y = Math.ceil(ay0 / gap) * gap; y < ay1; y += gap) if (y > 0 || area) lines.push([ax0, y, ax1, y, color, width]);
  };
  switch (kind) {
    case 'lined': ruled(24, 72, 60); break;
    case 'narrow': ruled(18, 72, 60); break;
    case 'college': ruled(20, 90, 72); break;
    case 'grid': grid(5 * MM, COLORS.grid, 0.5); break;
    case 'grid10': grid(10 * MM, COLORS.grid, 0.6); break;
    case 'engineering':
      grid(5 * MM, COLORS.grid, 0.4);
      grid(25 * MM, COLORS.gridMajor, 0.8);
      break;
    case 'dotted':
    case 'board': {
      const gap = 5 * MM;
      for (let y = Math.ceil(ay0 / gap) * gap; y < ay1; y += gap) {
        for (let x = Math.ceil(ax0 / gap) * gap; x < ax1; x += gap) if ((x > 0 && y > 0) || area) dots.push([x, y, kind === 'board' ? 1 : 0.8, COLORS.dot]);
      }
      break;
    }
    case 'isometric': {
      const gx = 5 * MM, gy = gx * Math.sqrt(3) / 2;
      let row = 0;
      for (let y = gy; y < h; y += gy, row++) {
        for (let x = row % 2 ? gx / 2 : gx; x < w; x += gx) dots.push([x, y, 0.8, COLORS.dot]);
      }
      break;
    }
    case 'hex': {
      const r = 4 * MM, dx = r * 1.5, dy = r * Math.sqrt(3);
      for (let col = 0, x = 0; x < w + r; x += dx, col++) {
        for (let y = col % 2 ? dy / 2 : 0; y < h + r; y += dy) {
          for (let k = 0; k < 6; k++) {
            const a1 = (Math.PI / 3) * k, a2 = (Math.PI / 3) * (k + 1);
            lines.push([x + r * Math.cos(a1), y + r * Math.sin(a1), x + r * Math.cos(a2), y + r * Math.sin(a2), COLORS.grid, 0.5]);
          }
        }
      }
      break;
    }
    case 'cornell': {
      const cue = w * 0.3, summary = h * 0.78, top = 90;
      for (let y = top; y < summary - 4; y += 22) lines.push([cue, y, w - 24, y, COLORS.line, 0.6]);
      lines.push([24, top - 18, w - 24, top - 18, COLORS.box, 1.2]);
      lines.push([cue, top - 18, cue, summary, COLORS.box, 1.2]);
      lines.push([24, summary, w - 24, summary, COLORS.box, 1.2]);
      for (let y = summary + 26; y < h - 24; y += 22) lines.push([24, y, w - 24, y, COLORS.line, 0.6]);
      break;
    }
    case 'todo': {
      const gap = 28, top = 80, bx = 40, s = 11;
      for (let y = top; y < h - 30; y += gap) {
        lines.push([bx + s + 10, y, w - 30, y, COLORS.line, 0.6]);
        const by = y - s - 3;
        lines.push([bx, by, bx + s, by, COLORS.box, 0.9], [bx + s, by, bx + s, by + s, COLORS.box, 0.9],
          [bx + s, by + s, bx, by + s, COLORS.box, 0.9], [bx, by + s, bx, by, COLORS.box, 0.9]);
      }
      break;
    }
    case 'music': {
      const lineGap = 7, staffGap = 52, left = 36, right = w - 36;
      for (let y = 80; y + 4 * lineGap < h - 40; y += 4 * lineGap + staffGap) {
        for (let k = 0; k < 5; k++) lines.push([left, y + k * lineGap, right, y + k * lineGap, COLORS.staff, 0.6]);
        lines.push([left, y, left, y + 4 * lineGap, COLORS.staff, 0.8], [right, y, right, y + 4 * lineGap, COLORS.staff, 0.8]);
      }
      break;
    }
    case 'legal':
      ruled(24, 72, 0);
      lines.push([64, 0, 64, h, COLORS.margin, 0.8], [68, 0, 68, h, COLORS.margin, 0.8]);
      break;
    case 'columns3': {
      const m = 36, top = 70, gap = 14, cw = (w - 2 * m - 2 * gap) / 3;
      for (let c = 0; c < 3; c++) {
        const x0 = m + c * (cw + gap);
        lines.push([x0, top - 20, x0 + cw, top - 20, COLORS.box, 1]);
        for (let y = top; y < h - 30; y += 22) lines.push([x0, y, x0 + cw, y, COLORS.line, 0.6]);
      }
      break;
    }
    case 'weekly': {
      const m = 30, top = 60, rows = 7, rh = (h - top - 30) / rows;
      for (let r = 0; r <= rows; r++) lines.push([m, top + r * rh, w - m, top + r * rh, COLORS.box, r === 0 || r === rows ? 1.1 : 0.8]);
      lines.push([m + 70, top, m + 70, h - 30, COLORS.box, 0.8]);
      for (let r = 0; r < rows; r++) for (let y = top + r * rh + 22; y < top + (r + 1) * rh - 4; y += 20) lines.push([m + 78, y, w - m, y, COLORS.line, 0.5]);
      break;
    }
    case 'monthly': {
      const m = 30, top = 90, cols = 7, rows = 6, cw = (w - 2 * m) / cols, rh = (h - top - 30) / rows;
      lines.push([m, top - 30, w - m, top - 30, COLORS.box, 1]);
      for (let r = 0; r <= rows; r++) lines.push([m, top + r * rh, w - m, top + r * rh, COLORS.box, 0.8]);
      for (let c = 0; c <= cols; c++) lines.push([m + c * cw, top, m + c * cw, top + rows * rh, COLORS.box, 0.8]);
      break;
    }
    case 'accounting': {
      const m = 30, top = 70, gap = 18;
      for (let y = top; y < h - 30; y += gap) lines.push([m, y, w - m, y, COLORS.grid, 0.5]);
      for (const fx of [0.12, 0.62, 0.74, 0.87]) lines.push([m + (w - 2 * m) * fx, top - gap, m + (w - 2 * m) * fx, h - 30, COLORS.box, 0.8]);
      lines.push([m, top, w - m, top, COLORS.box, 1.1]);
      break;
    }
    case 'cover': {
      const c = cover || { style: 'simple', color: '#b5a088', accent: '#ffffff' };
      const dark = isDark(c.color);
      const ink = dark ? '#6b6e78' : '#8a7a68'; // hex: the PDF export needs plain colours
      rects.push([w - w * 0.02, 0, w * 0.02, h, '#f4f2ee']); // page edge
      if (c.style === 'solid') {
        rects.push([w * 0.84, 0, w * 0.045, h, c.accent]);
      } else {
        rects.push([0, 0, w * 0.045, h, c.accent]);
        lines.push([w * 0.16, h * 0.34, w * 0.84, h * 0.34, ink, 1.2]);
        for (let k = 0; k < 4; k++) lines.push([w * 0.68, h * (0.82 + k * 0.03), w * 0.88, h * (0.82 + k * 0.03), ink, 0.8]);
      }
      break;
    }
    default: break;
  }
  return { lines, dots, rects };
}

function isDark(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

module.exports = { PAPERS, PAPER_GROUPS, PAPER_COLORS, PAGE_SIZES, COVERS, paperGeometry, pageBackground, isDark };
