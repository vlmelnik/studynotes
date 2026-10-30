'use strict';
// Export a notebook to a PDF: original PDF pages are copied unchanged and the
// notes are drawn on top as vectors (ink, shapes, text, tables) plus the
// embedded images – sharp at any zoom, small files.

const { PDFDocument, rgb, BlendMode, degrees, pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clipEvenOdd, endPath } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
// Ligatures would be drawn as one glyph that PDF readers can't copy/search ("ti" in "Wichtig" vanished).
const NO_LIGATURES = { liga: false, clig: false, calt: false, rlig: false, dlig: false };
const { getOutline, getSizedOutline, outlineToSvgPath, strokeLook, lighten, isClosedShape } = require('../shared/ink');
const { paperGeometry, pageBackground } = require('../shared/paper');
const { boxStyle, roundedRect, BOX_PAD_X, BOX_PAD_Y, BOX_BORDER } = require('../shared/textbox');
const { stacked } = require('../shared/stacking');
const { parseRich, plainToHtml, layoutRich } = require('../shared/richtext');
const { fontFile } = require('../shared/fonts');
const { strokeBBox, capsulePolygon } = require('../shared/geometry');

const LINE_H = 1.3;
const CELL_PAD = 4;
const MAX_PDF_SIDE = 14400; // PDF page size limit (200 inches)

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function normRotation(r) {
  return (((Math.round((r || 0) / 90) * 90) % 360) + 360) % 360;
}

// Map a point from screen/page space (origin top-left, y down, rotation
// applied, size = displayed page) to PDF user space (y up) for a page with
// the given crop box and /Rotate. Matches pdf.js viewport.convertToPdfPoint.
function makeMapper(box, rotation) {
  const { x: cx, y: cy, width: cw, height: ch } = box;
  switch (normRotation(rotation)) {
    case 90: return (x, y) => [cx + y, cy + x];
    case 180: return (x, y) => [cx + cw - x, cy + y];
    case 270: return (x, y) => [cx + cw - y, cy + ch - x];
    default: return (x, y) => [cx + x, cy + ch - y];
  }
}

// Plain-text wrapper (kept for compatibility and tests).
function wrapText(text, font, size, maxWidth) {
  const lines = layoutRich(parseRich(plainToHtml(text)), maxWidth, (t) => font.widthOfTextAtSize(t, size));
  return lines.map((l) => l.runs.map((r) => r.t).join('').trimEnd());
}

// ---------- fonts ----------
class FontBox {
  constructor(doc, readFont) {
    this.doc = doc;
    this.readFont = readFont; // (fileName) => Uint8Array
    this.cache = new Map();
  }

  async get(ff, b, i) {
    const { file, synthBold, synthItalic, subset } = fontFile(ff, b, i);
    let entry = this.cache.get(file);
    if (!entry) {
      const bytes = await this.readFont(file);
      const pdfFont = await this.doc.embedFont(bytes, { subset, features: NO_LIGATURES });
      const fk = fontkit.create(bytes);
      entry = { pdfFont, fk, metrics: { asc: fk.ascent / fk.unitsPerEm, desc: fk.descent / fk.unitsPerEm } };
      this.cache.set(file, entry);
    }
    return { ...entry, synthBold, synthItalic };
  }

  async fallback() {
    if (!this._fallback) {
      const bytes = await this.readFont('DejaVuSans.ttf');
      this._fallback = { pdfFont: await this.doc.embedFont(bytes, { subset: true, features: NO_LIGATURES }), fk: fontkit.create(bytes) };
    }
    return this._fallback;
  }
}

// Split text into pieces the primary font can draw and pieces that need the fallback.
function splitByGlyphs(text, fk) {
  const parts = [];
  for (const ch of text) {
    const ok = fk.hasGlyphForCodePoint(ch.codePointAt(0)) || /\s/.test(ch);
    const last = parts[parts.length - 1];
    if (last && last.ok === ok) last.t += ch; else parts.push({ t: ch, ok });
  }
  return parts;
}

/**
 * Draw rich text (html or plain) into a box.
 * map: page→pdf point mapper; k: scale factor (boards); rot: page rotation.
 */
