// "Make text editable" for scans, photos and PDF pages: the text is
// recognised offline (add-on), the paper is painted back over it, and the
// lines come back as normal text boxes in the closest font, size and colour.
// Works for a lasso area or the whole page.
import { toast, confirmDialog } from './ui.js';
import { uid } from './tools.js';
import { stacked } from '../shared/stacking.js';
import { FONTS } from '../shared/fonts.js';
import { lineInk, cleanLines, normalizeLight } from '../shared/scan-clean.js';
import { pointInPolygon, round2 } from '../shared/geometry.js';

const LINE_H = 1.3;
const DPI_SCALE = 300 / 72; // page units are points: render at 300 dpi
const MAX_SIDE = 4200;
const MAX_PIXELS = 16e6;

// ---------- add-on ----------
let installing = null;
let progressFn = null;
let listening = false;

/** True when the add-on is there (asks to download it otherwise). */
export async function ensureOcr() {
  const st = await window.api.ocrStatus();
  if (st.installed) return true;
  const mb = (st.size / 1048576).toFixed(0);
  const ok = await confirmDialog('Text recognition add-on',
    `Recognising text needs the language data for English, German and Russian (${mb} MB, from the StudyNotes page on GitHub). After the download it works offline. Download now?`,
    { okLabel: 'Download' });
  if (!ok) return false;
  return installOcr();
}

export async function installOcr(onProgress) {
  if (!installing) {
    const t = toast('Downloading text recognition… 0 %', { timeout: 600000 });
    const span = t.querySelector('span');
    progressFn = (done, total) => {
      const pct = Math.round((done / total) * 100);
      if (span) span.textContent = `Downloading text recognition… ${pct} %`;
      if (onProgress) onProgress(done, total);
    };
    if (!listening) { listening = true; window.api.onOcrProgress((d, tt) => { if (progressFn) progressFn(d, tt); }); }
    installing = window.api.ocrInstall().then(() => {
      t.remove();
      toast('Text recognition installed');
      return true;
    }, (err) => {
      t.remove();
      toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true, timeout: 6000 });
      return false;
    }).finally(() => { installing = null; });
  }
  return installing;
}

// ---------- page → picture ----------
// (through fetch: an <img> from the library would "taint" the canvas)
async function loadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('picture missing');
  return createImageBitmap(await res.blob());
}

/** The page's printed content (PDF + pictures, no ink / text boxes) inside `r`, at scale S. */
async function rasterize(editor, index, r, S) {
  const page = editor.pages[index];
  const data = editor.pageData(page.id);
  const cw = Math.max(1, Math.ceil((r.x1 - r.x0) * S)), ch = Math.max(1, Math.ceil((r.y1 - r.y0) * S));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  if (page.kind === 'pdf') {
    const src = page.src || 'main';
    let doc = editor.pdfFor(src);
    if (!doc && editor.pdfLoading.get(src)) { await editor.pdfLoading.get(src); doc = editor.doc.pdfs.get(src); }
    if (doc) {
      // only the area needed (a whole poster page at 300 dpi would not fit in memory)
      const part = await doc.renderRegion(page.pdfPage, S, page.rot || 0, r);
      ctx.drawImage(part, 0, 0);
      part.width = part.height = 0;
    }
  }
  for (const it of data.items) {
    if (it.type !== 'img' || it.x > r.x1 || it.y > r.y1 || it.x + it.w < r.x0 || it.y + it.h < r.y0) continue;
    const img = await loadImage(editor.assetUrl(it.src)).catch(() => null);
    if (!img) continue;
    ctx.save();
    ctx.translate((it.x - r.x0 + it.w / 2) * S, (it.y - r.y0 + it.h / 2) * S);
    if (it.r) ctx.rotate((it.r * Math.PI) / 180);
    ctx.globalAlpha = it.o != null ? it.o : 1;
    ctx.drawImage(img, (-it.w / 2) * S, (-it.h / 2) * S, it.w * S, it.h * S);
    ctx.restore();
  }
  return { canvas, ctx };
}

