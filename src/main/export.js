'use strict';
// Export a notebook to a PDF: original PDF pages are copied unchanged and the
// notes are drawn on top as vectors (ink, shapes, text, tables) plus the
// embedded images – sharp at any zoom, small files.

const { PDFDocument, rgb, BlendMode, degrees, pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clipEvenOdd, endPath, concatTransformationMatrix, setGraphicsState, drawObject: doXObject } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
// Ligatures would be drawn as one glyph that PDF readers can't copy/search ("ti" in "Wichtig" vanished).
const NO_LIGATURES = { liga: false, clig: false, calt: false, rlig: false, dlig: false };
const { getOutline, getSizedOutline, outlineToSvgPath, strokeLook, lighten, isClosedShape } = require('../shared/ink');
const { paperGeometry, pageBackground } = require('../shared/paper');
const { boxWarp, applyH, colourAt, validStops } = require('../shared/warp');
const { boxStyle, roundedRect, softOf, BOX_PAD_X, BOX_PAD_Y, BOX_BORDER } = require('../shared/textbox');
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
async function drawRich(page, fonts, { html, text, ff, b, i, u, fs, color, x, y, w, al, dry = false, turn = 0, soft = 0, look = {} }, map, rot, k = 1) {
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
  // "Match the document": soft letters like the scan. A PDF has no blur, so
  // the letters' outlines are collected into one form that is placed several
  // times, a little shifted and faint (≈ a Gaussian blur); the real text is
  // drawn invisible on top, for search and copying.
  const acc = soft > 0 ? { ops: '', xobj: {} } : null;
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
        if (acc) {
          const fk = part.ok ? f.fk : fb.fk;
          for (const sb of f.synthBold ? [0, rfs * 0.035] : [0]) softWord(acc, page.doc.context, fk, part.t, rfs, cx + sb, by, map, f.synthItalic, rcol, run.c ? { warp: look.warp } : look);
          page.drawText(part.t, { ...opts, opacity: 0 });
          cx += pw;
          continue;
        }
        page.drawText(part.t, opts);
        if (f.synthBold) {
          const [u1, v1] = map(cx + rfs * 0.035, by);
          page.drawText(part.t, { ...opts, x: u1, y: v1 });
        }
        cx += pw;
      }
      if (run.u) {
        const uy = by + rfs * 0.12;
        if (acc) {
          const t2 = Math.max(0.5 / k, rfs * 0.06) / 2, x0 = x + dx + run.x, x1 = x0 + run.w;
          const c = hexToRgb(rcol);
          acc.ops += `${c.red.toFixed(3)} ${c.green.toFixed(3)} ${c.blue.toFixed(3)} rg\n` + [[x0, uy - t2], [x1, uy - t2], [x1, uy + t2], [x0, uy + t2]]
            .map(([px, py], n) => { const [u, v] = map(...(look.warp ? look.warp(px, py) : [px, py])); return `${u.toFixed(2)} ${v.toFixed(2)} ${n ? 'l' : 'm'}\n`; }).join('') + 'h f\n';
        } else drawPolyline(page, [[x + dx + run.x, uy], [x + dx + run.x + run.w, uy]], map, rcol, Math.max(0.5, rfs * 0.06) * k);
      }
    }
    ly += lineH;
  }
  if (acc && acc.ops) {
    const ctx = page.doc.context;
    const form = page.node.newXObject('SnSoftText', ctx.register(ctx.flateStream(acc.ops, { Type: 'XObject', Subtype: 'Form', BBox: [-1e5, -1e5, 1e5, 1e5], Resources: { XObject: acc.xobj } })));
    const states = softStates(page);
    const [bu, bv] = map(0, 0);
    SOFT_RINGS.forEach(([r, n], ri) => {
      for (let q = 0; q < n; q++) {
        const ang = (q / n) * Math.PI * 2 + (r ? 0.4 : 0);
        const [u1, v1] = map(Math.cos(ang) * r * soft, Math.sin(ang) * r * soft);
        page.pushOperators(pushGraphicsState(), setGraphicsState(states[ri]), concatTransformationMatrix(1, 0, 0, 1, u1 - bu, v1 - bv), doXObject(form), popGraphicsState());
      }
    });
  }
  return ly - y;
}