// Rich text: per-run bold/italic/underline plus optional size, font and colour
// (<span data-fs data-ff data-c>). Lines are as tall as their largest run, like
// in the browser. `al` = left | center | right.
async function drawRich(page, fonts, { html, text, ff, b, i, u, fs, color, x, y, w, al, dry = false, turn = 0 }, map, rot, k = 1) {
  const paras = parseRich(html || plainToHtml(text || ''), { b, i, u });
  // layoutRich needs a synchronous measure: pre-load every font variant used.
  const variants = new Map();
  const vkey = (st) => `${st.ff || ff}|${!!st.b}|${!!st.i}`;
  for (const para of paras) for (const run of para) {
    const key = vkey(run);
    if (!variants.has(key)) variants.set(key, await fonts.get(run.ff || ff, !!run.b, !!run.i));
  }
  if (!variants.has(vkey({}))) variants.set(vkey({}), await fonts.get(ff, false, false));
  const measureCache = new Map();
  const sizeOf = (st) => st.fs || fs;
  const mSync = (t, st) => {
    const key = `${vkey(st)}|${sizeOf(st)}|${t}`;
    let v = measureCache.get(key);
    if (v === undefined) { v = variants.get(vkey(st)).pdfFont.widthOfTextAtSize(t, sizeOf(st)); measureCache.set(key, v); }
    return v;
  };
  const maxW = Math.max(4, w - 1);
  const lines = layoutRich(paras, maxW, mSync);
  if (dry) return lines.reduce((sum, line) => sum + Math.max(fs, ...line.runs.map(sizeOf), 1) * LINE_H, 0);
  const fb = await fonts.fallback();
  let ly = y;
  for (const line of lines) {
    // Like CSS line boxes: never smaller than the box's own font size (the strut).
    const lfs = Math.max(fs, ...line.runs.map(sizeOf), 1);
    const lineH = lfs * LINE_H;
    const lm = variants.get(vkey({})).metrics;
    const by = ly + (lineH - (lm.asc - lm.desc) * lfs) / 2 + lm.asc * lfs;
    const dx = al === 'center' ? (maxW - line.width) / 2 : al === 'right' ? maxW - line.width : 0;
    for (const run of line.runs) {
      if (!run.t.trim()) continue;
      const f = variants.get(vkey(run));
      const rfs = sizeOf(run);
      const rcol = run.c || color;
      let cx = x + dx + run.x;
      for (const part of splitByGlyphs(run.t, f.fk)) {
        const font = part.ok ? f.pdfFont : fb.pdfFont;
        const pw = font.widthOfTextAtSize(part.t, rfs);
        const [u0, v0] = map(cx, by);
        const opts = { x: u0, y: v0, size: rfs * k, font, color: hexToRgb(rcol), rotate: degrees(normRotation(rot) - (turn || 0)) };
        if (f.synthItalic) opts.ySkew = degrees(12); // shear x by y: slanted letters
        page.drawText(part.t, opts);
        if (f.synthBold) {
          const [u1, v1] = map(cx + rfs * 0.035, by);
          page.drawText(part.t, { ...opts, x: u1, y: v1 });
        }
        cx += pw;
      }
      if (run.u) {
        const uy = by + rfs * 0.12;
        drawPolyline(page, [[x + dx + run.x, uy], [x + dx + run.x + run.w, uy]], map, rcol, Math.max(0.5, rfs * 0.06) * k);
      }
    }
    ly += lineH;
  }
  return ly - y;
}

function svgPath(points, map, close) {
  return points.map(([px, py], idx) => {
    const [u, v] = map(px, py);
    return `${idx ? 'L' : 'M'}${u.toFixed(2)} ${(-v).toFixed(2)}`;
  }).join(' ') + (close ? ' Z' : '');
}

function drawPolyline(page, points, map, color, width) {
  page.drawSvgPath(svgPath(points, map, false), { x: 0, y: 0, borderColor: hexToRgb(color), borderWidth: width });
}

function fillRect(page, x0, y0, x1, y1, map, color) {
  page.drawSvgPath(svgPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], map, true), { x: 0, y: 0, color: hexToRgb(color), borderWidth: 0 });
}

// ---------- strokes ----------
function fillOutline(page, outline, map, color, opacity, blend) {
  if (outline.length < 2) return;
  const pathData = outlineToSvgPath(outline, (x, y) => {
    const [u, v] = map(x, y);
    return [u, -v]; // drawSvgPath flips y
  });
  const opts = { x: 0, y: 0, color: hexToRgb(color), borderWidth: 0 };
  if (opacity < 1) opts.opacity = opacity;
  if (blend) opts.blendMode = blend;
  page.drawSvgPath(pathData, opts);
}

