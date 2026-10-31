// Canvas drawing of strokes and paper.
import { getOutline, getLiveOutline, getSizedOutline, traceOutline, strokeLook, lighten, isClosedShape } from '../shared/ink.js';
import { paperGeometry, pageBackground } from '../shared/paper.js';
import { strokeBBox, capsulePolygon } from '../shared/geometry.js';

const pathCache = new WeakMap();
const sizedPathCache = new WeakMap();

export function strokePath(st) {
  let p = pathCache.get(st);
  if (!p) {
    p = new Path2D();
    traceOutline(getOutline(st), p);
    pathCache.set(st, p);
  }
  return p;
}

function sizedPath(st, factor) {
  let m = sizedPathCache.get(st);
  if (!m) { m = new Map(); sizedPathCache.set(st, m); }
  let p = m.get(factor);
  if (!p) {
    p = new Path2D();
    traceOutline(getSizedOutline(st, factor), p);
    m.set(factor, p);
  }
  return p;
}

// ---------- textures (screen only) ----------
const textureCache = new Map();
// Pencil: fine graphite grain – soft value noise (no hard single pixels),
// mostly dense with a few lighter spots where the paper shows through.
const TILE = 128;
function noiseTile(kind) {
  let tile = textureCache.get(kind);
  if (tile) return tile;
  tile = document.createElement('canvas');
  tile.width = tile.height = TILE;
  const ctx = tile.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // value noise on a lattice (wraps around, so the tile repeats seamlessly)
  const layer = (cell) => {
    const n = TILE / cell, g = Array.from({ length: n * n }, rnd);
    const at = (i, j) => g[((j + n) % n) * n + ((i + n) % n)];
    const sm = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy);
      const u = sm(fx - i), v = sm(fy - j);
      return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
    };
  };
  const fine = layer(2), mid = layer(4), coarse = layer(16);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = (y * TILE + x) * 4;
      const n = 0.5 * fine(x, y) + 0.35 * mid(x, y) + 0.15 * coarse(x, y); // 0..1
      // dense graphite with soft lighter patches; never fully transparent
      const a = 255 * Math.min(1, 0.62 + 0.5 * Math.pow(n, 0.8));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  textureCache.set(kind, tile);
  return tile;
}

const patternCache = new Map();
function texturePattern(ctx, kind, color) {
  const key = kind + color;
  let entry = patternCache.get(key);
  if (!entry) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const x = c.getContext('2d');
    x.drawImage(noiseTile(kind), 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, TILE, TILE);
    entry = c;
    patternCache.set(key, entry);
  }
  return ctx.createPattern(entry, 'repeat');
}

// Inside of a closed shape (st.f = fill colour).
const fillCache = new WeakMap();
function fillPath(st) {
  let p = fillCache.get(st);
  if (!p) {
    p = new Path2D();
    for (let i = 0; i < st.p.length; i += 3) (i ? p.lineTo : p.moveTo).call(p, st.p[i], st.p[i + 1]);
    p.closePath();
    fillCache.set(st, p);
  }
  return p;
}

function paintFill(ctx, st) {
  if (!st.f || !isClosedShape(st)) return;
  ctx.globalAlpha = st.fa ?? 1;
  ctx.fillStyle = st.f;
  ctx.fill(fillPath(st));
  ctx.globalAlpha = 1;
}

// Exact eraser cuts (st.k): the ink is clipped to outside each eraser capsule.
const cutClipCache = new WeakMap();
function cutClips(st) {
  let list = cutClipCache.get(st);
  if (!list) {
    list = st.k.map((c) => {
      const p = new Path2D();
      p.rect(-1e5, -1e5, 2e5, 2e5);
      const poly = capsulePolygon(c);
      p.moveTo(poly[0][0], poly[0][1]);
      for (const q of poly) p.lineTo(q[0], q[1]);
      p.closePath();
      return p;
    });
    cutClipCache.set(st, list);
  }
  return list;
}

function paintStroke(ctx, st, scale, path, clipped = false) {
  if (st.k && !clipped) {
    ctx.save();
    for (const c of cutClips(st)) ctx.clip(c, 'evenodd');
    paintStroke(ctx, st, scale, path, true);
    ctx.restore();
    return;
  }
  paintFill(ctx, st);
  const look = strokeLook(st);
  if (look.glow) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = st.c;
    ctx.fill(sizedPath(st, 3.2));
    ctx.globalAlpha = 1;
    ctx.shadowColor = st.c;
    ctx.shadowBlur = Math.max(4, st.s * 2.2 * scale);
    ctx.fillStyle = st.c;
    ctx.fill(path);
    ctx.shadowBlur = 0;
    ctx.fillStyle = lighten(st.c, 0.65);
    ctx.fill(sizedPath(st, 0.45));
    ctx.restore();
    return;
  }
  ctx.globalAlpha = look.alpha;
  if (look.texture) {
    const pat = texturePattern(ctx, look.texture, st.c);
    // Keep the texture at screen resolution regardless of zoom.
    if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / scale));
    ctx.fillStyle = pat;
  } else {
    ctx.fillStyle = st.c;
  }
  ctx.fill(path);
  ctx.globalAlpha = 1;
}

