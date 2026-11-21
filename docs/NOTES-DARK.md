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