// [radius in blur units, copies, opacity] – together about a Gaussian blur
const SOFT_RINGS = [[0, 1, 0.5], [0.7, 8, 0.18], [1.5, 8, 0.07]];

// The faint copies' opacities as graphics states, made once per page.
const softStateCache = new WeakMap();
function softStates(page) {
  let names = softStateCache.get(page);
  if (!names) {
    names = SOFT_RINGS.map(([, , a], k) => {
      const ref = page.doc.context.register(page.doc.context.obj({ Type: 'ExtGState', ca: a, CA: a }));
      return page.node.newExtGState(`SnSoft${k}`, ref);
    });
    softStateCache.set(page, names);
  }
  return names;
}

// Each letter's outline is stored once per document (font units) and the
// words place them: a soft page stays small.
const glyphForms = new WeakMap(); // PDF context → Map(fontkit font → Map(glyph id → ref))
function glyphForm(ctx, fk, g) {
  let byFont = glyphForms.get(ctx);
  if (!byFont) { byFont = new Map(); glyphForms.set(ctx, byFont); }
  let byId = byFont.get(fk);
  if (!byId) { byId = new Map(); byFont.set(fk, byId); }
  if (byId.has(g.id)) return byId.get(g.id);
  let ops = '', lx = 0, ly = 0;
  const n = (v) => Math.round(v);
  for (const c of g.path.commands) {
    const a = c.args;
    if (c.command === 'moveTo') { ops += `${n(a[0])} ${n(a[1])} m\n`; lx = a[0]; ly = a[1]; }
    else if (c.command === 'lineTo') { ops += `${n(a[0])} ${n(a[1])} l\n`; lx = a[0]; ly = a[1]; }
    else if (c.command === 'quadraticCurveTo') {
      // quadratic → cubic
      ops += `${n(lx + (2 / 3) * (a[0] - lx))} ${n(ly + (2 / 3) * (a[1] - ly))} ${n(a[2] + (2 / 3) * (a[0] - a[2]))} ${n(a[3] + (2 / 3) * (a[1] - a[3]))} ${n(a[2])} ${n(a[3])} c\n`;
      lx = a[2]; ly = a[3];
    } else if (c.command === 'bezierCurveTo') { ops += `${a.slice(0, 6).map(n).join(' ')} c\n`; lx = a[4]; ly = a[5]; }
    else if (c.command === 'closePath') ops += 'h\n';
  }
  const ref = ops ? ctx.register(ctx.flateStream(ops + 'f\n', { Type: 'XObject', Subtype: 'Form', BBox: [-1e4, -1e4, 1e4, 1e4], Resources: {} })) : null;
  byId.set(g.id, ref);
  return ref;
}

const fontNos = new WeakMap();
let fontCount = 0;
const fontNo = (fk) => { if (!fontNos.has(fk)) fontNos.set(fk, ++fontCount); return fontNos.get(fk); };

