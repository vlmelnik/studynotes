'use strict';

function clipPlan({ items, bbox, zoom }) {
  const lines = [];
  const ordered = [...items].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  for (const item of ordered) {
    if (item.type === 'text' && item.text) lines.push(item.text);
    if (item.type === 'table') {
      if (Array.isArray(item.cells)) {
        for (const row of item.cells) {
          for (const cell of row) if (cell?.t) lines.push(cell.t);
        }
      } else if (item.text) lines.push(item.text);
    }
  }
  const text = lines.join('\n');
  let png = null;
  if (items.length === 1 && items[0].type === 'img') {
    png = { mode: 'original' };
  } else if (items.length) {
    const longest = Math.max(bbox.w, bbox.h);
    const scale = longest > 0 ? Math.min(2 * zoom, 4000 / longest) : 2 * zoom;
    png = { mode: 'render', width: Math.max(1, Math.round(bbox.w * scale)),
      height: Math.max(1, Math.round(bbox.h * scale)), scale };
  }
  return { png, text, html: Boolean(png && text), privateClip: true };
}

module.exports = { clipPlan };