// Exact eraser cuts: clip the ink to outside each eraser capsule.
function withCuts(page, st, map, draw) {
  if (!Array.isArray(st.k) || !st.k.length) return draw();
  const ops = [pushGraphicsState()];
  for (const c of st.k) {
    const big = [[-1e5, -1e5], [1e5, -1e5], [1e5, 1e5], [-1e5, 1e5]];
    for (const poly of [big, capsulePolygon(c).map(([x, y]) => map(x, y))]) {
      poly.forEach(([x, y], i) => ops.push(i ? lineTo(x, y) : moveTo(x, y)));
      ops.push(closePath());
    }
    ops.push(clipEvenOdd(), endPath());
  }
  page.pushOperators(...ops);
  draw();
  page.pushOperators(popGraphicsState());
}

function drawStroke(page, st, map) {
  return withCuts(page, st, map, () => drawStrokeInk(page, st, map));
}

function drawStrokeInk(page, st, map) {
  if (st.f && isClosedShape(st)) {
    const pts = [];
    for (let i = 0; i < st.p.length; i += 3) pts.push([st.p[i], st.p[i + 1]]);
    const opts = { x: 0, y: 0, color: hexToRgb(st.f), borderWidth: 0 };
    if ((st.fa ?? 1) < 1) opts.opacity = st.fa;
    page.drawSvgPath(svgPath(pts, map, true), opts);
  }
  const look = strokeLook(st);
  if (st.t === 'hl') return fillOutline(page, getOutline(st), map, st.c, look.alpha, BlendMode.Multiply);
  if (look.glow) {
    fillOutline(page, getSizedOutline(st, 3.2), map, st.c, 0.12);
    fillOutline(page, getSizedOutline(st, 2.1), map, st.c, 0.25);
    fillOutline(page, getOutline(st), map, st.c, 1);
    fillOutline(page, getSizedOutline(st, 0.45), map, lighten(st.c, 0.65), 1);
    return;
  }
  fillOutline(page, getOutline(st), map, st.c, look.alpha);
}

