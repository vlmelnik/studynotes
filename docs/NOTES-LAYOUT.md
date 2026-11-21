# Notes: Layout

## 2026-11-21 — Half-width toolbar planning

The planner keeps display order, reduces spacing between nonempty groups, then moves lower-ranked optional items into the overflow menu. Equal ranks use input order. The overflow button counts as its own group. A tooNarrow result keeps every required item visible and signals that the renderer needs a fallback.

Next: supply measured button widths and mark the active tool and history controls as required. Test the integrated toolbar at half-window width, including its overflow menu and the tooNarrow fallback.
