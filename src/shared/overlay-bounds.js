'use strict';
// Where the floating reference reader may be: big enough, reachable by its
// title strip on some monitor (also after a monitor is unplugged), snapped to
// screen edges, resized with the page's aspect.

const TITLE = 32;

const area = (b) => Math.max(0, b.width) * Math.max(0, b.height);
const inter = (a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) });

/** The display that holds most of the box, else the one nearest its centre. */
function displayFor(b, displays) {
  let best = null, bestA = 0;
  for (const d of displays) { const a = area(inter(b, d)); if (a > bestA) { bestA = a; best = d; } }
  if (best) return best;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  let near = displays[0], nd = Infinity;
  for (const d of displays) {
    const dx = Math.max(d.x - cx, 0, cx - (d.x + d.width)), dy = Math.max(d.y - cy, 0, cy - (d.y + d.height));
    if (dx * dx + dy * dy < nd) { nd = dx * dx + dy * dy; near = d; }
  }
  return near;
}

function clampBounds(b, displays, { minWidth = 240, minHeight = 180, keepVisible = 80 } = {}) {
  const out = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(Math.max(minWidth, b.width)), height: Math.round(Math.max(minHeight, b.height)) };
  if (!displays || !displays.length) return out;
  const strip = { x: out.x, y: out.y, width: out.width, height: TITLE };
  const ok = displays.some((d) => { const i = inter(strip, d); return i.width >= Math.min(keepVisible, out.width) && i.height >= Math.min(TITLE, 8); });
  if (ok) return out;
  // move it onto the display nearest its centre, keeping its size where it fits
  const d = displayFor(out, displays);
  out.width = Math.min(out.width, d.width); out.height = Math.min(out.height, d.height);
  out.x = Math.min(Math.max(out.x, d.x), d.x + d.width - out.width);
  out.y = Math.min(Math.max(out.y, d.y), d.y + d.height - out.height);
  return out;
}

function snapBounds(b, d, threshold = 16) {
  const out = { ...b };
  if (Math.abs(b.x - d.x) <= threshold) out.x = d.x;
  else if (Math.abs(b.x + b.width - (d.x + d.width)) <= threshold) out.x = d.x + d.width - b.width;
  if (Math.abs(b.y - d.y) <= threshold) out.y = d.y;
  else if (Math.abs(b.y + b.height - (d.y + d.height)) <= threshold) out.y = d.y + d.height - b.height;
  return out;
}

/** Resize from an edge or corner; with an aspect (width / height) the other side follows and the opposite edge or corner stays. */
function resizeKeepingAspect(b, edge, dx, dy, aspect, { minWidth = 240, minHeight = 180 } = {}) {
  let { x, y, width, height } = b;
  const right = x + width, bottom = y + height;
  if (edge.includes('e')) width += dx;
  if (edge.includes('w')) width -= dx;
  if (edge.includes('s')) height += dy;
  if (edge.includes('n')) height -= dy;
  width = Math.max(minWidth, width); height = Math.max(minHeight, height);
  if (aspect) {
    const horizontal = edge === 'e' || edge === 'w' || (edge.length === 2 && Math.abs(dx) >= Math.abs(dy) * aspect);
    if (horizontal) height = width / aspect; else width = height * aspect;
    if (width < minWidth) { width = minWidth; height = width / aspect; }
    if (height < minHeight) { height = minHeight; width = height * aspect; }
  }
  if (edge.includes('w')) x = right - width;
  if (edge.includes('n')) y = bottom - height;
  // pure edge with aspect: the free side grows around the middle
  if (aspect && (edge === 'e' || edge === 'w')) y = b.y + (b.height - height) / 2;
  if (aspect && (edge === 'n' || edge === 's')) x = b.x + (b.width - width) / 2;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** A quarter-width window at the right edge, vertically centred. */
function defaultBounds(d, aspect = 0.7071) {
  const width = Math.round(Math.max(240, d.width / 4));
  const height = Math.round(Math.min(d.height - 40, width / aspect + TITLE));
  return { x: d.x + d.width - width - 16, y: Math.round(d.y + (d.height - height) / 2), width, height };
}

module.exports = { clampBounds, snapBounds, resizeKeepingAspect, defaultBounds, displayFor };
