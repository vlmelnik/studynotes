# Notes: Recognition

## 2026-11-21 — Expand block detection coverage

Used the existing synthetic RGBA page helper to cover uneven columns, side
contact with a frame, a single word, bullets, dotted leaders, and a 4000 × 3000
image. The tests assert exact bounds so a column merge, a missing bullet, or
an incorrectly scaled output is visible. The large case checks exclusive
bounds at the bottom and right edges.

Two additional fixtures reproduced defects and are marked skipped. Ragged
columns with a narrow diagonal gap become one block `[40, 40, 513, 90]`.
The expected blocks are `[40, 40, 251, 90]` and `[267, 40, 513, 90]`. When
every glyph touches the top frame, the returned block covers the entire
frame `[40, 25, 370, 177]`. The expected text bounds are `[62, 27, 206, 37]`.

Next, investigate column joining across a narrow gutter and rule detection
when a frame is connected to the text. Re-enable each skipped assertion
with its fix and verify the existing table and paragraph fixtures.
