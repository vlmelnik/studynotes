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
// Every typeface with a kind can be matched. The classic office fonts are
// the most likely in documents: another one has to fit a little better.
const CLASSIC = new Set(['carlito', 'sans', 'serif', 'mono']);
const PRIOR = 0.006; // per line, in correlation
const familiesFor = (cyr) => Object.keys(FONTS).filter((f) => FONTS[f].kind && (!cyr || FONTS[f].cyr !== false));
// blur levels (× letter size) the candidates are compared at: a blurry photo
// loses thin details like serifs
const BLURS = [0, 0.03, 0.07, 0.12];

const cssFont = (c, px) => `${c.i ? 'italic ' : ''}${c.b ? 700 : 400} ${px}px "${FONTS[c.ff].css}"`;

/**
 * How well each candidate font matches the line: every candidate is drawn at
 * the size that gives the line's width and compared with the real ink.
 * Returns [{ ff, b, i, px, score, left, asc, desc, baseY }] (one per candidate).
 */
async function fontScores(li, line, gray, cands) {
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
  for (const c of cands) {
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
    for (const bk of BLURS) {
      const blur = bk * px;
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
      const sc = av && dv ? cov / Math.sqrt(av * dv) : 0;
      if (sc > score) score = sc;
    }
    out.push({ ...c, px, score, prior: CLASSIC.has(c.ff) ? PRIOR : 0, left: mm.actualBoundingBoxLeft, asc: mm.fontBoundingBoxAscent, desc: mm.fontBoundingBoxDescent, baseY: baseY + li.box.y0 });
  }
  return out;
}

/**
 * How blurred the letters are (Gaussian sigma in pixels), from the letters'
 * edges alone – independent of the font: a step from paper to ink blurred by
 * sigma has its steepest slope = contrast / (sigma·√2π). A perfectly sharp
 * edge still measures ≈ 0.8 px (pixels are whole), which is taken out.
 */
