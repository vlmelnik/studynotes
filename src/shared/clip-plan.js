'use strict';

const MAX_SIDE = 4000;
const RENDER_FACTOR = 2;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function selectionText(items) {
  // Sorting a filtered array leaves the selection in its original drawing order.
  const readingOrder = items.filter((item) => item.type === 'text' || item.type === 'table');
  readingOrder.sort((a, b) => finiteNumber(a.y) - finiteNumber(b.y) || finiteNumber(a.x) - finiteNumber(b.x));

  const parts = [];
  for (const item of readingOrder) {
    if (item.type === 'table' && Array.isArray(item.cells)) {
      for (const row of item.cells) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          const text = cell?.t;
          if (typeof text === 'string' && text !== '') parts.push(text);
        }
      }
    } else if (typeof item.text === 'string' && item.text !== '') {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

function renderSize(bbox, zoom) {
  const w = Math.max(0, finiteNumber(bbox?.w));
  const h = Math.max(0, finiteNumber(bbox?.h));
  const screenScale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  // Use one scale for both sides to preserve the aspect ratio up to pixel rounding.
  const scale = Math.min(RENDER_FACTOR * screenScale, MAX_SIDE / Math.max(w, h), Number.MAX_VALUE);
  return {
    mode: 'render',
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

function clipPlan(sel) {
  const items = Array.isArray(sel?.items) ? sel.items.filter(Boolean) : [];
  let png = null;
  if (items.length === 1 && items[0].type === 'img') {
    // A lone picture can keep its original bytes and resolution.
    png = { mode: 'original' };
  } else if (items.length > 0) {
    png = renderSize(sel.bbox, sel.zoom);
  }

  const text = selectionText(items);
  return { png, text, html: png !== null && text !== '', privateClip: true };
}

module.exports = { clipPlan };
