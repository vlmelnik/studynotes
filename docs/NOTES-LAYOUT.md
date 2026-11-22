# Notes: Layout

## 2026-11-21 — Half-width toolbar planning

The planner keeps display order, reduces spacing between nonempty groups, then moves lower-ranked optional items into the overflow menu. Equal ranks use input order. The overflow button counts as its own group. A tooNarrow result keeps every required item visible and signals that the renderer needs a fallback.

Next: supply measured button widths and mark the active tool and history controls as required. Test the integrated toolbar at half-window width, including its overflow menu and the tooNarrow fallback.

## 2026-11-21 — Floating bar placement

Added `src/shared/float-place.js` with `placeBar(bar, target, view, avoid)`. It tries above, below, right and left of the target with an 8 px gap. Each try is centred on the target and then slid along its side to stay inside the view. The first position that covers neither the target nor an avoid rectangle wins. If none fits and `bar.compactW` is set, the same order is tried at that width with `compact: true`. The last resort is a view corner, side `inside`.

Decisions:
- Overlap is strict, so a bar that only touches the toolbar edge is allowed.
- The corner keeps the 8 px gap from the window edge when there is room. Corners that are clear of avoid rectangles win, then the one whose centre is farthest from the target centre. Ties go to bottom right, bottom left, top right, top left, because toolbars usually sit at the top.
- In the corner the compact width is used only when the full bar is wider than the view.
- `avoid` may be omitted.

Open: the sideways slide does not move around avoid rectangles; a side is skipped instead. Nothing is wired into the renderer yet.

Next: pass the selection or text box rectangle in screen units, the visible editor area, and the toolbar rectangle from the toolbar-fit result. Re-run placement on resize, scroll and zoom. Supply `compactW` for bars that have a compact layout and render it when `compact` is true.
