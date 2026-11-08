// "Make text editable" for scans, photos and PDF pages: the text is
// recognised offline (add-on), the paper is painted back over it, and the
// lines come back as normal text boxes in the closest font, size and colour.
// Works for a lasso area or the whole page.
import { toast, confirmDialog } from './ui.js';
import { uid } from './tools.js';
import { stacked } from '../shared/stacking.js';
import { FONTS } from '../shared/fonts.js';
import { lineInk, cleanLines } from '../shared/scan-clean.js';
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
 * The font that looks most like the line: every candidate is drawn at the
 * size that matches the line's width and compared with the real ink.
 */
async function matchFont(li, line) {
  const text = line.text.trim();
  const w = li.w, h = li.h;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const inkW = line.bbox.x1 - line.bbox.x0;
  const baseY = ((line.baseline.y0 + line.baseline.y1) / 2) - li.box.y0;
  let best = null;
  for (const c of CANDIDATES) {
    await document.fonts.load(cssFont(c, 40), text).catch(() => {});
    ctx.font = cssFont(c, 100);
    const m = ctx.measureText(text);
    const mw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    if (!(mw > 0)) continue;
    const px = (100 * inkW) / mw;
    ctx.clearRect(0, 0, w, h);
    ctx.font = cssFont(c, px);
    const mm = ctx.measureText(text);
    const ox = line.bbox.x0 - li.box.x0 + mm.actualBoundingBoxLeft;
    ctx.fillStyle = '#000';
    ctx.fillText(text, ox, baseY);
    const a = ctx.getImageData(0, 0, w, h).data;
    let both = 0, nA = 0, nB = 0;
    for (let k = 0; k < w * h; k++) {
      const p = a[k * 4 + 3] > 110 ? 1 : 0, q = li.ink[k];
      nA += p; nB += q; if (p && q) both++;
    }
    const score = nA + nB ? (2 * both) / (nA + nB) : 0;
    if (!best || score > best.score) best = { ...c, px, score, left: mm.actualBoundingBoxLeft, asc: mm.fontBoundingBoxAscent, desc: mm.fontBoundingBoxDescent, baseY: baseY + li.box.y0 };
  }
  return best;
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
  if (r.x1 - r.x0 < 4 || r.y1 - r.y0 < 4) return;
  const rw = r.x1 - r.x0, rh = r.y1 - r.y0;
  const S = Math.min(DPI_SCALE, MAX_SIDE / Math.max(rw, rh), Math.sqrt(MAX_PIXELS / (rw * rh)));
  const busy = toast('Recognising text…', { timeout: 600000 });
  try {
    const { canvas, ctx } = await rasterize(editor, index, r, S);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    let lines = await window.api.ocrRecognize(new Uint8Array(await blob.arrayBuffer()), ['eng', 'deu', 'rus']);
    if (editor.destroyed) { busy.remove(); return; }
    const toPage = (x, y) => [r.x0 + x / S, r.y0 + y / S];
    lines = lines.filter((l) => l.conf >= 45 && l.text.trim().length && l.bbox.y1 - l.bbox.y0 >= 6);
    if (area && area.poly) lines = lines.filter((l) => pointInPolygon(...toPage((l.bbox.x0 + l.bbox.x1) / 2, (l.bbox.y0 + l.bbox.y1) / 2), area.poly));
    if (!lines.length) { busy.remove(); toast('No printed text found here'); return; }

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // font first (it needs the original ink), then clean the paper
    const fonts = [];
    for (const l of lines) {
      const hgt = l.bbox.y1 - l.bbox.y0, pad = Math.max(2, Math.round(hgt * 0.15));
      const li = lineInk(img, { x0: l.bbox.x0 - pad, y0: l.bbox.y0 - pad, x1: l.bbox.x1 + pad, y1: l.bbox.y1 + pad });
      fonts.push(li.w > 0 && li.h > 0 ? await matchFont(li, l) : null);
    }
    // lines no font could be measured for are left as they are
    lines = lines.filter((_, k) => fonts[k]);
    for (let k = fonts.length - 1; k >= 0; k--) if (!fonts[k]) fonts.splice(k, 1);
    if (!lines.length) { busy.remove(); toast('No printed text found here'); return; }
    const looks = cleanLines(img, lines);
    ctx.putImageData(img, 0, 0);

    // the cleaned paper: one picture over the area the lines cover
    let u = null;
    for (const l of lines) {
      const hgt = l.bbox.y1 - l.bbox.y0, pad = Math.round(hgt * 0.3) + 2;
      const b = [l.bbox.x0 - pad, l.bbox.y0 - pad, l.bbox.x1 + pad, l.bbox.y1 + pad];
      u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b;
    }
    u = [Math.max(0, Math.floor(u[0])), Math.max(0, Math.floor(u[1])), Math.min(canvas.width, Math.ceil(u[2])), Math.min(canvas.height, Math.ceil(u[3]))];
    const patch = document.createElement('canvas');
    patch.width = u[2] - u[0]; patch.height = u[3] - u[1];
    patch.getContext('2d').drawImage(canvas, -u[0], -u[1]);
    const big = patch.width * patch.height > 1.5e6;
    const pblob = await new Promise((res) => patch.toBlob(res, big ? 'image/jpeg' : 'image/png', 0.93));
    const src = await window.api.writeAsset(editor.rel, new Uint8Array(await pblob.arrayBuffer()), big ? 'jpg' : 'png');
    canvas.width = canvas.height = patch.width = patch.height = 0;
    if (editor.destroyed) { busy.remove(); return; }

    const before = editor.pageData(page.id);
    const [px0, py0] = toPage(u[0], u[1]);
    const item = { id: uid(), type: 'img', x: round2(px0), y: round2(py0), w: round2((u[2] - u[0]) / S), h: round2((u[3] - u[1]) / S), src, lay: 'b', scan: 1 };
    // the cleaned paper goes right above the pictures it was made from, so
    // tables or text sent to the back stay visible over it
    const back = stacked(before, 'b');
    const covers = (o) => o.type === 'img' && o.x < item.x + item.w && o.x + o.w > item.x && o.y < item.y + item.h && o.y + o.h > item.y;
    let below = -Infinity, k0 = -1;
    back.forEach((e, k) => { if (e.kind === 'item' && covers(e.obj)) { below = e.key; k0 = k; } });
    const next = back[k0 + 1];
    if (below === -Infinity) item.z = back.length ? back[0].key - 1 : 0; // only the PDF under it: lowest
    else item.z = next ? (below + next.key) / 2 : below + 1;
    const topF = Math.max(0, Math.ceil(stacked(before, 'f').reduce((m, e) => Math.max(m, e.key), 0)));
    let zf = topF + 1;
    const texts = lines.map((l, k) => {
      const f = fonts[k];
      const fs = f.px / S, asc = f.asc / S, desc = f.desc / S;
      const [bx, by] = toPage(l.bbox.x0 + f.left, f.baseY);
      const y = by - ((LINE_H * fs - (asc + desc)) / 2 + asc);
      return {
        id: uid(), x: round2(bx), y: round2(y), w: round2((l.bbox.x1 - l.bbox.x0) / S + fs), fs: round2(fs),
        c: looks[k].color, ff: f.ff, b: f.b || undefined, i: f.i || undefined, aw: true, text: l.text.trim(), lay: 'f', z: zf++,
      };
    });
    editor.commit(page.id, before, { ...before, items: before.items.concat([item]), texts: before.texts.concat(texts) });
    busy.remove();
    toast(`${texts.length} ${texts.length === 1 ? 'line is' : 'lines are'} editable now – double-click to change the text`, { timeout: 4000 });
  } catch (err) {
    busy.remove();
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true, timeout: 6000 });
  }
}
