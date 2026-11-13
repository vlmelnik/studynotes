// Searchable scans: the text of scanned PDF pages, recognised with the text
// recognition add-on (German, English, Russian, offline – the same engine as
// "Make text editable"), is kept per notebook (ocr.json) as an invisible
// layer: search, text selection and the highlighter work on the scan, and the
// page itself stays exactly as it is. Pages are recognised on demand.
// Based on the contribution by Pedro Falbo (pull request #1).
import { isCancel } from './pdfdoc.js';
import { recognizeSized, ensureOcr } from './scan-edit.js';

export { ensureOcr };

const r2 = (v) => Math.round(v * 100) / 100;

// Words → lines (page units). Tesseract already groups words into lines.
function linesFrom(got, scale) {
  const out = [];
  for (const l of got) {
    const ws = (l.words || []).filter((w) => w && w.text && w.text.trim() && w.bbox && (w.conf == null || w.conf >= 25))
      .map((w) => ({ t: w.text.trim(), x0: r2(w.bbox.x0 / scale), x1: r2(w.bbox.x1 / scale), y0: r2(w.bbox.y0 / scale), y1: r2(w.bbox.y1 / scale) }));
    if (!ws.length) continue;
    ws.sort((a, b) => a.x0 - b.x0);
    out.push({ y0: Math.min(...ws.map((w) => w.y0)), y1: Math.max(...ws.map((w) => w.y1)), words: ws });
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
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    let got = await recognizeSized(canvas, blob);
    // dictionary check of the words (look-alike letters, lost spaces)
    try {
      const fixed = await window.api.ocrSpell(got.map((l) => ({ text: l.text, words: (l.words || []).map((w) => ({ text: w.text, conf: w.conf })) })));
      got = got.map((l, k) => ({ ...l, words: (l.words || []).map((w, i) => ({ ...w, text: fixed.lines[k].words[i].text })) }));
    } catch { /* keep the reading as it is */ }
    const lines = linesFrom(got, scale);
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
