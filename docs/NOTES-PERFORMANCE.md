# Notes: Performance

## 2026-11-23 — Frame-rate independent zoom and cursor anchoring

`src/shared/zoom-motion.js` contains the pure zoom helpers. With a 60 ms
time constant, a 2× change snaps at about 310 ms. The input layer still
decides whether Ctrl/Meta+wheel means zoom. The per-event factor is limited
to 0.5–2; pixel deltas below 40 follow a pinch without animation.

Viewer wiring for the maintainer (`src/renderer/viewer.js`, unchanged here):

- In `onWheel`, keep the Alt, Shift and Ctrl/Meta routing. Use
  `wheelZoomFactor(event)` for the factor and `!isTouchpadPinch(event)` for
  the animation flag.
- In `zoomTo`, use `clampZoom` for the target and keep one active animation
  loop with one elapsed-time calculation per `requestAnimationFrame`.
  Keep the clock when retargeting that loop. Cancel or invalidate pending
  callbacks when switching to a direct pinch or restarting; a stale
  callback must not advance the new target. Finish once `easeZoom` returns
  the target. Preserve the board's final update and the sharp-render delay.
- In `setZoom`, use `clampZoom` for the new zoom. Before relayout, select the
  anchor page index, record its `layout[index].x/y` as `pageX`/`pageY`, and
  capture scroll and the pointer relative to the scroller. After relayout,
  pass the same index's new `layout[index].x/y` as `nextPageX`/`nextPageY`
  to `anchorScroll`; `pageClientRect()` is in viewport rather than content
  coordinates. For a linear layout with fixed gaps, pass the zoom-1
  offsets `layoutX`/`layoutY` instead; omitting these assumes zero fixed
  gap. Leave no-hit and fit-mode handling intact.
- Use `clampZoom` for the saved zoom in both `restorePosition` branches and
  the computed factor in `fitWidth`. Those paths preserve their own anchors.

Next: verify pointer anchoring, pinch and Ctrl+wheel in the real viewer at
different refresh rates. Measure frame times on a long PDF before changing
render scheduling.