/** Adds the letters of `text` (filled in `color`, PDF space) to acc { ops, xobj }. */
function softWord(acc, ctx, fk, text, size, x, baseY, map, italic, color, look = {}) {
  let run;
  try { run = fk.layout(text, NO_LIGATURES); } catch { return; }
  const s = size / fk.unitsPerEm, sk = italic ? Math.tan((12 * Math.PI) / 180) : 0;
  // page → PDF is affine: its two axes
  const [ou, ov] = map(0, 0), [xu, xv] = map(1, 0), [yu, yv] = map(0, 1);
  const ax = [xu - ou, xv - ov], ay = [yu - ou, yv - ov];
  const { warp, colourOf } = look;
  let lastCol = '';
  const setCol = (c) => {
    if (c === lastCol) return;
    const col = hexToRgb(c);
    acc.ops += `${col.red.toFixed(3)} ${col.green.toFixed(3)} ${col.blue.toFixed(3)} rg\n`;
    lastCol = c;
  };
  setCol(color);
  let pen = 0;
  run.glyphs.forEach((g, k) => {
    const pos = run.positions[k];
    const ref = glyphForm(ctx, fk, g);
    if (ref) {
      const gx = x + (pen + pos.xOffset) * s, gy = baseY - pos.yOffset * s;
      // letter (font units, y up) → page: gx + (lx)·s + ly·s·sk, gy − ly·s;
      // in a perspective the page axes are the warp's local ones (per letter)
      let o = [gx, gy], ex = [1, 0], ey = [0, 1];
      if (warp) {
        const d = Math.max(0.25, size * 0.05);
        o = warp(gx, gy);
        const px = warp(gx + d, gy), py = warp(gx, gy + d);
        ex = [(px[0] - o[0]) / d, (px[1] - o[1]) / d]; ey = [(py[0] - o[0]) / d, (py[1] - o[1]) / d];
      }
      const lin = (v) => [ax[0] * v[0] + ay[0] * v[1], ax[1] * v[0] + ay[1] * v[1]]; // page vector → PDF
      const cx = lin([s * ex[0], s * ex[1]]), cy = lin([s * sk * ex[0] - s * ey[0], s * sk * ex[1] - s * ey[1]]);
      const [e, f] = map(o[0], o[1]);
      if (colourOf) setCol(colourOf(gx + (pos.xAdvance * s) / 2) || color);
      const name = `g${fontNo(fk)}_${g.id}`;
      acc.xobj[name] = ref;
      acc.ops += `q ${[cx[0], cx[1], cy[0], cy[1]].map((v) => v.toFixed(4)).join(' ')} ${e.toFixed(2)} ${f.toFixed(2)} cm /${name} Do Q\n`;
    }
    pen += pos.xAdvance;
  });
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
  if (!outline.multi && outline.length < 2) return;
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
    x: o.x, y: o.y, w, al: o.al, soft: softOf(o),
  };
  // "Match the document": the photo's perspective and light (see shared/warp.js)
  if (rich.soft > 0) {
    const H = boxWarp(o);
    if (H) rich.look = { ...rich.look, warp: (px, py) => { const [X, Y] = applyH(H, px - o.x, py - o.y); return [o.x + X, o.y + Y]; } };
    if (validStops(o.cg)) rich.look = { ...rich.look, colourOf: (px) => colourAt(o.cg, px - o.x) };
  }
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
// Handwriting as invisible text over the ink: the PDF can be searched and the
// handwriting selected and copied as text.
const inkOf = (data) => data.strokes.filter((st) => st.t === 'pen' && !st.sh && st.p.length >= 6).map((st) => st.p.filter((_, i) => i % 3 !== 2));

// All pages in one go (the recognizer is slow to start): pageId → words.
async function recognizeInk(list, pages, inkTextAll) {
  const ids = [], groups = [];
  for (const pg of list) {
    const ink = inkOf(pages[pg.id] || { strokes: [] });
    if (ink.length) { ids.push(pg.id); groups.push(ink); }
  }
  const out = new Map();
  if (!groups.length) return out;
  try {
    const res = await inkTextAll(groups);
    ids.forEach((id, k) => out.set(id, (res[k] && res[k].words) || []));
  } catch { /* no recognizer: the export still works, without the text */ }
  return out;
}

async function drawInkText(page, words, map, ctx) {
  if (!words || !words.length) return;
  const { pdfFont } = await ctx.fonts.get('sans', false, false);
  for (const w of words) {
    if (!w.text || w.w <= 0 || w.h <= 0) continue;
    let width = 0;
    try { width = pdfFont.widthOfTextAtSize(w.text, 1); } catch { continue; } // letters the font lacks
    if (!(width > 0)) continue;
    const size = Math.max(2, Math.min(w.w / width, w.h * 1.4));
    const [x, y] = map(w.x, w.y + w.h * 0.8);
    page.drawText(w.text, { x, y, size, font: pdfFont, opacity: 0 });
  }
}

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
  const inkWords = args.inkTextAll ? await recognizeInk(list, pages, args.inkTextAll) : new Map();
  const inkText = async (page, pg, map) => { if (inkWords.has(pg.id)) await drawInkText(page, inkWords.get(pg.id), map, ctx); };

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
      const map = makeMapper(page.getCropBox(), rotation);
      await drawContent(page, data, map, rotation, ctx);
      if (rotation === 0) await inkText(page, pg, map);
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
      await inkText(page, pg, map);
    }
  }
  if (args.beforeSave) await args.beforeSave(out);
  return out.save({ useObjectStreams: true });
}

module.exports = { exportNotebook, makeMapper, wrapText, normRotation, contentBBox };
