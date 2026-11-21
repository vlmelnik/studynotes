# Notes: Clipboard

## 2026-11-21 — Clipboard format planning

Added shared `clipPlan(sel)` and unit tests for the chosen clipboard formats,
render sizing, and text order.

A single picture keeps its original bytes to preserve quality. Every other
non-empty selection gets a PNG at twice its screen scale, limited to 4000 px
on the longer side. One scale applies to both axes to preserve proportions
before pixel rounding. The plan supplies plain text from text boxes and stored
table cell text (`cells[row][column].t`) in reading order, skipping empty
entries. HTML is offered when the plan has both a PNG and plain text. The
private format preserves editable objects for paste within StudyNotes.

The clipboard write and paste behavior across apps still needs to be verified.

Next, build the selection input in the renderer copy handler. Use the original
picture bytes or draw the selection offscreen at the planned dimensions and
scale, then write the planned formats together. Verify pasting into another
app and back into StudyNotes.
