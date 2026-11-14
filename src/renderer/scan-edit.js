// "Make text editable" for scans, photos and PDF pages: the text is
// recognised offline (add-on), the paper is painted back over it, and the
// lines come back as normal text boxes in the closest font, size and colour.
// Works for a lasso area or the whole page.
import { googleLine } from '../shared/ocr-text.js';
import { graphicMarks, besideMark, underlinedWords } from '../shared/scan-layout.js';
import { toast, confirmDialog } from './ui.js';
import { uid } from './tools.js';
import { stacked } from '../shared/stacking.js';
import { FONTS } from '../shared/fonts.js';
import { lineWarp, pageWarps, lineLight } from './scan-geo.js';
import { lineInk, cleanLines, normalizeLight } from '../shared/scan-clean.js';
import { pointInPolygon, round2 } from '../shared/geometry.js';
import { CLASSIC, PRIOR, familiesFor, HAND, edgeSoftness, strokeWeight, boldWords, escHtml, bestOf, mainFamily, boldLines, chooseFonts, narrowLangs, fixUmlauts, paperColor, isDark, darkShare, mergeLines, invert, invertHex, skewOf, dilateMask, joinParagraphs } from '../shared/scan-text.js';

const LINE_H = 1.3;
const DPI_SCALE = 300 / 72; // page units are points: render at 300 dpi
const MAX_SIDE = 4200;
const MAX_PIXELS = 16e6;

// ---------- add-on ----------
/**
 * The add-on "Editable scans" (this file's "Make text editable"): an extra
 * the user turns on once (Settings → Add-ons). Text recognition itself comes
 * with the app (searchable scans).
 */
export async function ensureEditable() {
  const app = window.__app;
  if (app && app.settings && app.settings.editableScans) return ensureOcr();
  const ok = await confirmDialog('Add-on: Editable scans',
    'Turns text in scans, photos and PDFs into text boxes you can edit – in a matching font, size, colour, tilt and look; the paper is cleaned behind it. Handwriting becomes typed text. Works offline. Turn the add-on on? (Settings → Add-ons turns it off again.)',
    { okLabel: 'Turn on' });
  if (!ok) return false;
  if (app && app.settings) { app.settings.editableScans = true; app.saveSettings(); }
  return ensureOcr();
}

/** Text recognition is there (it comes with the app; missing only in a damaged install). */
export async function ensureOcr() {
  const st = await window.api.ocrStatus();
  if (st.installed) return true;
  toast('The text recognition data is missing – please reinstall StudyNotes', { error: true, timeout: 7000 });
  return false;
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
    const o = ((li.box.y0 + y) * gray.width + li.box.x0 + x) * 4;
    // (luminance: on an evenly lit page this is the colour original, and red
    // or orange letters have almost no contrast in the red channel alone)
    const g = (0.299 * gray.data[o] + 0.587 * gray.data[o + 1] + 0.114 * gray.data[o + 2]) / 255;
    const v = li.light ? g : 1 - g; // (light letters on a dark label: the light is the ink)
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
 * Stroke thickness the candidate would have in this line: drawn at the same
 * place, size and blur, then measured like the real ink.
 */
function renderedWeight(c, line, li, blur) {
  const cv = document.createElement('canvas');
  cv.width = li.w; cv.height = li.h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, li.w, li.h);
  g.fillStyle = '#000'; g.font = cssFont(c, c.px);
  if (blur > 0.2) g.filter = `blur(${blur.toFixed(2)}px)`;
  g.fillText(line.text.trim(), line.bbox.x0 - li.box.x0 + c.left, c.baseY - li.box.y0);
  const im = g.getImageData(0, 0, li.w, li.h);
  cv.width = cv.height = 0;
  return strokeWeight(lineInk(im, { x0: 0, y0: 0, x1: li.w, y1: li.h }));
}

// ---------- recognition ----------
const LANGS = ['deu', 'eng', 'rus'];
const TARGET_H = 34; // line height (px) Tesseract reads best
const HEAD_H = 28; // headings: big bold letters lose umlaut dots when larger // German first: umlauts (ü, ä, ß) are read right, English and Russian too