// ---------- font ----------
const CANDIDATES = [];
for (const ff of ['carlito', 'sans', 'serif', 'mono']) for (const [b, i] of [[false, false], [true, false], [false, true]]) CANDIDATES.push({ ff, b, i });

const cssFont = (c, px) => `${c.i ? 'italic ' : ''}${c.b ? 700 : 400} ${px}px "${FONTS[c.ff].css}"`;

/**
 * How well each candidate font matches the line: every candidate is drawn at
 * the size that gives the line's width and compared with the real ink.
 * Returns [{ ff, b, i, px, score, left, asc, desc, baseY }] (one per candidate).
 */
async function fontScores(li, line, gray) {
  const text = line.text.trim();
  const w = li.w, h = li.h;
  // darkness of the real line (0 = paper … 1 = ink), from the light-corrected picture
  const D = new Float32Array(w * h);
  let dm = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 1 - gray.data[((li.box.y0 + y) * gray.width + li.box.x0 + x) * 4] / 255;
    D[y * w + x] = v; dm += v;
  }
  dm /= w * h;
  let dv = 0;
  for (let k = 0; k < w * h; k++) dv += (D[k] - dm) * (D[k] - dm);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const inkW = line.bbox.x1 - line.bbox.x0;
  const baseY = ((line.baseline.y0 + line.baseline.y1) / 2) - li.box.y0;
  const out = [];
  for (const c of CANDIDATES) {
    await document.fonts.load(cssFont(c, 40), text).catch(() => {});
    ctx.font = cssFont(c, 100);
    const m = ctx.measureText(text);
    const mw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    if (!(mw > 0)) continue;
    const px = (100 * inkW) / mw;
    ctx.font = cssFont(c, px);
    const mm = ctx.measureText(text);
    const ox = line.bbox.x0 - li.box.x0 + mm.actualBoundingBoxLeft;
    ctx.fillStyle = '#000';
    // a blurry photo loses thin details (serifs): compare with the candidate
    // drawn sharp and blurred as much as the photo might be, keep the best
    let score = 0;
    for (const blur of [0, px * 0.035, px * 0.07]) {
      ctx.clearRect(0, 0, w, h);
      ctx.filter = blur ? `blur(${blur.toFixed(2)}px)` : 'none';
      ctx.fillText(text, ox, baseY);
      ctx.filter = 'none';
      // correlation of the grey values: no threshold, so blur and faint ink
      // don't decide the result
      const a = ctx.getImageData(0, 0, w, h).data;
      let am = 0;
      for (let k = 0; k < w * h; k++) am += a[k * 4 + 3];
      am /= w * h * 255;
      let cov = 0, av = 0;
      for (let k = 0; k < w * h; k++) { const v = a[k * 4 + 3] / 255 - am; cov += v * (D[k] - dm); av += v * v; }
      score = Math.max(score, av && dv ? cov / Math.sqrt(av * dv) : 0);
    }
    out.push({ ...c, px, score, left: mm.actualBoundingBoxLeft, asc: mm.fontBoundingBoxAscent, desc: mm.fontBoundingBoxDescent, baseY: baseY + li.box.y0 });
  }
  return out;
}

/** Typical thickness of the strokes in pixels (median horizontal ink run). */
function strokeWeight(li) {
  const runs = [];
  for (let y = 0; y < li.h; y++) {
    let run = 0;
    for (let x = 0; x <= li.w; x++) {
      const v = x < li.w ? li.ink[y * li.w + x] : 0;
      if (v) run++; else if (run) { runs.push(run); run = 0; }
    }
  }
  if (!runs.length) return 0;
  runs.sort((a, b) => a - b);
  return runs[runs.length >> 1];
}

/**
 * One font for the whole text (documents use one typeface; a line may only
 * differ when it clearly fits another one better), bold / italic per line.
 * Bold only when the strokes are clearly thicker than in the other lines.
 */