function overlaps(b, clip) {
  return !clip || (b[0] <= clip[2] && b[2] >= clip[0] && b[1] <= clip[3] && b[3] >= clip[1]);
}

// Draw strokes in page units onto ctx, scaled by `scale`, offset by (ox, oy)
// device pixels. Highlighters go underneath pen ink. `clip` (page units)
// skips strokes outside the area being drawn.
export function drawStrokes(ctx, strokes, scale, { ox = 0, oy = 0, skip = null, clear = true, clip = null } = {}) {
  if (clear) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  for (const pass of [true, false]) {
    for (const st of strokes) {
      if ((st.t === 'hl') !== pass || (skip && skip.has(st.id))) continue;
      const b = strokeBBox(st);
      const pad = st.ps === 'neon' ? st.s * 2 : 0;
      if (!overlaps([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], clip)) continue;
      paintStroke(ctx, st, scale, strokePath(st));
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// The live stroke grows by a point at a time; the part already drawn never
// changes (see ink.js), so it is kept as a finished path and only the last
// stretch is rebuilt each frame – long lines stay smooth to draw. Both are
// filled together (one union, so see-through pens don't double up).
const liveCache = new WeakMap();
const TAIL = 32, REBUILD = 96;
function livePath(st) {
  const n = st.p.length / 3;
  const whole = () => { const p = new Path2D(); traceOutline(getLiveOutline(st), p); return p; };
  // widths that depend on the whole line (brush tapers, speed-based width without pressure)
  if (st.sh || st.ps === 'brush' || (st.np && st.ps === 'fountain') || n < TAIL * 2) { liveCache.delete(st); return whole(); }
  let c = liveCache.get(st);
  if (!c || c.np !== !!st.np || n < c.upto || n - c.upto > REBUILD) {
    const upto = n - TAIL;
    const head = new Path2D();
    traceOutline(getLiveOutline({ ...st, p: st.p.slice(0, upto * 3) }), head);
    c = { upto, head, np: !!st.np };
    liveCache.set(st, c);
  }
  const path = new Path2D();
  path.addPath(c.head);
  traceOutline(getLiveOutline({ ...st, p: st.p.slice((c.upto - 4) * 3) }), path);
  return path;
}

// Live (in-progress) stroke on a region canvas covering `rect` (page units).
export function drawLive(ctx, st, scale, rect = [0, 0], clear = true) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (clear) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!st || st.p.length < 3) return;
  const path = livePath(st);
  ctx.setTransform(scale, 0, 0, scale, -rect[0] * scale, -rect[1] * scale);
  if (st.f && isClosedShape(st)) { ctx.globalAlpha = st.fa ?? 1; ctx.fillStyle = st.f; ctx.fill(fillPath({ p: st.p })); ctx.globalAlpha = 1; }
  const look = strokeLook(st);
  if (look.glow) {
    ctx.shadowColor = st.c;
    ctx.shadowBlur = Math.max(4, st.s * 2.2 * scale);
  }
  ctx.globalAlpha = look.alpha;
  if (look.texture) {
    const pat = texturePattern(ctx, look.texture, st.c);
    if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / scale));
    ctx.fillStyle = pat;
  } else ctx.fillStyle = st.c;
  ctx.fill(path);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function strokePaperLines(ctx, kind, w, h, scale, area, pc, cover) {
  const { lines, dots, rects } = paperGeometry(kind, w, h, area, pc, cover);
  for (const [x, y, rw, rh, color] of rects) { ctx.fillStyle = color; ctx.fillRect(x, y, rw, rh); }
  for (const [x1, y1, x2, y2, color, width] of lines) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(width, 0.75 / scale);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  if (dots.length) {
    ctx.fillStyle = dots[0][3];
    const r = Math.max(dots[0][2], 0.9 / scale);
    ctx.beginPath();
    for (const [x, y] of dots) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

// Whole page (thumbnails).
// p: a page ({ paper, w, h, pc, cover })
export function drawPaper(ctx, p, scale) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = pageBackground({ kind: 'paper', ...p });
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  strokePaperLines(ctx, p.paper, p.w, p.h, scale, undefined, p.pc, p.cover);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Part of a page: `rect` in page (world) units.
export function drawPaperRegion(ctx, page, rect, scale) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = pageBackground(page);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, -rect[0] * scale, -rect[1] * scale);
  if (page.kind === 'board') {
    // Dot spacing adapts to zoom so the grid never turns into noise.
    const kind = scale < 0.6 ? 'blank' : 'board';
    strokePaperLines(ctx, kind, page.w, page.h, scale, rect);
  } else {
    strokePaperLines(ctx, page.paper, page.w, page.h, scale, undefined, page.pc, page.cover);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
