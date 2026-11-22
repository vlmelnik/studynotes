# Notes: Outline

## 2026-11-21 — Map PDF destinations to notebook pages

Added `mapPdfOutline(items, src, pages)` and unit tests. The function accepts
one source's resolved PDF outline and returns a new tree with notebook page IDs
and depth levels starting at zero. It trims titles, collapses whitespace, and
limits titles to 200 characters.

When a destination page has been deleted, the nearest following page in that
PDF is preferred so navigation continues in source order. If no page follows,
the last remaining page of that source is used. A duplicated page maps to its
first copy in notebook order. Entries without a destination or without any
remaining source pages keep a null page ID.

Sidebar integration and navigation after reopening a notebook remain open.

Next, use the mapped tree for each source when building sidebar sections and
combining PDF outlines with notebook bookmarks. Pass the current ordered
notebook pages so duplicate destinations resolve consistently.