// ---------- items ----------
async function drawImage(page, it, map, rot, k, images) {
  const img = await images(it.src);
  if (!img) return;
  // Bottom-left corner of the image as displayed → PDF point; rotate with the
  // page and with the picture's own rotation (it.r, clockwise on screen, about
  // its centre).
  let bx = it.x, by = it.y + it.h;
  const r = it.r || 0;
  if (r) {
    const a = (r * Math.PI) / 180, cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const dx = -it.w / 2, dy = it.h / 2;
    bx = cx + dx * Math.cos(a) - dy * Math.sin(a);
    by = cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  const [u, v] = map(bx, by);
  const opts = { x: u, y: v, width: it.w * k, height: it.h * k, rotate: degrees(normRotation(rot) - r) };
  if (it.o != null && it.o < 1) opts.opacity = it.o;
  page.drawImage(img, opts);
}

async function drawTable(page, it, map, rot, k, fonts) {
  const cw = it.cw || [];
  const rows = it.cells || [];
  const fs = it.fs || 12;
  const border = it.border || '#9aa7b8';
  // Row heights: measured on screen; recompute if missing.
  let y = it.y;
  for (let r = 0; r < rows.length; r++) {
    let x = it.x;
    const rh = (it.rh && it.rh[r]) || fs * LINE_H + CELL_PAD * 2;
    for (let c = 0; c < cw.length; c++) {
      const cell = (rows[r] && rows[r][c]) || {};
      const bg = cell.bg || (it.hdr && r === 0 ? '#eef2f7' : null);
      if (bg) fillRect(page, x, y, x + cw[c], y + rh, map, bg);
      if (cell.h || cell.t) {
        await drawRich(page, fonts, {
          html: cell.h, text: cell.t, ff: it.ff, b: cell.b || (it.hdr && r === 0), i: cell.i, u: cell.u,
          fs, color: cell.c || it.c || '#1c1c1e', x: x + CELL_PAD, y: y + CELL_PAD, w: cw[c] - CELL_PAD * 2,
        }, map, rot, k);
      }
      x += cw[c];
    }
    y += rh;
  }
  // Grid lines
  const total = cw.reduce((a, b) => a + b, 0);
  let gy = it.y;
  const lw = 0.7 * k;
  drawPolyline(page, [[it.x, gy], [it.x + total, gy]], map, border, lw);
  for (let r = 0; r < rows.length; r++) {
    gy += (it.rh && it.rh[r]) || fs * LINE_H + CELL_PAD * 2;
    drawPolyline(page, [[it.x, gy], [it.x + total, gy]], map, border, lw);
  }
  let gx = it.x;
  drawPolyline(page, [[gx, it.y], [gx, gy]], map, border, lw);
  for (const w of cw) { gx += w; drawPolyline(page, [[gx, it.y], [gx, gy]], map, border, lw); }
}

async function drawObject(page, kind, o, map, rot, ctx, k) {
  if (kind === 'item') {
    if (o.type === 'img') await drawImage(page, o, map, rot, k, ctx.images);
    else if (o.type === 'table') await drawTable(page, o, map, rot, k, ctx.fonts);
    // unknown item types (from newer versions) are skipped
    return;
  }
  if (!(o.html || (o.text && o.text.trim()))) return;
  const box = boxStyle(o);
  // Boxes that grow with their text were measured on screen; the PDF font may
  // be a hair wider, so allow a little slack instead of wrapping a last word.
  const w = (o.w || 200) * (o.aw ? 1.04 : 1) + (o.aw ? 2 : 0);
  const rich = {
    html: o.html, text: o.text, ff: o.ff, b: o.b, i: o.i, u: o.u, fs: o.fs || 14, color: o.c,
    x: o.x, y: o.y, w, al: o.al,
  };
  if (box) {
    // Same box model as the screen: padding inside the width, then the text.
    rich.x = o.x + BOX_PAD_X; rich.y = o.y + BOX_PAD_Y; rich.w = w - 2 * BOX_PAD_X;
  }
  // A turned text box: turn every point around the box centre (like CSS rotate).
  if (o.r) {
    const th = await drawRich(page, ctx.fonts, { ...rich, dry: true }, map, rot, k);
    const bh = Math.max(o.h || 0, th + (box ? 2 * BOX_PAD_Y : 0));
    const cx = o.x + (o.w || 200) / 2, cy = o.y + bh / 2;
    const a = (o.r * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const base = map;
    map = (px, py) => base(cx + (px - cx) * ca - (py - cy) * sa, cy + (px - cx) * sa + (py - cy) * ca);
    rich.turn = o.r;
  }
  if (box) {
    const th = await drawRich(page, ctx.fonts, { ...rich, dry: true }, map, rot, k);
    const h = Math.max(o.h || 0, th + 2 * BOX_PAD_Y);
    const pts = roundedRect(o.x, o.y, w, h, box.br);
    const path = svgPath(pts, map, true);
    if (box.bg) page.drawSvgPath(path, { x: 0, y: 0, color: hexToRgb(box.bg), borderWidth: 0 });
    if (box.bc) page.drawSvgPath(path, { x: 0, y: 0, borderColor: hexToRgb(box.bc), borderWidth: BOX_BORDER * k });
  }
  await drawRich(page, ctx.fonts, rich, map, rot, k);
}

// Same order as on screen: back objects, ink, front objects (shared/stacking.js).
async function drawContent(page, data, map, rot, ctx, k = 1) {
  for (const { kind, obj } of stacked(data, 'b')) await drawObject(page, kind, obj, map, rot, ctx, k);
  const strokes = data.strokes || [];
  for (const st of strokes) if (st.t === 'hl') drawStroke(page, st, map);
  for (const st of strokes) if (st.t !== 'hl') drawStroke(page, st, map);
  for (const { kind, obj } of stacked(data, 'f')) await drawObject(page, kind, obj, map, rot, ctx, k);
}

function drawPaper(page, pg, map, k) {
  const { paper: kind, w, h, pc, cover } = pg;
  // Cream paper is white in the PDF; dark paper and covers keep their colour.
  const bg = pageBackground({ kind: 'paper', ...pg }, true);
  if (bg.toLowerCase() !== '#ffffff') fillRect(page, 0, 0, w, h, map, bg);
  const { lines, dots, rects } = paperGeometry(kind, w, h, undefined, pc, cover);
  for (const [x, y, rw, rh, color] of rects) fillRect(page, x, y, x + rw, y + rh, map, color);
  for (const [x1, y1, x2, y2, color, width] of lines) {
    const [a, b] = map(x1, y1);
    const [c, d] = map(x2, y2);
    page.drawLine({ start: { x: a, y: b }, end: { x: c, y: d }, thickness: width * k, color: hexToRgb(color) });
  }
  for (const [x, y, r, color] of dots) {
    const [a, b] = map(x, y);
    page.drawCircle({ x: a, y: b, size: r * k, color: hexToRgb(color) });
  }
}

// Bounding box of everything on a page (for endless boards).
function contentBBox(data) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x0, y0, x1, y1) => { b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)]; };
  for (const st of data.strokes || []) add(...strokeBBox(st));
  for (const t of data.texts || []) add(t.x, t.y, t.x + (t.w || 200), t.y + (t.lines || 1) * (t.fs || 14) * LINE_H);
  for (const it of data.items || []) {
    if (it.type === 'img') add(it.x, it.y, it.x + it.w, it.y + it.h);
    else if (it.type === 'table') add(it.x, it.y, it.x + (it.cw || []).reduce((a, c) => a + c, 0), it.y + (it.rh || []).reduce((a, c) => a + c, 0));
  }
  return Number.isFinite(b[0]) ? b : null;
}