function chooseFonts(all, weights) {
  const fams = ['carlito', 'sans', 'serif', 'mono'];
  const bestOf = (sc, ff, pred = () => true) => sc.filter((c) => c.ff === ff && pred(c)).sort((x, y) => y.score - x.score)[0];
  const total = (ff) => all.reduce((sum, sc) => sum + ((bestOf(sc, ff) || { score: 0 }).score), 0);
  const main = fams.slice().sort((x, y) => total(y) - total(x))[0];
  // stroke thickness relative to the letter size (bold ≈ 1.5× regular)
  const rel = all.map((sc, k) => { const r = bestOf(sc, main, (c) => !c.b && !c.i); return r && r.px ? weights[k] / r.px : 0; });
  const sorted = rel.filter((v) => v > 0).sort((x, y) => x - y);
  const medW = sorted.length ? sorted[sorted.length >> 1] : 0;
  return all.map((sc, k) => {
    let ff = main;
    const own = sc.slice().sort((x, y) => y.score - x.score)[0];
    const inMain = bestOf(sc, main);
    // another kind of typeface (serif / sans / mono) only when it clearly fits
    // better – never switch between two similar sans fonts line by line
    const kind = (f) => (f === 'carlito' || f === 'sans' ? 'sans' : f);
    if (own && inMain && kind(own.ff) !== kind(main) && own.score - inMain.score > 0.08) ff = own.ff;
    // bold: from the stroke thickness when there are lines to compare with
    const bold = all.length >= 3 && medW ? rel[k] > medW * 1.3
      : (() => { const r = bestOf(sc, ff, (c) => !c.b && !c.i), b = bestOf(sc, ff, (c) => c.b); return !!(r && b && b.score - r.score > 0.04); })();
    const r = bestOf(sc, ff, (c) => c.b === bold && !c.i), it = bestOf(sc, ff, (c) => c.i && !bold);
    return it && r && it.score - r.score > 0.05 ? it : (r || bestOf(sc, ff) || own);
  });
}

// ---------- recognition ----------
const LANGS = ['deu', 'eng', 'rus'];
const TARGET_H = 34; // line height (px) Tesseract reads best
const HEAD_H = 28; // headings: big bold letters lose umlaut dots when larger // German first: umlauts (ü, ä, ß) are read right, English and Russian too

/**
 * Tesseract reads best when letters are about 25–40 px high. Very large text
 * (screenshots, zoomed scans) loses umlaut dots; very small text loses
 * detail. After a first pass the picture is rescaled for a second one.
 */
