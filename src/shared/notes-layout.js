'use strict';
// Notes written by the AI (write_notes): the model sends the structure –
// headings, paragraphs, lists, formulas, a "remember" box – and this module
// lays it out like a person would: on the ruled lines of the paper, inside
// the margins, below what is already on the page, with the size and colour of
// the notes style, and onto the next page (or a new one) when a page is full.
// Pure: text width comes from the caller (canvas in the app, an estimate in tests).

const { paperGeometry } = require('./paper');
const { parseRich, layoutRich, richToPlain } = require('./richtext');
const { escHtml } = require('./util');

const MATH = 'rich-paste:math';

// ---------- notes style ----------

const DEFAULT_STYLE = {
  ff: 'inter',
  fs: 15,
  light: { text: '#1c1c1e', h1: '#1f3f8f', h2: '#0f6b52', h3: '#8a4b00', accent: '#1f3f8f', boxBg: '#eef4ff', boxBorder: '#1f3f8f' },
  dark: { text: '#e9ecf2', h1: '#8cc8ff', h2: '#9be3b0', h3: '#ffd88a', accent: '#ffd88a', boxBg: '#2e3a4d', boxBorder: '#8cc8ff' },
};
const COLOR_KEYS = Object.keys(DEFAULT_STYLE.light);
const HEX = /^#[0-9a-f]{6}$/i;

/** The notes style: defaults, then the app setting, then the notebook's own (each may be partial). */
function notesStyle(...layers) {
  const out = { ff: DEFAULT_STYLE.ff, fs: DEFAULT_STYLE.fs, light: { ...DEFAULT_STYLE.light }, dark: { ...DEFAULT_STYLE.dark } };
  for (const s of layers) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.ff === 'string' && s.ff) out.ff = s.ff;
    if (Number(s.fs) >= 9 && Number(s.fs) <= 32) out.fs = Number(s.fs);
    for (const mode of ['light', 'dark']) for (const k of COLOR_KEYS) if (s[mode] && HEX.test(s[mode][k] || '')) out[mode][k] = s[mode][k];
  }
  return out;
}

/** Light or dark colours for a page (dark paper → light text). */
const isDarkPage = (page) => !!page && page.kind !== 'pdf' && page.pc === 'dark';

// ---------- the rows of a page ----------

/**
 * Where lines of text go on a page: { rows: [y of each baseline], left, right }.
 * Ruled paper: its lines; grid paper: every second grid line (or every one if
 * large enough); anything else: an even spacing from the body size.
 */
function pageRows(page, body) {
  const w = page.w, h = page.h;
  let left = 48, right = w - 40, rows = [];
  if (page.kind !== 'pdf' && page.kind !== 'board' && page.paper && page.paper !== 'cover') {
    const g = paperGeometry(page.paper, w, h, null, page.pc);
    const horiz = g.lines.filter(([x1, y1, x2, y2]) => y1 === y2 && x1 <= 0 && x2 >= w - 1);
    const vert = g.lines.filter(([x1, y1, x2, y2]) => x1 === x2 && y1 <= 0 && y2 >= h - 1);
    const ys = [...new Set(horiz.map((l) => Math.round(l[1] * 100) / 100))].sort((a, b) => a - b);
    if (ys.length >= 4) {
      const gap = ys[1] - ys[0];
      const even = ys.every((y, i) => !i || Math.abs(y - ys[i - 1] - gap) < 0.5);
      if (even) {
        const step = gap >= body * 1.15 ? 1 : Math.ceil((body * 1.15) / gap);
        rows = ys.filter((y, i) => i % step === step - 1 && y > 36 && y < h - 30);
        // a margin line on ruled paper (not the grid lines themselves)
        const margins = vert.filter((l) => l[0] > 20 && l[0] < w / 3 && vert.length < 4);
        if (margins.length) left = margins[margins.length - 1][0] + 8;
      }
    }
  }
  if (rows.length < 4) {
    const gap = Math.round(body * 1.6);
    for (let y = 72; y < h - 40; y += gap) rows.push(y);
  }
  return { rows, left, right };
}

/** Bounding boxes of what is on a page: [{ x0, y0, x1, y1 }]. */
function contentBoxes(data) {
  const out = [];
  for (const t of (data && data.texts) || []) out.push({ x0: t.x, y0: t.y, x1: t.x + (t.w || 200), y1: t.y + (t.h || (t.fs || 14) * (t.lh || 1.3) * (t.lines || 1)) });
  for (const it of (data && data.items) || []) out.push({ x0: it.x || 0, y0: it.y || 0, x1: (it.x || 0) + (it.w || 0), y1: (it.y || 0) + (it.h || 0) });
  for (const st of (data && data.strokes) || []) {
    const p = st.p || [];
    if (p.length < 2) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    const r = (st.w || 2) / 2;
    out.push({ x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r });
  }
  return out;
}

