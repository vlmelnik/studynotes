'use strict';
// Tesseract result → text lines in page coordinates. Pure: unit-tested.
// (moved unchanged from src/renderer/ocr.js)

// Words → lines (page units). Tesseract already groups words into lines.
const r2 = (v) => Math.round(v * 100) / 100;

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

module.exports = { linesFrom };
