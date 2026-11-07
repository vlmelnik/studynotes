// OCR for scanned PDF pages (works offline: the engine, its WebAssembly core
// and the Portuguese / English language data are shipped inside the app, see
// scripts/build.js). The recognised words are kept per notebook (ocr.json) and
// feed the same places as the PDF's own text: search, text selection, the
// highlighter. Pages are recognised on demand, one after the other.
import { isCancel } from './pdfdoc.js';

const BASE = 'sn://app/ocr';
export const OCR_LANGS = ['por', 'eng'];

let workerPromise = null;

async function getWorker(langs = OCR_LANGS) {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker(langs, 1, {
      workerPath: `${BASE}/worker.min.js`,
      corePath: `${BASE}/core`,
      langPath: `${BASE}/lang`,
      workerBlobURL: false, // load the worker straight from the app (allowed by the page's security policy)
      cacheMethod: 'none',
      gzip: true,
    })).catch((err) => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

export async function stopOcr() {
  const p = workerPromise;
  workerPromise = null;
  if (p) { try { (await p).terminate(); } catch { /* already gone */ } }
}

const r2 = (v) => Math.round(v * 100) / 100;

// Words → lines (page units). Tesseract already groups words into lines.
function linesFrom(data, scale) {
  const out = [];
  const addLine = (words) => {
    const ws = words.filter((w) => w && w.text && w.text.trim() && w.bbox && (w.confidence == null || w.confidence >= 25))
      .map((w) => ({ t: w.text.trim(), x0: r2(w.bbox.x0 / scale), x1: r2(w.bbox.x1 / scale), y0: r2(w.bbox.y0 / scale), y1: r2(w.bbox.y1 / scale) }));
    if (!ws.length) return;
    ws.sort((a, b) => a.x0 - b.x0);
    out.push({ y0: Math.min(...ws.map((w) => w.y0)), y1: Math.max(...ws.map((w) => w.y1)), words: ws });
  };
  if (data.blocks) {
    for (const b of data.blocks) for (const p of b.paragraphs || []) for (const l of p.lines || []) addLine(l.words || []);
  } else if (data.lines) {
    for (const l of data.lines) addLine(l.words || []);
  }
  return out;
}

/**
 * Recognise one page of `pdf` (a PdfDoc). Returns { lines, text } in page
 * units (the page as shown without the user's extra rotation).
 */
export async function recognizePage(pdf, pdfPage, { signal } = {}) {
  const vp = await pdf.viewport(pdfPage, 1, 0);
  const scale = Math.min(4, Math.max(2, 2200 / vp.width)); // ≈ 240 dpi on an A4 page
  const job = pdf.render(pdfPage, scale, 5, 0);
  if (signal) signal.addEventListener('abort', () => job.cancel(), { once: true });
  const canvas = await job.promise;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const lines = linesFrom(data, scale);
    return { lines, text: lines.map((l) => l.words.map((w) => w.t).join(' ')).join('\n') };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** Layout for pdf-text.js (characters with boxes) from stored OCR lines. */
export function layoutFromOcr(page) {
  if (!page || !page.lines || !page.lines.length) return null;
  const lines = page.lines.map((l) => {
    const chars = [];
    l.words.forEach((w, wi) => {
      if (wi) { const prev = l.words[wi - 1]; chars.push({ ch: ' ', x0: prev.x1, x1: w.x0 }); }
      const n = [...w.t].length || 1;
      let x = w.x0;
      for (const ch of w.t) { const cw = (w.x1 - w.x0) / n; chars.push({ ch, x0: x, x1: x + cw }); x += cw; }
    });
    return { base: l.y1, y0: l.y0, y1: l.y1, chars };
  });
  return { lines }; // in the engine's reading order (it already separates columns)
}

export { isCancel };