/**
 * @param {object} args
 * @param {object} args.notebook   notebook.json content
 * @param {(src:string)=>Promise<Uint8Array|null>} args.readSource  bytes of a PDF source ('main' = source.pdf)
 * @param {(name:string)=>Promise<Uint8Array>} args.readAsset       bytes of an image asset
 * @param {(file:string)=>Promise<Uint8Array>} args.readFont        bytes of a bundled font
 * @param {object} args.pages      map pageId -> { strokes, texts, items }
 * @param {string[]} [args.pageIds] subset/order of pages to export (default all)
 * Older call style ({ pdfBytes, fontBytes }) is still accepted.
 */
async function exportNotebook(args) {
  const { notebook, pages, pageIds } = args;
  const readSource = args.readSource || (async () => args.pdfBytes);
  const readAsset = args.readAsset || (async () => null);
  const readFont = args.readFont || (async () => args.fontBytes);
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  out.setTitle(notebook.title || 'Notebook');
  out.setCreator('StudyNotes');
  const fonts = new FontBox(out, async (file) => {
    try { return await readFont(file); } catch { return readFont('DejaVuSans.ttf'); }
  });
  const imageCache = new Map();
  const images = async (src) => {
    if (!imageCache.has(src)) {
      imageCache.set(src, (async () => {
        try {
          const bytes = await readAsset(src);
          if (!bytes) return null;
          return /\.png$/i.test(src) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        } catch { return null; }
      })());
    }
    return imageCache.get(src);
  };
  const ctx = { fonts, images };

  const wanted = pageIds ? new Set(pageIds) : null;
  const list = notebook.pages.filter((p) => !wanted || wanted.has(p.id));

  // Copy the PDF pages we need, per source; duplicates need their own copy.
  const copied = new Map(); // `${src}:${index}` -> [PDFPage]
  const bySource = new Map();
  for (const p of list) {
    if (p.kind !== 'pdf') continue;
    const src = p.src || 'main';
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(p.pdfPage - 1);
  }
  for (const [src, idxs] of bySource) {
    const bytes = await readSource(src);
    if (!bytes) throw new Error(`PDF "${src}" is missing`);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const got = await out.copyPages(doc, idxs);
    idxs.forEach((i, k) => {
      const key = `${src}:${i}`;
      if (!copied.has(key)) copied.set(key, []);
      copied.get(key).push(got[k]);
    });
  }

  for (const pg of list) {
    const data = pages[pg.id] || { strokes: [], texts: [], items: [] };
    if (pg.kind === 'pdf') {
      const page = copied.get(`${pg.src || 'main'}:${pg.pdfPage - 1}`).shift();
      out.addPage(page);
      if (pg.rot) page.setRotation(degrees(normRotation(page.getRotation().angle + pg.rot)));
      const rotation = page.getRotation().angle;
      await drawContent(page, data, makeMapper(page.getCropBox(), rotation), rotation, ctx);
    } else if (pg.kind === 'board') {
      const bb = contentBBox(data) || [0, 0, 595, 842];
      const m = 36;
      const W = bb[2] - bb[0] + 2 * m, H = bb[3] - bb[1] + 2 * m;
      const k = Math.min(1, MAX_PDF_SIDE / W, MAX_PDF_SIDE / H);
      const page = out.addPage([W * k, H * k]);
      const map = (x, y) => [(x - bb[0] + m) * k, (H - (y - bb[1] + m)) * k];
      // Ink outlines are mapped point by point, so scaling is exact for them.
      await drawContent(page, data, map, 0, ctx, k);
    } else {
      const page = out.addPage([pg.w, pg.h]);
      const map = (x, y) => [x, pg.h - y];
      drawPaper(page, pg, map, 1);
      await drawContent(page, data, map, 0, ctx);
    }
  }
  if (args.beforeSave) await args.beforeSave(out);
  return out.save({ useObjectStreams: true });
}

module.exports = { exportNotebook, makeMapper, wrapText, normRotation, contentBBox };
