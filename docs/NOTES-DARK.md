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

## 2026-11-23 — Notebook-specific display integration

Enable **Dark pages** in **Settings → Add-ons**. The notebook toolbar's **More**
menu then offers **Dark pages: Off**, **Background only** and **Full**.
**Full** is the reading mode for black text on white PDF pages. **Background
only** darkens near-white colours without changing black PDF text. The choice
is saved in the notebook; switching off the add-on stops the effect without
clearing that choice. The add-on is disabled by default. To use Dark View on a
standalone PDF, import it as a notebook. The app's edit-in-place workflow
can write notebook changes back into the PDF, so it does not offer Dark View.

The viewer opts into the display pipeline for its full PDF bitmaps and zoom
tiles. Page passes and the ink and highlighter callbacks read settings from
the owning editor even if its tab is inactive. A mode change drops only that
viewer’s affected bitmaps and cancels superseded renders. Raw rendering stays
unchanged for OCR inputs, saved covers, PDF-to-image assets and export. Pen
colours are remapped on screen only; highlighters change from multiply to
screen. Non-PDF pages are unaffected.

Raster figures are protected using PDF.js image-operator rectangles, including
repeated and grouped placements and transformed forms. A scanned page that is
one big picture keeps its original raster, pen colour and highlighter blend.
If image geometry cannot be read, the pass and its ink effect are skipped.
Bounding rectangles are conservative: they may leave some surrounding pixels
light, and they cannot separate a picture from paper baked into a scan.

Verified on Windows Electron: the Dark View suite passed 28/28 and the
extension-host suite 27/27. They check notebook isolation, source and export
preservation, the OCR input raster, regenerated covers and actual board assets,
typed photo transforms through zoom and rotation, and scan/ink fallback.
Before marking the draft ready, profile active Dark View on large raster PDF
pages at high zoom. The canvas pixel transform is local and synchronous; the
existing queue also waits for a third-party asynchronous pass to return even
after its discarded render has been cancelled.