/** The lowest point of what is already on a page (text, pictures, ink). */
function contentBottom(data) {
  let b = 0;
  for (const t of (data && data.texts) || []) b = Math.max(b, t.y + (t.h || (t.fs || 14) * (t.lh || 1.3) * (t.lines || 1)));
  for (const it of (data && data.items) || []) b = Math.max(b, (it.y || 0) + (it.h || 0));
  for (const st of (data && data.strokes) || []) for (let i = 1; i < (st.p || []).length; i += 3) b = Math.max(b, st.p[i]);
  return b;
}

// ---------- inline text ----------

const INLINE = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$|\*\*(?!\s)(.+?)(?<!\s)\*\*|(?<![\w*])\*(?![\s*])(.+?)(?<!\s)\*(?!\w)|__(?!\s)(.+?)(?<!\s)__/g;
const attr = (s) => escHtml(s).replace(/"/g, '&quot;');
const mathHtml = (tex, display) => `<span data-x="${MATH}" data-v="${attr(tex)}"${display ? ' data-display="1"' : ''}>${escHtml(tex)}</span>`;

/** Markdown-like inline text → rich text: **bold** (accent colour), *italic*, __underline__, $formula$. */
function inlineHtml(text, accent) {
  let out = '', at = 0;
  const src = String(text || '');
  for (const m of src.matchAll(INLINE)) {
    out += escHtml(src.slice(at, m.index));
    if (m[1] != null || m[2] != null) out += mathHtml((m[1] ?? m[2]).trim(), m[1] != null);
    else if (m[3] != null) out += accent ? `<span data-c="${accent}"><b>${escHtml(m[3])}</b></span>` : `<b>${escHtml(m[3])}</b>`;
    else if (m[4] != null) out += `<i>${escHtml(m[4])}</i>`;
    else out += `<u>${escHtml(m[5])}</u>`;
    at = m.index + m[0].length;
  }
  return out + escHtml(src.slice(at));
}

/** Runs of one laid-out piece back to rich text (the inverse of parseRich for one paragraph). */
function runsHtml(runs, base) {
  let out = '';
  for (const r of runs) {
    let s = r.ix ? mathHtml(r.iv, r.disp) : escHtml(r.t);
    if (r.u && !base.u) s = `<u>${s}</u>`;
    if (r.i && !base.i) s = `<i>${s}</i>`;
    if (r.b && !base.b) s = `<b>${s}</b>`;
    const span = [r.fs && r.fs !== base.fs ? `data-fs="${r.fs}"` : '', r.c && r.c !== base.c ? `data-c="${attr(r.c)}"` : '', r.ff && r.ff !== base.ff ? `data-ff="${attr(r.ff)}"` : ''].filter(Boolean);
    out += span.length ? `<span ${span.join(' ')}>${s}</span>` : s;
  }
  return out;
}

// ---------- blocks ----------

const BLOCKS = ['heading', 'paragraph', 'list', 'formula', 'box', 'pagebreak'];

/** Checks the blocks the model sent: { blocks, problems }. */
function checkBlocks(input) {
  const problems = [];
  const blocks = [];
  if (!Array.isArray(input) || !input.length) return { blocks, problems: ['"blocks" must be a non-empty list'] };
  input.forEach((b, i) => {
    const bad = (why) => problems.push(`block ${i + 1}: ${why}`);
    if (!b || !BLOCKS.includes(b.type)) return bad(`unknown type "${b && b.type}" (use ${BLOCKS.join(', ')})`);
    if (b.type === 'pagebreak') return blocks.push({ type: 'pagebreak' });
    if (b.type === 'list') {
      const items = (Array.isArray(b.items) ? b.items : []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
      if (!items.length) return bad('a list needs "items"');
      return blocks.push({ type: 'list', items, ordered: !!b.ordered });
    }
    if (b.type === 'formula') {
      const tex = String(b.latex || b.text || '').trim().replace(/^\$\$?|\$\$?$/g, '').trim();
      if (!tex) return bad('a formula needs "latex"');
      return blocks.push({ type: 'formula', latex: tex });
    }
    const text = String(b.text == null ? '' : b.text).replace(/\r/g, '').trim();
    if (!text && !(b.type === 'box' && b.title)) return bad('no text');
    if (b.type === 'heading') return blocks.push({ type: 'heading', text, level: [1, 2, 3].includes(Number(b.level)) ? Number(b.level) : 2 });
    if (b.type === 'box') return blocks.push({ type: 'box', title: String(b.title || '').trim(), text });
    return blocks.push({ type: 'paragraph', text });
  });
  return { blocks, problems };
}

const HEAD = { 1: 1.5, 2: 1.25, 3: 1.1 };

/**
 * Lays out blocks from page `start` (index) on.
 * ctx: { pages, data(id) → page data, style (notesStyle), measure(text, run) → width,
 *        newId(), newPage(after page) → page object (not yet in pages), fresh: start on a new page }
 * Returns { pages, changes: [{ pageId, before, after }], placed: [{ index, boxes }], added: [ids] }.
 */
function layoutNotes(blocks, start, ctx) {
  const { style, measure, newId } = ctx;
  const pages = ctx.pages.slice();
  const before = new Map(), after = new Map(), added = [];
  const dataOf = (p) => {
    if (!after.has(p.id)) {
      const d = ctx.data(p.id) || { strokes: [], texts: [], items: [] };
      before.set(p.id, d);
      after.set(p.id, { ...d, strokes: d.strokes || [], texts: (d.texts || []).slice(), items: (d.items || []).slice() });
    }
    return after.get(p.id);
  };
  const fs = style.fs;

  let index = start, page, grid, row, colors, z, blocked;
  // place: 'below' (under everything on the page), 'free' (also the gaps between what is there)
  const enter = (i, place = 'below') => {
    index = i; page = pages[i];
    const d = dataOf(page);
    grid = pageRows(page, fs);
    colors = isDarkPage(page) ? style.dark : style.light;
    const gap = (grid.rows[1] - grid.rows[0]) || fs * 1.6;
    const boxes = contentBoxes(d);
    // a row is taken when anything reaches into its line band (between the margins)
    const hit = grid.rows.map((y) => boxes.some((b) => b.y1 > y - gap + 2 && b.y0 < y + 4 && b.x1 > grid.left - 4 && b.x0 < grid.right));
    if (place === 'free') {
      // one empty row stays between old and new
      blocked = hit.map((x, r) => x || !!hit[r - 1] || !!hit[r + 1]);
    } else {
      const last = hit.lastIndexOf(true);
      blocked = hit.map((x, r) => r <= (last < 0 ? -1 : last + 1));
    }
    row = 0;
    z = d.texts.reduce((m, t) => Math.max(m, t.z || 0), 0) + 1;
  };
  const avail = (r) => { let n = 0; while (r + n < grid.rows.length && !blocked[r + n]) n++; return n; };
  // moves to the first spot with at least `need` free rows (on this page, else on the next)
  const seek = (need) => {
    for (;;) {
      while (row < grid.rows.length && blocked[row]) row++;
      if (row >= grid.rows.length) { nextPage(); continue; }
      const a = avail(row);
      if (a >= need || (a === grid.rows.length - row && row === 0)) return;
      row += a;
    }
  };
  const nextPage = () => {
    // the next page if it is empty enough, else a new page after this one
    const nxt = pages[index + 1];
    if (nxt && nxt.kind !== 'board' && nxt.kind !== 'pdf' && contentBottom(dataOf(nxt)) < nxt.h * 0.6) { enter(index + 1); const r0 = blocked.indexOf(false); if (r0 >= 0 && avail(r0) > 2) return; }
    const np = ctx.newPage(page);
    pages.splice(index + 1, 0, np);
    after.set(np.id, { strokes: [], texts: [], items: [] });
    before.set(np.id, null);
    added.push(np.id);
    enter(index + 1);
  };
  enter(start, ctx.place === 'free' ? 'free' : 'below');
  // never over a PDF page or onto a board: the notes go on a new page after it
  if (ctx.place === 'next' || ctx.fresh || page.kind === 'pdf' || page.kind === 'board') nextPage();

  const placed = [];
  const width = () => grid.right - grid.left;
  const rowGap = () => (grid.rows[1] - grid.rows[0]) || fs * 1.6;
  // one text line spans k rows; the line box is centred so the baseline sits on the lower row
  const rowsPerLine = (size) => Math.max(1, Math.ceil((size * 1.12) / rowGap()));
  const put = (html, { size, color, bold, lines, k, box, ix = 0 }) => {
    const gap = rowGap();
    const L = k * gap;
    const lh = Math.round((L / size) * 1000) / 1000;
    const lastRow = grid.rows[row + k - 1];
    const y = lastRow - 2 - L / 2 - size * 0.32 - (box ? 4 : 0);
    const t = {
      id: newId(), x: Math.round((grid.left + ix) * 100) / 100, y: Math.round(y * 100) / 100, w: Math.round((width() - ix) * 100) / 100,
      fs: size, lh, c: color, ff: style.ff, text: richToPlain(html), html, b: !!bold, i: false, u: false, lines, lay: 'f', z: z++,
      h: Math.round(lines * L * 100) / 100,
    };
    if (box) Object.assign(t, box);
    dataOf(page).texts.push(t);
    const last = placed[placed.length - 1];
    if (last && last.index === index) last.boxes++; else placed.push({ index, boxes: 1 });
    row += lines * k;
  };
  // a paragraph (rich text) cut into pieces that fit the rest of each page
  const flow = (html, { size, color, bold, ix = 0, box = null, keep = 0 }) => {
    const base = { b: !!bold, fs: size, c: color, ff: style.ff };
    const k = rowsPerLine(size);
    const pad = box ? 12 : 0;
    const paras = parseRich(html, { b: !!bold });
    const lines = layoutRich(paras, (width() - ix - pad) * 0.97, (t, r) => (r.ix ? measure(r.iv, { ...r, fs: r.fs || size }) * 0.8 : measure(t, { ...r, fs: r.fs || size, ff: r.ff || style.ff })));
    let i = 0;
    while (i < lines.length) {
      // keep a heading with the first lines after it
      seek(k * (1 + (i ? 0 : keep)));
      const free = Math.floor(avail(row) / k);
      const n = Math.max(1, Math.min(free, lines.length - i));
      const piece = lines.slice(i, i + n);
      const out = [];
      for (const ln of piece) out.push(runsHtml(ln.runs, base).replace(/\s+$/, ''));
      put(out.join(' ').trim() || '&nbsp;', { size, color, bold, lines: n, k, box, ix });
      i += n;
    }
  };
  const blank = () => { if (row > 0 && row < grid.rows.length && !blocked[row - 1]) row++; };

  blocks.forEach((b, bi) => {
    const first = bi === 0;
    if (b.type === 'pagebreak') { nextPage(); return; }
    if (b.type === 'heading') {
      if (!first && row > 0) blank();
      const size = Math.round(fs * HEAD[b.level] * 2) / 2;
      flow(inlineHtml(b.text), { size, color: colors['h' + b.level], bold: true, keep: 2 });
      return;
    }
    if (!first && blocks[bi - 1].type !== 'heading') blank();
    if (b.type === 'paragraph') {
      for (const [pi, para] of b.text.split(/\n\s*\n/).entries()) {
        if (pi) blank();
        flow(inlineHtml(para.replace(/\s*\n\s*/g, ' '), colors.accent), { size: fs, color: colors.text });
      }
    } else if (b.type === 'list') {
      b.items.forEach((it, n) => {
        const mark = b.ordered ? `${n + 1}.` : '•';
        flow(`${mark} ${inlineHtml(it, colors.accent)}`, { size: fs, color: colors.text, ix: 8 });
      });
    } else if (b.type === 'formula') {
      // a formula on its own line: a third bigger than the text (KaTeX strokes are thin)
      const size = Math.round(fs * 1.35 * 2) / 2;
      const k = Math.max(2, rowsPerLine(size) * 2);
      seek(k);
      put(mathHtml(b.latex, true), { size, color: colors.text, lines: 1, k });
    } else if (b.type === 'box') {
      const look = { bg: colors.boxBg, bc: colors.boxBorder, br: 6 };
      const html = (b.title ? `<span data-c="${colors.accent}"><b>${escHtml(b.title)}</b></span>${b.text ? ': ' : ''}` : '') + inlineHtml(b.text, colors.accent);
      flow(html, { size: fs, color: colors.text, box: look });
    }
  });

  const changes = [...after.keys()].filter((id) => !added.includes(id) || after.get(id).texts.length)
    .map((id) => ({ pageId: id, before: before.get(id), after: after.get(id) }));
  return { pages, changes, placed, added };
}

/** What is on a page, in words, for read_notebook: so the model knows about ink and pictures it cannot read. */
function pageSummary(page, data) {
  const d = data || {};
  const parts = [];
  if (page.kind === 'pdf') parts.push('PDF page');
  else if (page.kind === 'board') parts.push('board');
  else parts.push(`${page.paper || 'blank'} paper${page.pc === 'dark' ? ', dark' : ''}`);
  const strokes = (d.strokes || []).length, pics = (d.items || []).filter((it) => it.type === 'img').length;
  const shapes = (d.items || []).filter((it) => it.type !== 'img' && it.type !== 'table').length;
  if (strokes) parts.push(`${strokes} handwritten stroke${strokes === 1 ? '' : 's'}`);
  if (pics) parts.push(`${pics} picture${pics === 1 ? '' : 's'}`);
  if (shapes) parts.push(`${shapes} shape${shapes === 1 ? '' : 's'}`);
  const full = page.h ? Math.min(100, Math.round((contentBottom(d) / page.h) * 100)) : 0;
  if (full) parts.push(`used down to ${full}%`);
  return parts.join(', ');
}

module.exports = { DEFAULT_STYLE, notesStyle, isDarkPage, pageRows, contentBottom, contentBoxes, inlineHtml, checkBlocks, layoutNotes, pageSummary, BLOCKS };
