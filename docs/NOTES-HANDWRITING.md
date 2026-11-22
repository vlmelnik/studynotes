# Notes: Handwriting

## 2026-11-21 — Align converted text with paper ruling

Added shared `snapLine(bbox, paper)` and unit tests with the app's real
`paperGeometry`. The helper uses the first ruling at or below three quarters
of the stroke bounds so descenders can fall below the baseline. It derives
line spacing from the geometry and shifts writing that starts left of a
ruled margin to four units inside it. On grids it uses the left grid column
or the current column when the writing starts on one.

Blank or unrecognized paper uses the stroke bounds. If an otherwise recognized
template has no eligible row below or column to the left, the corresponding
stroke coordinate is used. Geometry with fewer than two matching rows falls
back to the stroke height because it cannot supply a ruling gap.

Connecting the result to handwriting recognition and validating placement
with handwritten samples remain open.

Next, pass stroke bounds and paper geometry in the same page coordinates.
Position the typed text from the returned baseline and apply the line height
when setting the text box metrics.
