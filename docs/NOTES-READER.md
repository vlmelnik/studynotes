# Notes: Reference reader

## 2026-11-23 — Document intake, reading positions and tabs

`src/shared/reader-docs.js` contains the reader's pure state logic. Use
`acceptDocs(files, open)` with dropped or picked file descriptors and the
currently open descriptors or document keys. It returns accepted files in
order and separate skip reasons. The size limit is 500 MB (500,000,000
bytes). `docKey` encodes the lower-case name and size so the picker, tabs
and position store agree.
This is a metadata filter; the adapter must still inspect or decode the file
before displaying it.

Start saved positions with `{}` and replace the store with the result of
`remember(store, key, view)`; it retains at most 50 entries, most recently
remembered last. `recall` returns a copy without changing recency. Call
`remember` when saving or revisiting a position to mark it recent. Zoom and
page are bounded, and `null` zoom lets the view fit to the window.

Start tabs with `{ tabs: [], active: null, used: {} }`. Pass the accepted
descriptors to `openTabs`; its first new tab becomes active. Close, move and
cycle functions take and return state without editing the input. The limit
is 12 tabs: keep the first 12 new selections and make room by evicting the
least recently activated existing tabs. Closing an inactive tab leaves
focus where it was. The UI should report selections that did not fit rather
than treating intake acceptance as confirmation that a tab was opened.

Next: wire these helpers into the reference reader's drop, picker and tab UI;
persist positions when switching or closing a document. Validate whether
the content is a supported PDF or image and show adapter errors after intake.
No window, rendering or file access code changed here.
