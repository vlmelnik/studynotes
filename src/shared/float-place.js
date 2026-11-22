'use strict';
// Where to put a floating bar (text format, pen options, selection actions)
// next to the object being edited. Pure geometry so the renderer and a later
// Android build can share it; all values are in the same screen units.

// Gap between the bar and the edited object, so the bar never touches the
// object's outline or its resize handles.
const GAP = 8;

function rectAt(x, y, w, h) {
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}

// Strict overlap: rectangles that only share an edge do not cover each other,
// otherwise a bar sitting exactly at the toolbar's lower edge would be rejected.
function overlaps(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function inside(r, view) {
  return r.x0 >= view.x0 && r.y0 >= view.y0 && r.x1 <= view.x1 && r.y1 <= view.y1;
}

// Keep a coordinate within [lo, hi]. When the bar is larger than the room
// (hi < lo) the value is left at lo and the inside() check rejects it later.
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}

// Candidate position for one side, centred on the target and then slid along
// that side so it stays inside the view. Sliding sideways is preferred over
// switching sides because the bar then stays visually attached to the object.
function candidate(side, w, h, target, view) {
  const cx = (target.x0 + target.x1) / 2, cy = (target.y0 + target.y1) / 2;
  let x, y;
  if (side === 'above' || side === 'below') {
    x = clamp(cx - w / 2, view.x0, view.x1 - w);
    y = side === 'above' ? target.y0 - GAP - h : target.y1 + GAP;
  } else {
    y = clamp(cy - h / 2, view.y0, view.y1 - h);
    x = side === 'right' ? target.x1 + GAP : target.x0 - GAP - w;
  }
  return { x, y };
}

const SIDES = ['above', 'below', 'right', 'left'];

function tryWidth(w, h, target, view, avoid) {
  for (const side of SIDES) {
    const { x, y } = candidate(side, w, h, target, view);
    const r = rectAt(x, y, w, h);
    if (!inside(r, view)) continue;
    if (overlaps(r, target)) continue;
    if (avoid.some((a) => overlaps(r, a))) continue;
    return { x, y, side };
  }
  return null;
}

// Last resort: a view corner, as far from the target's centre as possible so
// the user can still see most of the object. Corners that hit an avoid
// rectangle (the toolbar) lose against those that do not. The order decides
// ties: bottom corners first, because toolbars usually sit at the top.
function corner(w, h, target, view, avoid) {
  const cx = (target.x0 + target.x1) / 2, cy = (target.y0 + target.y1) / 2;
  // Keep the gap from the window edge when there is room for it.
  const gx = Math.max(0, Math.min(GAP, (view.x1 - view.x0 - w) / 2));
  const gy = Math.max(0, Math.min(GAP, (view.y1 - view.y0 - h) / 2));
  const left = view.x0 + gx, right = view.x1 - gx - w;
  const top = view.y0 + gy, bottom = view.y1 - gy - h;
  const spots = [[right, bottom], [left, bottom], [right, top], [left, top]];
  let best = null;
  for (const [x, y] of spots) {
    const r = rectAt(x, y, w, h);
    const free = !avoid.some((a) => overlaps(r, a));
    const dist = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
    if (!best || (free && !best.free) || (free === best.free && dist > best.dist + 1e-9)) best = { x, y, free, dist };
  }
  return { x: best.x, y: best.y };
}

// bar: { w, h, compactW? }; target, view: { x0, y0, x1, y1 }; avoid: rectangles.
// Returns { x, y, side, compact } with (x, y) the bar's top-left corner.
function placeBar(bar, target, view, avoid) {
  const list = Array.isArray(avoid) ? avoid : [];
  const full = tryWidth(bar.w, bar.h, target, view, list);
  if (full) return { ...full, compact: false };
  const hasCompact = typeof bar.compactW === 'number' && bar.compactW > 0 && bar.compactW < bar.w;
  if (hasCompact) {
    const small = tryWidth(bar.compactW, bar.h, target, view, list);
    if (small) return { ...small, compact: true };
  }
  // In the corner, use the compact width only when the full bar would not fit
  // the window at all: a full bar shows every control.
  const compact = hasCompact && bar.w > view.x1 - view.x0;
  const w = compact ? bar.compactW : bar.w;
  const c = corner(w, bar.h, target, view, list);
  return { x: c.x, y: c.y, side: 'inside', compact };
}

module.exports = { placeBar, GAP };