async function recognizeSized(canvas, blob) {
  const scaled = async (src, f) => {
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(src.width * f)); c2.height = Math.max(1, Math.round(src.height * f));
    const g = c2.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c2.width, c2.height);
    const b2 = await new Promise((res) => c2.toBlob(res, 'image/png'));
    c2.width = c2.height = 0;
    return b2;
  };
  const read = async (bl, f, dx = 0, dy = 0) => {
    const got = await window.api.ocrRecognize(new Uint8Array(await bl.arrayBuffer()), LANGS);
    const sc = (b) => ({ x0: b.x0 / f + dx, y0: b.y0 / f + dy, x1: b.x1 / f + dx, y1: b.y1 / f + dy });
    return got.map((l) => ({ ...l, bbox: sc(l.bbox), baseline: sc(l.baseline), words: l.words.map((w) => ({ ...w, bbox: sc(w.bbox) })) }));
  };
  let lines = await read(blob, 1);
  const hs = lines.map((l) => l.bbox.y1 - l.bbox.y0).sort((x, y) => x - y);
  const med = hs.length ? hs[hs.length >> 1] : 0;
  if (med && (med < 22 || med > 48)) lines = await read(await scaled(canvas, Math.max(0.2, Math.min(3, TARGET_H / med))), Math.max(0.2, Math.min(3, TARGET_H / med)));
  // lines much taller than the rest (headings) are read once more on their
  // own at the best size; the better reading wins
  const hs2 = lines.map((l) => l.bbox.y1 - l.bbox.y0).sort((x, y) => x - y);
  const med2 = hs2.length ? hs2[hs2.length >> 1] : 0;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k], h = l.bbox.y1 - l.bbox.y0;
    if (!med2 || h < med2 * 1.2) continue;
    const pad = Math.round(h * 0.4);
    const x0 = Math.max(0, Math.floor(l.bbox.x0 - pad)), y0 = Math.max(0, Math.floor(l.bbox.y0 - pad));
    const x1 = Math.min(canvas.width, Math.ceil(l.bbox.x1 + pad)), y1 = Math.min(canvas.height, Math.ceil(l.bbox.y1 + pad));
    const crop = document.createElement('canvas');
    crop.width = x1 - x0; crop.height = y1 - y0;
    crop.getContext('2d').drawImage(canvas, -x0, -y0);
    const f = Math.max(0.2, Math.min(3, HEAD_H / h));
    const again = (await read(await scaled(crop, f), f, x0, y0)).filter((q) => q.text.trim());
    crop.width = crop.height = 0;
    // (the same letters but with umlaut dots read: the dots were seen, take it)
    const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (again.length === 1 && (again[0].conf > l.conf || (plain(again[0].text) === plain(l.text) && again[0].text !== l.text))) lines[k] = again[0];
  }
  return fixUmlauts(lines);
}

// A word read without its umlaut (big or blurry letters lose the dots) while
// the same word appears with it elsewhere in the text: use that spelling.
function fixUmlauts(lines) {
  const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const known = new Map();
  for (const l of lines) for (const w of l.text.split(/[^\p{L}]+/u)) if (w && w !== plain(w)) known.set(plain(w).toLowerCase(), w);
  if (!known.size) return lines;
  const fix = (t) => t.replace(/\p{L}+/gu, (w) => {
    if (w !== plain(w)) return w;
    const k = known.get(w.toLowerCase());
    if (!k) return w;
    return w[0] === w[0].toUpperCase() ? k[0].toUpperCase() + k.slice(1) : k[0].toLowerCase() + k.slice(1);
  });
  return lines.map((l) => ({ ...l, text: fix(l.text), words: (l.words || []).map((w) => ({ ...w, text: fix(w.text) })) }));
}

// ---------- picture helpers ----------
function imageCanvas(im) {
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  c.getContext('2d').putImageData(im instanceof ImageData ? im : new ImageData(im.data, im.width, im.height), 0, 0);
  return c;
}

/** Rotated copy (degrees, around the centre), empty corners in `fill`. */
function rotateImage(im, deg, fill) {
  const src = imageCanvas(im);
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = `rgb(${fill[0]},${fill[1]},${fill[2]})`;
  g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate((deg * Math.PI) / 180); g.translate(-c.width / 2, -c.height / 2);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0);
  const out = g.getImageData(0, 0, c.width, c.height);
  src.width = src.height = c.width = c.height = 0;
  return out;
}

/** Typical paper colour (bright pixels). */
function paperColor(im) {
  const d = im.data, px = [];
  for (let i = 0; i < d.length; i += 4 * 97) px.push([d[i] + d[i + 1] + d[i + 2], d[i], d[i + 1], d[i + 2]]);
  px.sort((a, b) => b[0] - a[0]);
  const p = px[Math.floor(px.length * 0.2)] || [0, 255, 255, 255];
  return [p[1], p[2], p[3]];
}

/** Tilt of the text in degrees (median of the long lines' baselines). */
function skewOf(lines) {
  const a = lines.filter((l) => l.baseline && l.baseline.x1 - l.baseline.x0 > 80)
    .map((l) => (Math.atan2(l.baseline.y1 - l.baseline.y0, l.baseline.x1 - l.baseline.x0) * 180) / Math.PI)
    .filter((v) => Math.abs(v) < 20).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0;
}