// canvas → PNG blob; a canvas too large for the browser gives null instead
// of a picture, which would end in an unclear error further on
async function pngBlob(c) {
  const b = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!b) throw new Error('The area is too large to read – select a smaller part of the page');
  return b;
}
// (an enlarged copy for reading stays below this many pixels)
const MAX_READ_PIXELS = 20e6;

/**
 * Tesseract reads best when letters are about 25–40 px high. Very large text
 * (screenshots, zoomed scans) loses umlaut dots; very small text loses
 * detail. After a first pass the picture is rescaled for a second one.
 */
export async function recognizeSized(canvas, blob, langs = LANGS) {
  const scaled = async (src, f) => {
    f = Math.min(f, Math.sqrt(MAX_READ_PIXELS / Math.max(1, src.width * src.height)));
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(src.width * f)); c2.height = Math.max(1, Math.round(src.height * f));
    const g = c2.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c2.width, c2.height);
    // (the factor actually used: the coordinates are mapped back with it)
    try { return [await pngBlob(c2), f]; } finally { c2.width = c2.height = 0; }
  };
  const read = async (bl, f, dx = 0, dy = 0) => {
    const got = await window.api.ocrRecognize(new Uint8Array(await bl.arrayBuffer()), langs);
    const sc = (b) => ({ x0: b.x0 / f + dx, y0: b.y0 / f + dy, x1: b.x1 / f + dx, y1: b.y1 / f + dy });
    return got.map((l) => ({ ...l, bbox: sc(l.bbox), baseline: sc(l.baseline), words: l.words.map((w) => ({ ...w, bbox: sc(w.bbox) })) }));
  };
  let lines = await read(blob, 1);
  const hs = lines.map((l) => l.bbox.y1 - l.bbox.y0).sort((x, y) => x - y);
  const med = hs.length ? hs[hs.length >> 1] : 0;
  if (med && (med < 22 || med > 48)) lines = await read(...(await scaled(canvas, Math.max(0.2, Math.min(3, TARGET_H / med)))));
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
    const again = (await read(...(await scaled(crop, f)), x0, y0)).filter((q) => q.text.trim());
    crop.width = crop.height = 0;
    // (the same letters but with umlaut dots read: the dots were seen, take it)
    const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (again.length === 1 && (again[0].conf > l.conf || (plain(again[0].text) === plain(l.text) && again[0].text !== l.text))) lines[k] = again[0];
  }
  return fixUmlauts(lines);
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

/**
 * Reads the lines once more with Google (Drive's text recognition: much
 * better for handwriting) and puts the new text into the same boxes. Online,
 * only when asked; the pictures are deleted from Drive right away.
 */
async function readWithGoogle(editor, pageId, ids, crops, lang, original) {
  const busy = toast('Reading with Google…', { timeout: 300000 });
  try {
    const bytes = await Promise.all(crops.map(async (c) => {
      const bl = await pngBlob(c);
      return new Uint8Array(await bl.arrayBuffer());
    }));
    const got = await window.api.ocrGoogle(bytes, lang);
    busy.remove();
    if (editor.destroyed) return;
    const before = editor.pageData(pageId);
    if (!before) return;
    let changed = 0;
    // ids: for every line read, its box and its line in that box ({ id, j })
    const texts = before.texts.map((t) => {
      const mine = ids.map((m, k) => (m.id === t.id ? k : -1)).filter((k) => k >= 0);
      if (!mine.length || t.html) return t;
      const rows = t.text.split('\n');
      // (a box edited meanwhile stays as the user wrote it)
      if (mine.some((k) => rows[ids[k].j] !== original[k])) return t;
      let n = 0;
      for (const k of mine) {
        // (Google may see bits of the neighbouring lines: the line most like ours is this one)
        const text = googleLine(got[k], original[k]);
        if (text && text !== rows[ids[k].j]) { rows[ids[k].j] = text; n++; }
      }
      if (!n) return t;
      changed += n;
      return { ...t, text: rows.join('\n') };
    });
    if (changed) editor.commit(pageId, before, { ...before, texts });
    toast(changed ? `Google changed ${changed} ${changed === 1 ? 'line' : 'lines'}` : 'Google read the same text', { timeout: 3500 });
  } catch (err) {
    busy.remove();
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true, timeout: 6000 });
  }
}