function edgeSoftness(im, b, extra = 0) {
  const x0 = Math.max(1, Math.floor(b.x0)), x1 = Math.min(im.width - 1, Math.ceil(b.x1));
  const y0 = Math.max(1, Math.floor(b.y0)), y1 = Math.min(im.height - 1, Math.ceil(b.y1));
  if (x1 - x0 < 8 || y1 - y0 < 6) return null;
  const d = im.data, W = im.width;
  const g = (x, y) => { const i = (y * W + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
  const vals = [], grads = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    vals.push(g(x, y));
    const gx = (g(x + 1, y) - g(x - 1, y)) / 2, gy = (g(x, y + 1) - g(x, y - 1)) / 2;
    grads.push(Math.hypot(gx, gy));
  }
  vals.sort((p, q) => p - q); grads.sort((p, q) => p - q);
  const contrast = vals[Math.floor(vals.length * 0.95)] - vals[Math.floor(vals.length * 0.03)];
  const steep = grads[Math.floor(grads.length * 0.985)];
  if (contrast < 40 || !(steep > 0)) return null;
  const sigma = contrast / (steep * Math.sqrt(2 * Math.PI));
  // (× 1.2: strokes thinner than the blur lose some contrast – checked against
  // pictures blurred by a known amount in the bench)
  return Math.sqrt(Math.max(0, sigma * sigma - 0.64 - extra * extra)) * 1.2;
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
  const fams = [...new Set(all.flat().map((c) => c.ff))];
  const bestOf = (sc, ff, pred = () => true) => sc.filter((c) => c.ff === ff && pred(c)).sort((x, y) => y.score - x.score)[0];
  const total = (ff) => all.reduce((sum, sc) => { const c = bestOf(sc, ff); return sum + (c ? c.score + c.prior : 0); }, 0);
  const main = fams.slice().sort((x, y) => total(y) - total(x))[0];
  // stroke thickness relative to the letter size (bold ≈ 1.5× regular)
  const rel = all.map((sc, k) => { const r = bestOf(sc, main, (c) => !c.b && !c.i); return r && r.px ? weights[k] / r.px : 0; });
  const sorted = rel.filter((v) => v > 0).sort((x, y) => x - y);
  const medW = sorted.length ? sorted[sorted.length >> 1] : 0;
  // italic: clearly better than upright, and more than in the other lines (a
  // photo taken at a slant leans every line a little – that is not italic)
  const gainOf = (sc) => { const r = bestOf(sc, main, (c) => !c.b && !c.i), it = bestOf(sc, main, (c) => c.i); return r && it ? it.score - r.score : 0; };
  const gains = all.map(gainOf).sort((x, y) => x - y);
  const medGain = all.length >= 3 ? gains[gains.length >> 1] : 0;
  return all.map((sc, k) => {
    let ff = main;
    const own = sc.slice().sort((x, y) => y.score - x.score)[0];
    const inMain = bestOf(sc, main);
    // another kind of typeface (serif / sans / mono) only when it clearly fits
    // better – never switch between two similar sans fonts line by line
    const kind = (f) => FONTS[f].kind;
    if (own && inMain && kind(own.ff) !== kind(main) && own.score - inMain.score > 0.08) ff = own.ff;
    // bold: from the stroke thickness when there are lines to compare with
    // (and the bold letters must fit at least as well: small blurry print
    // looks thicker without being bold)
    const rb = bestOf(sc, ff, (c) => !c.b && !c.i), bb = bestOf(sc, ff, (c) => c.b);
    const bold = all.length >= 3 && medW ? rel[k] > medW * 1.3 && !!(rb && bb && bb.score >= rb.score - 0.01)
      : !!(rb && bb && bb.score - rb.score > 0.04);
    const r = bestOf(sc, ff, (c) => c.b === bold && !c.i), it = bestOf(sc, ff, (c) => c.i && !bold);
    return it && r && it.score - r.score > Math.max(0.06, medGain + 0.05) ? it : (r || bestOf(sc, ff) || own);
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
async function recognizeSized(canvas, blob, langs = LANGS) {
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
    const got = await window.api.ocrRecognize(new Uint8Array(await bl.arrayBuffer()), langs);
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

/**
 * The languages to read with once the first reading shows the script: a
 * German / English page read with Russian too gets stray Cyrillic look-alikes
 * ("Рог" for "Fior") in blurry places, and the other way round. null = keep all.
 */
function narrowLangs(lines) {
  let lat = 0, cyr = 0;
  const words = lines.flatMap((l) => l.words || []);
  for (const w of words) {
    if (w.conf < 60) continue;
    lat += (w.text.match(/[a-zA-ZäöüÄÖÜß]/g) || []).length;
    cyr += (w.text.match(/[\u0400-\u04ff]/g) || []).length;
  }
  if (lat + cyr < 20) return null;
  // (a real quote in the other script is read with confidence: keep all then)
  const stray = (re) => words.some((w) => re.test(w.text)) && !words.some((w) => re.test(w.text) && w.conf >= 85 && w.text.length >= 3);
  if (lat >= (lat + cyr) * 0.9 && stray(/[\u0400-\u04ff]/)) return ['deu', 'eng'];
  if (cyr >= (lat + cyr) * 0.9 && stray(/[äöüÄÖÜß]/)) return ['rus', 'eng'];
  return null;
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

/** Light text on a dark background (dark mode screenshots, menus, signs)? */
function isDark(im) {
  const d = im.data, v = [];
  for (let i = 0; i < d.length; i += 4 * 53) v.push(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
  v.sort((a, b) => a - b);
  return v.length > 0 && v[v.length >> 1] < 100;
}

function invert(im) {
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
}

const invertHex = (c) => '#' + (0xffffff ^ parseInt(String(c).slice(1, 7), 16)).toString(16).padStart(6, '0');

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
    // light letters on dark: everything below works on the negative (dark
    // letters on light paper), the cleaned picture and the colours are turned
    // back at the end
    const dark = isDark(orig);
    if (dark) invert(orig);
    // 1. even out the light (photos: shadows, glare) – recognition works on this
    let norm = normalizeLight(orig, Math.max(24, Math.round(S * 16)));
    // even light (scan, screenshot, PDF): read the original, it keeps fine
    // details like umlaut dots; photos: the light-corrected version
    if (!norm.uneven) norm = orig;
    const pngOf = async (im) => { const c = imageCanvas(im); const bl = await new Promise((res) => c.toBlob(res, 'image/png')); return { c, bl }; };
    let n0 = await pngOf(norm);
    let lines = await recognizeSized(n0.c, n0.bl);
    const langs = narrowLangs(lines) || LANGS;
    if (langs !== LANGS && Math.abs(skewOf(lines)) <= 0.35) lines = await recognizeSized(n0.c, n0.bl, langs);
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
      lines = await recognizeSized(n0.c, n0.bl, langs);
      if (editor.destroyed) { busy.remove(); return; }
    }
    const cx = W / 2, cy = H / 2, rad = (angle * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
    const back = (x, y) => [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs]; // straightened → original pixels
    const toPage = (x, y) => [r.x0 + x / S, r.y0 + y / S];
    // real text: enough letters / digits, not edges or shadows read as "|_~"
    const wordy = (t) => (t.match(/[\p{L}\p{N}]/gu) || []).length >= Math.max(2, t.replace(/\s/g, '').length * 0.6);
    // a wide gap splits a "line" into separate ones (columns, a price far
    // right, a stray mark): each piece gets its own box and size.
    // Specks at the start / end of a piece (shadows, dust) are not words.
    lines = lines.flatMap((l) => {
      const all = l.words || [];
      const lhgt = l.bbox.y1 - l.bbox.y0;
      const junk = (w) => !w || !/[\p{L}\p{N}]/u.test(w.text);
      // (gaps between real words: a speck between two columns doesn't join them)
      const groups = [[]];
      let lastReal = null;
      for (const w of all) {
        if (!junk(w) && lastReal && w.bbox.x0 - lastReal.bbox.x1 > lhgt * 2.5) groups.push([]);
        groups[groups.length - 1].push(w);
        if (!junk(w)) lastReal = w;
      }
      return groups.map((g) => {
        const ws = g.slice();
        while (ws.length && junk(ws[0])) ws.shift();
        while (ws.length && junk(ws[ws.length - 1])) ws.pop();
        if (ws.length === all.length) return l;
        if (!ws.length) return null;
        const x0 = Math.min(...ws.map((w) => w.bbox.x0)), x1 = Math.max(...ws.map((w) => w.bbox.x1));
        const k = (x) => (l.baseline.x1 - l.baseline.x0 ? (x - l.baseline.x0) / (l.baseline.x1 - l.baseline.x0) : 0);
        const by = (x) => l.baseline.y0 + (l.baseline.y1 - l.baseline.y0) * k(x);
        const conf = groups.length > 1 ? ws.reduce((a, w) => a + w.conf, 0) / ws.length : l.conf;
        return { ...l, conf, words: ws, text: ws.map((w) => w.text).join(' '), bbox: { ...l.bbox, x0, x1 }, baseline: { x0, y0: by(x0), x1, y1: by(x1) } };
      }).filter(Boolean);
    });
    lines = lines.filter((l) => l.conf >= 50 && wordy(l.text.trim()) && l.bbox.y1 - l.bbox.y0 >= 6);
    // photos with more than paper (keyboard, handwriting, logos): very short
    // or oversized "lines" must be read with high confidence to count
    const lh = lines.map((l) => l.bbox.y1 - l.bbox.y0).sort((x, y) => x - y);
    const medH = lh.length ? lh[lh.length >> 1] : 0;
    lines = lines.filter((l) => {
      const n = (l.text.match(/[\p{L}\p{N}]/gu) || []).length;
      if (n <= 3 && l.conf < 80) return false;
      return !(lines.length >= 3 && l.bbox.y1 - l.bbox.y0 > medH * 2.5 && (l.conf < 85 || n < 4));
    });
    if (area && area.poly) lines = lines.filter((l) => pointInPolygon(...toPage(...back((l.bbox.x0 + l.bbox.x1) / 2, (l.bbox.y0 + l.bbox.y1) / 2)), area.poly));
    if (!lines.length) { busy.remove(); toast('No printed text found here'); return; }

    // 3. font (needs the ink), then clean the paper
    //    first every typeface in its regular style, then bold / italic only
    //    for the few that fit best (fast enough with many fonts)
    const cyr = lines.some((l) => /[\u0400-\u04ff]/.test(l.text));
    const fams = familiesFor(cyr);
    const scores = [], weights = [], inks = [];
    for (const l of lines) {
      const hgt = l.bbox.y1 - l.bbox.y0, pad = Math.max(2, Math.round(hgt * 0.15));
      const li = lineInk(norm, { x0: l.bbox.x0 - pad, y0: l.bbox.y0 - pad, x1: l.bbox.x1 + pad, y1: l.bbox.y1 + pad });
      const ok = li.w > 0 && li.h > 0;
      inks.push(ok ? li : null);
      scores.push(ok ? await fontScores(li, l, norm, fams.map((ff) => ({ ff, b: false, i: false }))) : []);
      weights.push(ok ? strokeWeight(li) : 0);
      await new Promise((res) => setTimeout(res)); // keep the window responsive
    }
    const sum = (ff) => scores.reduce((a, sc) => { const c = sc.find((q) => q.ff === ff); return a + (c ? c.score + c.prior : 0); }, 0);
    const ranked = fams.slice().sort((x, y) => sum(y) - sum(x));
    // the 3 best, plus the best of each other kind (a serif heading in a sans text)
    const top = new Set(ranked.slice(0, 3));
    for (const kd of ['sans', 'serif', 'mono']) { const f = ranked.find((q) => FONTS[q].kind === kd); if (f) top.add(f); }
    const styled = [...top].flatMap((ff) => [{ ff, b: true, i: false }, { ff, b: false, i: true }]);
    for (let k = 0; k < lines.length; k++) {
      if (inks[k]) scores[k] = scores[k].concat(await fontScores(inks[k], lines[k], norm, styled));
      await new Promise((res) => setTimeout(res));
    }
    const keep = scores.map((sc) => sc.length > 0);
    lines = lines.filter((_, k) => keep[k]);
    const fonts = chooseFonts(scores.filter((_, k) => keep[k]), weights.filter((_, k) => keep[k]));
    // how soft the scan is: blur comes from the camera / scanner, so it is
    // the same number of pixels for every line – one value for the page
    // (a straightened picture was resampled once: that softness is not the scan's)
    const softs = lines.map((l) => edgeSoftness(work, l.bbox, work !== orig ? 0.45 : 0)).filter((v) => v !== null).sort((x, y) => x - y);
    const softPx = softs.length ? softs[softs.length >> 1] : 0;
    if (window.__ocrDebug) window.__ocrDebug.soft = softs;
    if (!lines.length) { busy.remove(); toast('No printed text found here'); return; }
    const looks = cleanLines(work, lines, norm);
    if (dark) {
      invert(work);
      if (work !== orig) invert(orig);
      for (const lk of looks) lk.color = invertHex(lk.color);
    }
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
      // a photo taken at a slant (perspective): lines tilt a little
      // differently, each box gets its own line's tilt
      const bl = l.baseline, bw2 = bl ? bl.x1 - bl.x0 : 0;
      // (long lines only: short baselines are too noisy to trust)
      const res = bw2 > 200 ? (Math.atan2(bl.y1 - bl.y0, bw2) * 180) / Math.PI : 0;
      const turn = angle + (Math.abs(res) > 0.6 && Math.abs(res) < 8 ? res : 0);
      if (Math.abs(turn) > 0.35) t.r = Math.round(turn * 10) / 10;
      // how soft the scanned letters are: the text is drawn the same way
      // ("Match the document" button), sharp while it is being edited
      const soft = Math.round((softPx / S) * 100) / 100;
      if (soft >= 0.05) { t.look = soft; t.fx = soft; }
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