function dilateMask(m, w, h, r) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) out[Y * w + X] = 1;
    }
  }
  return out;
}

// ---------- main ----------
/**
 * Makes the printed text in `area` editable. area: { poly } (lasso, page
 * units) or null for the whole page.
 */
export async function makeTextEditable(editor, index, area = null) {
  if (!(await ensureOcr())) return;
  const page = editor.pages[index];
  if (!page) return;
  let r = { x0: 0, y0: 0, x1: page.w, y1: page.h };
  if (area && area.poly) {
    const xs = area.poly.map((p) => p[0]), ys = area.poly.map((p) => p[1]);
    r = { x0: Math.max(0, Math.min(...xs)), y0: Math.max(0, Math.min(...ys)), x1: Math.min(page.w, Math.max(...xs)), y1: Math.min(page.h, Math.max(...ys)) };
  }
  // on a notebook page only the pictures can hold printed text: read just
  // them (the white page around a photo would confuse the light correction)
  if (page.kind !== 'pdf') {
    const pics = editor.pageData(page.id).items.filter((it) => it.type === 'img' && it.x < r.x1 && it.x + it.w > r.x0 && it.y < r.y1 && it.y + it.h > r.y0);
    if (pics.length) {
      const b = [Math.min(...pics.map((it) => it.x)), Math.min(...pics.map((it) => it.y)), Math.max(...pics.map((it) => it.x + it.w)), Math.max(...pics.map((it) => it.y + it.h))];
      r = { x0: Math.max(r.x0, b[0]), y0: Math.max(r.y0, b[1]), x1: Math.min(r.x1, b[2]), y1: Math.min(r.y1, b[3]) };
    }
  }
  if (r.x1 - r.x0 < 4 || r.y1 - r.y0 < 4) return;
  const rw = r.x1 - r.x0, rh = r.y1 - r.y0;
  const S = Math.min(DPI_SCALE, MAX_SIDE / Math.max(rw, rh), Math.sqrt(MAX_PIXELS / (rw * rh)));
  const busy = toast('Recognising text…', { timeout: 600000 });
  try {
    const { canvas, ctx } = await rasterize(editor, index, r, S);
    const W = canvas.width, H = canvas.height;
    const orig = ctx.getImageData(0, 0, W, H);
    // 1. even out the light (photos: shadows, glare) – recognition works on this
    let norm = normalizeLight(orig, Math.max(24, Math.round(S * 16)));
    // even light (scan, screenshot, PDF): read the original, it keeps fine
    // details like umlaut dots; photos: the light-corrected version
    if (!norm.uneven) norm = orig;
    const pngOf = async (im) => { const c = imageCanvas(im); const bl = await new Promise((res) => c.toBlob(res, 'image/png')); return { c, bl }; };
    let n0 = await pngOf(norm);
    let lines = await recognizeSized(n0.c, n0.bl);
    if (editor.destroyed) { busy.remove(); return; }
    // 2. a tilted page (photo, crooked scan): straighten it, read again,
    //    and give the text boxes the same tilt
    let angle = skewOf(lines);
    let work = orig;
    const norm0 = norm;
    // (twice at most: a blurry first pass can measure only part of the tilt)
    for (let pass = 0; pass < 2 && Math.abs(skewOf(lines)) > 0.35; pass++) {
      if (pass) angle += skewOf(lines);
      work = rotateImage(orig, -angle, paperColor(orig));
      norm = norm0 === orig ? work : rotateImage(norm0, -angle, [255, 255, 255]);
      n0 = await pngOf(norm);
      lines = await recognizeSized(n0.c, n0.bl);
      if (editor.destroyed) { busy.remove(); return; }
    }
    const cx = W / 2, cy = H / 2, rad = (angle * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
    const back = (x, y) => [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs]; // straightened → original pixels
    const toPage = (x, y) => [r.x0 + x / S, r.y0 + y / S];
    // real text: enough letters / digits, not edges or shadows read as "|_~"
    const wordy = (t) => (t.match(/[\p{L}\p{N}]/gu) || []).length >= Math.max(2, t.replace(/\s/g, '').length * 0.6);
    // specks at the start / end of a line (shadows, dust) are not words
    lines = lines.map((l) => {
      const ws = (l.words || []).slice();
      const junk = (w) => !w || !/[\p{L}\p{N}]/u.test(w.text);
      while (ws.length && junk(ws[0])) ws.shift();
      while (ws.length && junk(ws[ws.length - 1])) ws.pop();
      if (!ws.length || ws.length === (l.words || []).length) return l;
      const x0 = Math.min(...ws.map((w) => w.bbox.x0)), x1 = Math.max(...ws.map((w) => w.bbox.x1));
      const k = (x) => (l.baseline.x1 - l.baseline.x0 ? (x - l.baseline.x0) / (l.baseline.x1 - l.baseline.x0) : 0);
      const by = (x) => l.baseline.y0 + (l.baseline.y1 - l.baseline.y0) * k(x);
      return { ...l, words: ws, text: ws.map((w) => w.text).join(' '), bbox: { ...l.bbox, x0, x1 }, baseline: { x0, y0: by(x0), x1, y1: by(x1) } };
    });
    lines = lines.filter((l) => l.conf >= 50 && wordy(l.text.trim()) && l.bbox.y1 - l.bbox.y0 >= 6);
    if (area && area.poly) lines = lines.filter((l) => pointInPolygon(...toPage(...back((l.bbox.x0 + l.bbox.x1) / 2, (l.bbox.y0 + l.bbox.y1) / 2)), area.poly));
    if (!lines.length) { busy.remove(); toast('No printed text found here'); return; }

    // 3. font (needs the ink), then clean the paper
    const scores = [], weights = [];
    for (const l of lines) {
      const hgt = l.bbox.y1 - l.bbox.y0, pad = Math.max(2, Math.round(hgt * 0.15));
      const li = lineInk(norm, { x0: l.bbox.x0 - pad, y0: l.bbox.y0 - pad, x1: l.bbox.x1 + pad, y1: l.bbox.y1 + pad });
      scores.push(li.w > 0 && li.h > 0 ? await fontScores(li, l, norm) : []);
      weights.push(li.w > 0 && li.h > 0 ? strokeWeight(li) : 0);
    }
    const keep = scores.map((sc) => sc.length > 0);
    lines = lines.filter((_, k) => keep[k]);
    const fonts = chooseFonts(scores.filter((_, k) => keep[k]), weights.filter((_, k) => keep[k]));
    if (!lines.length) { busy.remove(); toast('No printed text found here'); return; }
    const looks = cleanLines(work, lines, norm);
    n0.c.width = n0.c.height = 0;

    // 4. the cleaned paper as a picture over the area of the lines (in the
    //    original tilt: only the painted pixels are turned back)
    let cleaned;
    if (work === orig) cleaned = imageCanvas(orig);
    else {
      const over = new ImageData(new Uint8ClampedArray(work.data), W, H);
      const grown = dilateMask(looks.fill, W, H, 2);
      for (let i = 0; i < W * H; i++) if (!grown[i]) over.data[i * 4 + 3] = 0;
      cleaned = imageCanvas(orig);
      const g = cleaned.getContext('2d');
      g.translate(cx, cy); g.rotate(rad); g.translate(-cx, -cy);
      g.drawImage(imageCanvas(over), 0, 0);
    }
    let u = null;
    for (const l of lines) {
      const hgt = l.bbox.y1 - l.bbox.y0, pad = Math.round(hgt * 0.3) + 2, padX = Math.round(hgt * 0.6) + 2;
      for (const [x, y] of [[l.bbox.x0 - padX, l.bbox.y0 - pad], [l.bbox.x1 + padX, l.bbox.y0 - pad], [l.bbox.x0 - padX, l.bbox.y1 + pad], [l.bbox.x1 + padX, l.bbox.y1 + pad]]) {
        const [X, Y] = back(x, y);
        u = u ? [Math.min(u[0], X), Math.min(u[1], Y), Math.max(u[2], X), Math.max(u[3], Y)] : [X, Y, X, Y];
      }
    }
    u = [Math.max(0, Math.floor(u[0])), Math.max(0, Math.floor(u[1])), Math.min(W, Math.ceil(u[2])), Math.min(H, Math.ceil(u[3]))];
    const patch = document.createElement('canvas');
    patch.width = u[2] - u[0]; patch.height = u[3] - u[1];
    patch.getContext('2d').drawImage(cleaned, -u[0], -u[1]);
    const big = patch.width * patch.height > 1.5e6;
    const pblob = await new Promise((res) => patch.toBlob(res, big ? 'image/jpeg' : 'image/png', 0.93));
    const src = await window.api.writeAsset(editor.rel, new Uint8Array(await pblob.arrayBuffer()), big ? 'jpg' : 'png');
    canvas.width = canvas.height = patch.width = patch.height = cleaned.width = cleaned.height = 0;
    if (editor.destroyed) { busy.remove(); return; }

    const before = editor.pageData(page.id);
    const [px0, py0] = toPage(u[0], u[1]);
    const item = { id: uid(), type: 'img', x: round2(px0), y: round2(py0), w: round2((u[2] - u[0]) / S), h: round2((u[3] - u[1]) / S), src, lay: 'b', scan: 1 };
    // the cleaned paper goes right above the pictures it was made from, so
    // tables or text sent to the back stay visible over it
    const backLayer = stacked(before, 'b');
    const covers = (o) => o.type === 'img' && o.x < item.x + item.w && o.x + o.w > item.x && o.y < item.y + item.h && o.y + o.h > item.y;
    let below = -Infinity, k0 = -1;
    backLayer.forEach((e, k) => { if (e.kind === 'item' && covers(e.obj)) { below = e.key; k0 = k; } });
    const next = backLayer[k0 + 1];
    if (below === -Infinity) item.z = backLayer.length ? backLayer[0].key - 1 : 0; // only the PDF under it: lowest
    else item.z = next ? (below + next.key) / 2 : below + 1;
    const topF = Math.max(0, Math.ceil(stacked(before, 'f').reduce((m, e) => Math.max(m, e.key), 0)));
    let zf = topF + 1;
    const texts = lines.map((l, k) => {
      const f = fonts[k];
      // the box in the straightened picture (pixels) …
      const top = f.baseY - ((LINE_H * f.px - (f.asc + f.desc)) / 2 + f.asc);
      const x0 = l.bbox.x0 + f.left, bw = l.bbox.x1 - l.bbox.x0, bh = LINE_H * f.px;
      // … turned back around its centre (a text box rotates around its centre)
      const [ccx, ccy] = back(x0 + bw / 2, top + bh / 2);
      const [px, py] = toPage(ccx - bw / 2, ccy - bh / 2);
      const t = {
        id: uid(), x: round2(px), y: round2(py), w: round2(bw / S + f.px / S), fs: round2(f.px / S),
        c: looks[k].color, ff: f.ff, b: f.b || undefined, i: f.i || undefined, aw: true, text: l.text.trim(), lay: 'f', z: zf++,
      };
      if (Math.abs(angle) > 0.35) t.r = Math.round(angle * 10) / 10;
      return t;
    });
    editor.commit(page.id, before, { ...before, items: before.items.concat([item]), texts: before.texts.concat(texts) });
    busy.remove();
    toast(`${texts.length} ${texts.length === 1 ? 'line is' : 'lines are'} editable now – double-click to change the text`, { timeout: 4000 });
  } catch (err) {
    busy.remove();
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true, timeout: 6000 });
  }
}