// ---------- main ----------
/**
 * Makes the printed text in `area` editable. area: { poly } (lasso, page
 * units) or null for the whole page.
 */
// pages being recognised right now (a second click on the same page waits
// for the first instead of adding a second set of text boxes)
const running = new Set();

export async function makeTextEditable(editor, index, area = null) {
  const page = editor.pages[index];
  if (!page) return;
  const key = `${editor.rel}\n${page.id}`;
  if (running.has(key)) { toast('Text recognition is already running on this page', { timeout: 3000 }); return; }
  running.add(key);
  try {
    if (!(await ensureEditable())) return;
    await editableRun(editor, index, page, area);
  } catch (err) {
    toast(String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true, timeout: 6000 });
  } finally {
    running.delete(key);
  }
}

async function editableRun(editor, index, page, area) {
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
    const pngOf = async (im) => { const c = imageCanvas(im); const bl = await pngBlob(c); return { c, bl }; };
    let n0 = await pngOf(norm);
    let lines = await recognizeSized(n0.c, n0.bl);
    // (tests: the first reading as recorded input for the layout rules)
    if (window.__ocrDebug) window.__ocrDebug.first = lines.map((l) => ({ text: l.text, conf: l.conf, bbox: l.bbox, baseline: l.baseline, words: (l.words || []).map((w) => ({ text: w.text, conf: w.conf, bbox: w.bbox })) }));
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
    // dark labels, buttons or screens next to light paper (a price tag, a
    // sign): evening out the light turns a dark label into "paper" and its
    // light letters vanish – read the original picture too and add the lines
    // found only there
    if (window.__ocrDebug) window.__ocrDebug.raw = lines.map((l) => [l.text, Math.round(l.conf)]);
    if (norm !== work && darkShare(work) > 0.12) {
      const nn = await pngOf(work);
      const extra = await recognizeSized(nn.c, nn.bl, langs);
      nn.c.width = nn.c.height = 0;
      if (editor.destroyed) { busy.remove(); return; }
      lines = mergeLines(lines, extra);
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
    // (lines read with less confidence stay for now: handwriting is read so;
    // they are dropped again below unless they turn out to be handwritten)
    lines = lines.filter((l) => l.conf >= 35 && wordy(l.text.trim()) && l.bbox.y1 - l.bbox.y0 >= 6).map((l) => ({ ...l, weak: l.conf < 50 }));
    // photos with more than paper (keyboard, handwriting, logos): very short
    // or oversized "lines" must be read with high confidence to count
    const lh = lines.map((l) => l.bbox.y1 - l.bbox.y0).sort((x, y) => x - y);
    const medH = lh.length ? lh[lh.length >> 1] : 0;
    lines = lines.filter((l) => {
      const n = (l.text.match(/[\p{L}\p{N}]/gu) || []).length;
      if (n <= 3 && l.conf < 80) return false;
      return !(lines.length >= 3 && l.bbox.y1 - l.bbox.y0 > medH * 2.5 && (l.conf < 85 || n < 4));
    });
    // a logo: its name next to a solid sign stays as it is (a logo is a picture)
    if (lines.length) {
      // (the letters' height from the words: a logo's sign makes its line's box tall)
      const wh = lines.flatMap((l) => (l.words || []).filter((w) => w.bbox && /[\p{L}\p{N}]{2}/u.test(w.text)).map((w) => w.bbox.y1 - w.bbox.y0)).sort((x, y) => x - y);
      const textH = wh.length ? wh[wh.length >> 1] : medH;
      // (big letters of a heading are no sign: a sign read as a "word" is
      // much taller than the real words of its line)
      const letterOf = (m) => lines.some((l) => {
        const hs = (l.words || []).filter((w) => w.bbox && (String(w.text).match(/[\p{L}\p{N}]/gu) || []).length >= 3).map((w) => w.bbox.y1 - w.bbox.y0);
        const ref = hs.length ? Math.min(...hs) : Infinity;
        const cx = (m.x0 + m.x1) / 2, cy = (m.y0 + m.y1) / 2;
        return (l.words || []).some((w) => w.bbox && cx > w.bbox.x0 && cx < w.bbox.x1 && cy > w.bbox.y0 && cy < w.bbox.y1 && w.bbox.y1 - w.bbox.y0 <= ref * 1.5);
      });
      const marks = graphicMarks(norm, textH).filter((m) => !letterOf(m));
      if (window.__ocrDebug) window.__ocrDebug.marks = marks;
      if (marks.length) lines = lines.filter((l) => !besideMark(l.bbox, marks, textH, (l.words || []).length || 1));
    }
    if (area && area.poly) lines = lines.filter((l) => pointInPolygon(...toPage(...back((l.bbox.x0 + l.bbox.x1) / 2, (l.bbox.y0 + l.bbox.y1) / 2)), area.poly));
    if (!lines.length) { busy.remove(); toast('No printed text found here'); return; }
    // dictionary check: look-alike letters of the wrong script ("Tak" → "Так"),
    // similar letters, a lost space after a preposition
    try {
      const fixed = await window.api.ocrSpell(lines.map((l) => ({ text: l.text, words: (l.words || []).map((w) => ({ text: w.text, conf: w.conf })) })));
      lines = lines.map((l, k) => ({ ...l, text: fixed.lines[k].text, words: (l.words || []).map((w, i) => ({ ...w, text: fixed.lines[k].words[i].text })) }));
    } catch (err) { console.warn('spelling check failed', err); }

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
      scores.push(ok ? await fontScores(li, l, norm, fams.concat(HAND).map((ff) => ({ ff, b: false, i: false }))) : []);
      weights.push(ok ? strokeWeight(li) : 0);
      await new Promise((res) => setTimeout(res)); // keep the window responsive
    }
    if (window.__ocrDebug) window.__ocrDebug.best = scores.map((sc) => +Math.max(0, ...sc.filter((c) => FONTS[c.ff].kind !== 'hand').map((c) => c.score)).toFixed(3));
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
    // handwriting: compared with the best printed font the letters stand
    // unevenly and change size from piece to piece, and the reading is less
    // sure. A whole handwritten page, or single lines (a filled-in form).
    const isHand = (c) => FONTS[c.ff].kind === 'hand';
    const boxOf = (l, f) => ({ x0: l.bbox.x0 + f.left, top: f.baseY - ((LINE_H * f.px - (f.asc + f.desc)) / 2 + f.asc), bw: l.bbox.x1 - l.bbox.x0, bh: LINE_H * f.px });
    const medOf = (a) => { const c = a.slice().sort((p, q) => p - q); return c.length ? c[c.length >> 1] : 0; };
    const jitter = lines.map((l, k) => {
      const pb = scores[k].filter((c) => !isHand(c)).sort((p, q) => q.score - p.score)[0];
      if (!inks[k] || !pb) return null;
      const b = boxOf(l, pb);
      const m = lineWarp({ li: inks[k], line: l, f: pb, cssFont, box: b, S, bw: b.bw, bh: b.bh });
      return m ? m.jitter : null;
    });
    // (from the surely read lines: noise read weakly jitters a lot)
    const sure = lines.map((l, k) => !l.weak && jitter[k] !== null);
    const js = jitter.filter((_, k) => sure[k]);
    const handPage = js.length >= 2 && (medOf(js) > 0.25 || (medOf(lines.filter((l, k) => sure[k]).map((l) => l.conf)) < 80 && medOf(js) > 0.15));
    const handLine = lines.map((l, k) => scores[k].length > 0 && (handPage || (js.length >= 3 && !l.weak && l.conf < 78 && jitter[k] > 0.3)));
    if (window.__ocrDebug) window.__ocrDebug.hand = lines.map((l, k) => [jitter[k] === null ? null : +jitter[k].toFixed(2), Math.round(l.conf), handLine[k]]);
    const keep = scores.map((sc, k) => sc.length > 0 && (!lines[k].weak || handLine[k]));
    lines = lines.filter((_, k) => keep[k]);
    const kHand = handLine.filter((_, k) => keep[k]);
    // printed lines are matched among the printed fonts only
    for (let k = 0; k < scores.length; k++) if (!handLine[k]) scores[k] = scores[k].filter((c) => !isHand(c));
    const kInks = inks.filter((_, k) => keep[k]), kWeights = weights.filter((_, k) => keep[k]);
    // how soft the scan is: mostly from the camera / scanner (the same number
    // of pixels everywhere), a bit more where the page is out of focus
    // (a straightened picture was resampled once: that softness is not the scan's)
    const lineSoft = lines.map((l) => edgeSoftness(work, l.bbox, work !== orig ? 0.45 : 0));
    const softs = lineSoft.filter((v) => v !== null).sort((x, y) => x - y);
    const softPx = softs.length ? softs[softs.length >> 1] : 0;
    const softOfLine = (k) => (lineSoft[k] === null ? softPx : Math.max(softPx * 0.6, Math.min(softPx * 1.8, lineSoft[k])));
    if (window.__ocrDebug) window.__ocrDebug.soft = lineSoft;
    const kAll = scores.filter((_, k) => keep[k]);
    const kScores = kAll.map((sc, k) => (kHand[k] ? sc.filter((c) => !isHand(c)) : sc));
    const fam = mainFamily(kScores);
    const regs = kScores.map((sc) => bestOf(sc, fam, (c) => !c.b && !c.i));
    // (the page's typical blur: a single line's measure is too noisy here)
    const qs = regs.map((rc, k) => { if (!rc || !kInks[k] || !kWeights[k]) return 0; const wr = renderedWeight(rc, lines[k], kInks[k], softPx); return wr > 0 ? kWeights[k] / wr : 0; });
    const bolds = boldLines(qs, regs.map((rc) => (rc ? rc.px : 0)));
    if (window.__ocrDebug) window.__ocrDebug.w = qs.map((q, k) => [+q.toFixed(2), regs[k] && +regs[k].px.toFixed(1), bolds[k]]);
    const fonts = chooseFonts(kScores, bolds);
    // handwritten lines: the handwriting font that fits the page's writing best
    if (kHand.some(Boolean)) {
      const hTotal = (ff) => kAll.reduce((a, sc, k) => a + (kHand[k] ? ((bestOf(sc, ff) || { score: 0 }).score) : 0), 0);
      const hf = HAND.slice().sort((x, y) => hTotal(y) - hTotal(x))[0];
      kAll.forEach((sc, k) => { const hc = kHand[k] && (bestOf(sc, hf, (c) => !c.b && !c.i) || bestOf(sc, hf)); if (hc) fonts[k] = { ...hc, hand: true }; });
    }
    if (!lines.length) { busy.remove(); toast('No printed text found here'); return; }
    // underlined words: a thin line of ink under the letters
    const unders = lines.map((l, k) => {
      if (fonts[k].hand || !l.words || !l.words.length || !l.baseline) return null;
      // (only when the words match the line's text: otherwise the underline
      // could not be put on the text box and must not be erased either)
      if (l.words.map((w) => w.text).join(' ') !== l.text.trim()) return null;
      const hgt = l.bbox.y1 - l.bbox.y0, base = Math.max(l.baseline.y0, l.baseline.y1);
      const li = lineInk(norm, { x0: l.bbox.x0 - hgt * 1.3, y0: l.bbox.y0, x1: l.bbox.x1 + hgt * 1.3, y1: base + hgt * 0.5 });
      if (!(li.w > 0 && li.h > 0)) return null;
      const f = underlinedWords(li, l.words, base, hgt, l.bbox);
      return f.some(Boolean) ? f : null;
    });
    // perspective and light of every line (before the paper is cleaned)
    const measured = lines.map((l, k) => {
      if (!kInks[k] || fonts[k].hand) return null; // (handwriting becomes plain text: no look)
      const b = boxOf(l, fonts[k]);
      return lineWarp({ li: kInks[k], line: l, f: fonts[k], cssFont, box: b, S, bw: b.bw, bh: b.bh });
    });
    const warps = pageWarps(measured, S);
    const geos = lines.map((l, k) => (kInks[k] && !fonts[k].hand ? {
      warp: warps[k],
      cg: lineLight({ li: kInks[k], line: l, img: work, box: boxOf(l, fonts[k]), S, fixColour: dark ? invertHex : (c) => c }),
    } : {}));
    if (window.__ocrDebug) window.__ocrDebug.geo = geos.map((g) => [g.warp ? g.warp.q : null, g.cg ? g.cg.length : 0]);
    // the line pictures as they are now, for "Read with Google" afterwards
    const crops = lines.map((l) => {
      const hh = l.bbox.y1 - l.bbox.y0, pd = Math.round(hh * 0.12) + 2; // (not into the lines above / below)
      const x0 = Math.max(0, Math.floor(l.bbox.x0 - pd)), y0 = Math.max(0, Math.floor(l.bbox.y0 - pd));
      const x1 = Math.min(W, Math.ceil(l.bbox.x1 + pd)), y1 = Math.min(H, Math.ceil(l.bbox.y1 + pd));
      const c = document.createElement('canvas');
      c.width = Math.max(1, x1 - x0); c.height = Math.max(1, y1 - y0);
      const im = new ImageData(c.width, c.height);
      for (let y = 0; y < c.height; y++) im.data.set(work.data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4), y * c.width * 4);
      c.getContext('2d').putImageData(im, 0, 0);
      return c;
    });
    const looks = cleanLines(work, lines.map((l, k) => (unders[k] ? { ...l, bbox: { ...l.bbox, y1: Math.max(l.bbox.y1, Math.max(l.baseline.y0, l.baseline.y1) + (l.bbox.y1 - l.bbox.y0) * 0.45) } } : l)), norm);
    if (dark) {
      invert(work);
      if (work !== orig) invert(orig);
      for (const lk of looks) lk.color = invertHex(lk.color);
    }
    n0.c.width = n0.c.height = 0;

    // 4. the cleaned paper as a picture over the area of the lines: only the
    //    painted pixels, transparent everywhere else (figures, formulas and
    //    the PDF around the text stay the original, not a re-encoded copy);
    //    in the original tilt the painted pixels are turned back
    const over = new ImageData(new Uint8ClampedArray(work.data), W, H);
    const grown = dilateMask(looks.fill, W, H, 2);
    for (let i = 0; i < W * H; i++) if (!grown[i]) over.data[i * 4 + 3] = 0;
    const cleaned = document.createElement('canvas');
    cleaned.width = W; cleaned.height = H;
    const g = cleaned.getContext('2d');
    if (work !== orig) { g.translate(cx, cy); g.rotate(rad); g.translate(-cx, -cy); }
    const overC = imageCanvas(over);
    g.drawImage(overC, 0, 0);
    overC.width = overC.height = 0;
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
    // (PNG: it needs the transparency; mostly empty, so it stays small)
    const pblob = await new Promise((res) => patch.toBlob(res, 'image/png'));
    if (!pblob) throw new Error('The area is too large to clean – select a smaller part of the page');
    const src = await window.api.writeAsset(editor.rel, new Uint8Array(await pblob.arrayBuffer()), 'png');
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
      const f = fonts[k], geo = geos[k];
      // the box in the straightened picture (pixels) …
      const { x0, top, bw, bh } = boxOf(l, f);
      // … turned back around its centre (a text box rotates around its centre)
      const [ccx, ccy] = back(x0 + bw / 2, top + bh / 2);
      const [px, py] = toPage(ccx - bw / 2, ccy - bh / 2);
      // (sc: made from the page's own text – search lists it instead of the text under the patch)
      const t = {
        id: uid(), x: round2(px), y: round2(py), w: round2(bw / S + f.px / S), fs: round2(f.px / S),
        c: looks[k].color, ff: f.ff, b: f.b || undefined, i: f.i || undefined, aw: true, text: l.text.trim(), sc: 1, lay: 'f', z: zf++,
      };
      // a photo taken at a slant (perspective): lines tilt a little
      // differently, each box gets its own line's tilt
      const bl = l.baseline, bw2 = bl ? bl.x1 - bl.x0 : 0;
      // (long lines only: short baselines are too noisy to trust)
      const res = bw2 > 200 ? (Math.atan2(bl.y1 - bl.y0, bw2) * 180) / Math.PI : 0;
      // (with a measured perspective the box keeps the page's tilt; the rest is in t.q)
      const turn = angle + (!geo.warp && !f.hand && Math.abs(res) > 0.6 && Math.abs(res) < 8 ? res : 0);
      if (Math.abs(turn) > 0.35) t.r = Math.round(turn * 10) / 10;
      // how the scanned letters look: as soft, in the same perspective and
      // light ("Match the document" button), straight and sharp while editing
      // single bold words in a regular line
      const wordsOk = l.words && l.words.map((w) => w.text).join(' ') === t.text;
      const bw3 = !f.b && !f.hand && kInks[k] && wordsOk && l.words.length >= 3 ? boldWords(kInks[k], l.words) : null;
      // (underlined: the whole line, or single words)
      const ul = wordsOk ? unders[k] : null;
      if (ul && ul.every(Boolean)) t.u = true;
      const ulw = ul && !ul.every(Boolean) ? ul : null;
      if ((bw3 && bw3.some(Boolean)) || ulw) {
        t.html = l.words.map((w, i) => {
          let x = escHtml(w.text);
          if (bw3 && bw3[i]) x = `<b>${x}</b>`;
          return ulw && ulw[i] ? `<u>${x}</u>` : x;
        }).join(' ').replace(/<\/u> <u>/g, ' ');
      }
      if (geo.warp) Object.assign(t, geo.warp);
      if (geo.cg) t.cg = geo.cg;
      const soft = Math.round((softOfLine(k) / S) * 100) / 100;
      if (!f.hand && (soft >= 0.05 || geo.warp || geo.cg)) { t.look = Math.max(soft, 0.02); t.fx = t.look; }
      return t;
    });
    // lines that belong together become one box (a paragraph, a centred title
    // of several lines): same font, size and colour, evenly spaced, aligned
    if (window.__ocrDebug) window.__ocrDebug.join = { texts: texts.map((t) => ({ ...t, q: t.q ? 1 : undefined, cg: t.cg ? 1 : undefined })), lines: lines.map((l) => ({ bbox: l.bbox })), fonts: fonts.map((f) => ({ hand: !!f.hand })), r, S };
    const { boxes, lineOf } = joinParagraphs(texts, lines, fonts, r, S);
    editor.commit(page.id, before, { ...before, items: before.items.concat([item]), texts: before.texts.concat(boxes) });
    busy.remove();
    // handwriting or an unsure reading: Google reads it better (online, optional)
    const unsure = fonts.some((f) => f.hand) || lines.reduce((a, l) => a + l.conf, 0) / lines.length < 85;
    const msg = `${boxes.length} ${boxes.length === 1 ? 'text is' : 'texts are'} editable now – double-click to change the text`;
    if (!unsure || (window.__app && window.__app.settings && window.__app.settings.googleOcrOffer === false)) { crops.forEach((c) => { c.width = c.height = 0; }); toast(msg, { timeout: 4000 }); return; }
    // a hint for Google from the letters read (none when unsure)
    const all = lines.map((l) => l.text).join(' ');
    const nCyr = (all.match(/[\u0400-\u04ff]/g) || []).length, nLat = (all.match(/[a-zA-ZäöüÄÖÜß]/g) || []).length;
    const lang = nCyr > (nCyr + nLat) * 0.6 ? 'ru' : nLat > (nCyr + nLat) * 0.9 ? (/[äöüÄÖÜß]|\b(und|der|die|das|ich|Sie)\b/.test(all) ? 'de' : 'en') : '';
    setTimeout(() => crops.forEach((c) => { c.width = c.height = 0; }), 30000);
    toast(msg, { timeout: 15000, action: { label: 'Read better with Google', onClick: () => readWithGoogle(editor, page.id, lineOf, crops, lang, texts.map((t) => t.text)) } });
  } catch (err) {
    busy.remove();
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true, timeout: 6000 });
  }
}
