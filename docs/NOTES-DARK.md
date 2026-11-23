# Notes: Dark view

## 2026-11-21 — Map PDF page colours

Added `darkColor` for individual RGB colours and `darkenImage` for an RGBA
raster. Full mode reverses HSL lightness into the 12–88% range and preserves
hue and saturation before rounding to bytes. Background mode changes only
near-white, low-saturation colours to `#1e1e1e`.

The raster transform changes RGB in place and preserves alpha. Keep regions
are pixel rectangles with exclusive right and bottom bounds. Pass
`{ x, y, w, h }` or the scan layout's `{ x0, y0, x1, y1 }`. A reused row mask
keeps protected pictures intact without allocations per pixel.

Display integration and locating embedded picture rectangles remain open.

Next, use `darkColor(r, g, b, 'full')`, which returns `[r, g, b]`, to redraw
dark ink for dark pages. The highlighter needs its own blend mode. Apply these
changes to display colours so saved ink and PDF exports keep their original
appearance.

## 2026-11-23 - Screen ink helpers

`inkForDark` remaps ink below HSL lightness 0.5 using `darkColor` in full
mode and normalizes valid hex colors to lower-case six-digit hex. Light ink
keeps its original color. `highlightBlend` changes `multiply` to `screen`
for dark pages. These helpers do not alter stored strokes.

The add-on is not registered yet. The current host invokes PDF page passes
from `PdfDoc.render`, which is also called by OCR and library rendering; the
pass and ink filter cannot tell which notebook owns their render. The host
must scope passes to display canvases and supply the rendering notebook's
settings, plus let the viewer choose the highlighter blend for that notebook.
Afterward, verify two tabs with opposite settings, unchanged OCR input and
PDF export, and the preserved picture regions before shipping the add-on.
