# StudyNotes – GoodNotes-style desktop app for Windows

## Decisions (from your answers)
- Platform: Windows 10/11, input via graphics tablet (Wacom/XP-Pen)
- Stack: Electron + PDF.js (rendering) + pdf-lib (export) + perfect-freehand (ink)
- v1 scope: PDF annotation, notebooks & folders, lasso & shapes, search, export & sync

## Architecture
- **Rendering:** each page = PDF canvas (bottom) + ink canvas (top)
- **Large PDFs:** virtualized page list – only visible pages ±2 are rendered; bitmap cache with an LRU limit; low-res first, sharp re-render after zoom settles; thumbnails lazy-loaded
- **Ink:** vector strokes (points + pressure) stored per page, not as images → small files, sharp at any zoom
- **Pen input:** Pointer Events with pressure; pen draws, mouse/touch pans (palm rejection); tablet button = eraser
- **Storage:** one library folder chosen by you (put it in OneDrive/Google Drive → sync for free)
  - `Library/<Folder>/<Notebook>/notebook.json`, `source.pdf`, `pages/<n>.json`
  - autosave after every stroke (debounced), crash-safe writes (temp file + rename)

## Tasks
- [x] 1. Project setup: Electron, build config, Windows installer (electron-builder)
- [x] 2. Library view: folders, notebooks with covers, create/rename/delete/move, import PDF
- [x] 3. Notebook editor: virtualized PDF viewer, zoom, page thumbnails sidebar, tabs
- [x] 4. Blank notebooks & inserted pages: blank / lined / grid / dotted paper
- [x] 5. Tools: pen (pressure), highlighter, eraser (whole stroke / partial), colors, widths, undo/redo
- [x] 6. Text boxes (typed notes)
- [x] 7. Lasso: select, move, resize, recolor, delete, copy/paste strokes
- [x] 8. Shapes: draw-and-hold to snap to line, rectangle, ellipse, triangle, arrow
- [x] 9. Page management: add, delete, duplicate, reorder
- [x] 10. Search: PDF text + typed text across a notebook and the whole library, jump to hit
- [x] 11. Export: annotated PDF with ink as vectors (single notebook or selected pages)
- [x] 12. Performance check: 500+ page PDF, scrolling, zoom, memory
- [x] 13. Verification: automated tests for storage/export/lasso math + manual run of the built app
- [x] 14. Package: Windows installer (.exe) + portable .zip

## Not in v1 (possible later)
- Handwriting recognition (OCR on ink), audio recording, iPad/phone app, real-time collaboration

## Review (2026-10-19)

### Verification
- Unit tests: 17/17 — storage, Windows file names, path safety, eraser/lasso math, shape recognition, export point mapping (checked against pdf.js for all 4 rotations + crop box), Unicode export, search.
- End-to-end: 30/30 on the dev build **and** on the packaged app (real Electron, Playwright).
- Performance with a generated 600-page PDF:
  - First page visible ≈ 1 s
  - Scrolling p95 frame time 16.8 ms (60 fps)
  - Jump to page 451: ~0.1–0.4 s
  - Export of all 600 pages: ~1 s
- Real PDFs:
  - TraceMonkey paper (embedded fonts, figures): renders, annotates and exports correctly
  - 3,689-page vector PDF: first open 3.2 s (one-time), later jumps ~0.1 s

### Issues found and fixed during verification
1. Memory grew to 5.5 GB and the renderer crashed.
   - Cause: canvases were dropped without being freed. Chromium only frees them on GC.
   - Fix: canvases are now released explicitly, and the bitmap cache is limited to 28 Mpx.
2. Scrolling jank while flying through pages.
   - Fix: cheap previews while scrolling fast, sharp re-render when scrolling stops (p95 33 → 17 ms).
3. Shapes drawn with the Shapes tool rendered tiny.
   - Cause: a stale cached outline from the live preview.
4. Search highlight was offset by 2 characters.
   - Fix: length-preserving case/accent folding.
5. Cover colours were not applied (CSS custom properties).
6. Text wrapping in the export didn't break over-long words.
7. Independent code review — fixed:
   - Sync-conflict files in `pages/` broke opening a notebook, or were deleted
   - Double tab close dropped the wrong editor
   - A failed save could still let the app close
   - Renaming a folder with an open notebook inside
   - Cover / `notebook.json` write race
   - Root-path guards (`.` / `a/..`)
   - Undo order with text edits
   - Undo during a gesture
   - Writes after a tab was closed
   - Test-only export IPC was reachable in production

### Known limits (v1)
- Scanned PDFs: no OCR, so not searchable.
- No handwriting recognition, audio, or mobile app.
- Editing the same notebook on two PCs at once via a sync folder can produce conflict copies. They are kept, not merged.
- The installer is unsigned, so SmartScreen shows a warning on first start.

---

# v1.1 – feature requests (2026-10-19)

## Plan
- [x] 0. **Bug:** line / arrow shapes don't work → reproduce, find root cause, fix, add e2e test
- [x] 1. **Insert PDF into a notebook:** whole PDF or a page range, at any position (notebook can reference several PDFs)
- [x] 2. **Clipboard paste (Ctrl+V):** images, text, tables, files from Explorer → placed at the visible spot, selected right away, app switches to the select tool
- [x] 3. **Select tool ("finger", left of pen):** click/tap any object to select it; move, resize, rotate-free; edit text, colour, size; image crop/size
- [x] 4. **Shapes:** rounded rectangle, smoother auto-shapes (curve fitting), more shapes (star, diamond, hexagon, cylinder, double arrow, speech bubble …); fix line/arrow
- [x] 5. **Favourite tools:** save pen presets (type + colour + size), recent tools bar
- [x] 6. **Text formatting:** a few fonts, bold / italic / underline, size, colour
- [x] 7. **Endless page:** Miro-like canvas, grows in all directions; export crops to content + margin
- [x] 8. **More colours + pen types:** larger palette, neon (glow), pencil (grain), marker/oil (textured)
- [x] 9. **More page templates:** Cornell notes, engineering grid, music staff, isometric dots, to-do, hex
- [x] 10. **Backup:** export/import settings (versioned, forward-compatible), export/import all notes (.studynotes archive)
- [x] 11. **Send:** current page / notebook as PDF via e-mail or Telegram
- [x] 12. **Smoother zoom:** animated, cursor-anchored, GPU transform during gesture, re-render after
- [x] 13. **Compatibility:** data format version number + migrations, old notebooks keep opening
- [x] 14. **Verify:** unit + e2e tests for every feature, packaged build, independent review

## Decisions (your answers)
- Send: open mail client with PDF attached / open Telegram with the PDF on the clipboard (Ctrl+V into the chat)
- Pasted tables become editable tables
- Endless page: only as a notebook type (whiteboard)
- New pens: pencil, neon, brush/oil, marker
- Paste: plain text by default, setting to keep bold/italic/lists
- Dictation: not now

## Review v1.1 (2026-10-19)

### Verification
- Unit tests 26/26. End-to-end: original suite 30/30, new-feature suite 24/24 (`test/e2e/v11.js`, real clipboard + real UI), real-PDF test OK.
- Covered by e2e:
  - paste picture / text / table from the system clipboard; select tool active afterwards
  - select tool: click, drag, resize a picture
  - bold + underline + font
  - line, arrow, rounded rectangle, star
  - draw & hold → rounded rectangle
  - pencil, marker, brush, neon; recent pens remembered
  - Cornell page
  - insert pages 2–3 of another PDF
  - export containing pictures, tables, styled text
  - endless board grows and exports cropped to content
  - animated zoom
  - backup export → import into an empty library, pictures included

### Bugs found and fixed
1. Line and arrow shapes drew nothing.
   - Cause: `snapAngle()` returns `[start, end]`, but the result was used as the end point.
2. Select tool lost the selection mid-drag (and threw).
   - Cause: a height-only resize re-ran "fit width", which reported a zoom change and cleared the selection.
   - Fix: only report real zoom changes; guard the drag.
3. Pasting files copied in Explorer would fail on Electron 44.
   - Cause: `clipboard.readBuffer` was removed.
   - Fix: rewritten for the async ClipboardItem API (`format="FileNameW"`). PDFs are also taken straight from the paste event.
4. Repeated pastes landed on top of each other.
   - Fix: each paste is now offset a little.

### Not testable here (Windows-only, needs your PC)
- Sending via Outlook / Thunderbird / Telegram (argument quoting is unit-tested)
- Explorer file paste (`FileNameW` format)
- Windows Ink pen pressure

---

# v1.2 – feature requests (2026-10-19)

## Plan
- [x] 1. **Bug:** "Bring to front" on a picture leaves it behind → reproduce, root cause, fix; make front/back work for text boxes too
- [x] 2. **Remove the options row** (hint text + zoom buttons). Tool options move into the toolbar as in GoodNotes; zoom % appears bottom-right while zooming, then fades out
- [x] 3. **Text formatting:** size, font, colour for the whole box (selected box) or only the selected characters; custom size (any number) besides presets
- [x] 4. **GoodNotes-style text box:** thin border, blue side handles, floating dark text bar under the box (colour, size, B/I, align, list, line style, cut, copy, delete, more)
- [x] 5. **Toolbar redesign:** blue top bar with centred tools, dark options strip below, pen types as icons, nicer icons
- [x] 6. **Laser pointer** tool (fading trail, not saved)
- [x] 7. **Dark mode** (interface only; pages stay white)
- [x] 8. **Google Drive sync** with built-in Google login (OAuth, drive.file scope, two-way sync of the library folder)
- [x] 9. **Verify:** unit + e2e for every item, packaged build, screenshots

## Decisions (your answers)
- Options row removed; options live in the toolbar; zoom shows bottom-right briefly
- Drive: built-in Google login (needs a one-time Google Cloud client ID)
- Dark mode: interface only
- Toolbar: blue top bar + floating text bar + pen types as icons

## Review v1.2 (2026-10-20)
- Bring-to-front bug: root cause = pictures always lived in a layer below ink and text. New stacking model (back/front layer + z), used by screen, hit-test and PDF export.
- Text: per-word or whole-box size/font/colour, any number as size, GoodNotes text bar + handles, alignment, list, box style.
- Toolbar: blue top bar, centred tools, dark floating options strip, new icons; old hint/zoom row removed, zoom % pill bottom-right.
- Laser (K), dark mode (interface only), Google Drive sync (OAuth PKCE, drive.file, 3-way sync, conflicts keep both, mass-delete guard, open notebooks skipped).
- Found during verification: PDF export lost "ti" in Carlito text (ligature glyph) → fonts embedded without ligatures + regression test.
- Independent code review found 9 issues, all fixed with tests:
  - sync: missing library folder → stop (NO_LIBRARY); empty local library never empties Drive; per-library state id = sha256 of path (no collisions); open-notebook skip re-checked during the run; renaming an open notebook updates the skip list; Drive files differing only in case are ignored on Windows
  - security: all stored HTML (text boxes, table cells) is sanitised before display (synced files can't inject links/overlays)
  - export: invalid character references no longer crash; line height never below the box font size (matches screen)
  - sign-out removes the saved Google token even if the client ID was cleared
- Tests: unit 60/60, e2e run 30/30, v11 24/24, v12 22/22, real PDF ok; packaged app: run 30/30, v11 24/24, v12 17/17 (fake Drive not shipped).
- Limits: Drive sync tested only against a simulated Drive (Google not reachable from the build machine). User needs a one-time Google client ID.

# v1.3 – feature requests (2026-10-20)

## Plan
### A. Sync & data safety (most important)
- [x] A1. Fix: closing a non-active tab doesn't tell sync → notebook skipped until restart. Re-test whole sync flow; clear status texts ("2 open notebooks skipped")
- [x] A2. Auto-sync every 15 min (saves all open notebooks first), cloud button, Ctrl+S
- [x] A3. On exit: window waits for sync with progress ("Syncing… 12/40") + "Close without syncing"
- [x] A4. Crash safety: every change written to a recovery journal immediately; after crash/power loss the app restores unsaved strokes on next start
- [x] A5. Local backups: hourly for today + daily for 7 days (.studynotes per notebook), folder next to library
- [x] A6. Drive layout inside "StudyNotes Library": PDF/ (readable PDF per notebook, updated when changed), Backups/ (daily .studynotes), Service folder (sync data in real subfolders)
### B. Text box (GoodNotes style)
- [x] B1. Frame + small handles only while editing/selected; new box starts thin and grows while typing
- [x] B2. Click elsewhere while editing = only leave edit mode (frame disappears), no new box
- [x] B3. Text box style popup ("Textfeld-Stil"): presets (none, colours) + advanced (any colour, border); background fill
### C. Shapes
- [x] C1. Fix corners/joins of shapes (lines look detached)
- [x] C2. Fill colour for shapes (toolbar + selection)
### D. Laser
- [x] D1. Smooth continuous line instead of dots; red only
### E. Library
- [x] E1. Fix: rename notebook from library
### F. Pictures
- [x] F1. Rotate, transparency slider
- [x] F2. Remove background
- [x] F3. Transparent parts of pictures don't hide ink/other pictures and don't catch clicks
### G. Pages
- [x] G1. New page = same template as previous; dropdown: choose style, add before current
- [x] G2. "+" after last page; keep scrolling down 2 s → page added (circular progress)
- [x] G3. Page menu: rotate page, bookmark (Lesezeichen, with bookmark list), duplicate page
### H. Misc
- [x] H1. Delete icons red everywhere
### V. Verify
- [x] V1. Unit + e2e for each item, packaged build, screenshots, independent review

## Review v1.3 (2026-10-20)
- Sync: open-tab bug fixed; open notebooks upload-only; every 15 min / Ctrl+S / cloud / on exit (progress window); clear status texts.
- Safety: fsync before rename; save at most ~2 s after a change; hourly local snapshots (id-keyed, hard-linked PDFs/images, today hourly + 7 days); restore as copy; crash detection + repair from snapshots; renderer crash → reload.
- Drive: StudyNotes Library/{PDF, Backups, Sync data (do not edit)} with real subfolders; v1.2 flat files migrated; empty folders cleaned up; PDFs and daily .studynotes backups published after sync.
- Text box: auto width, frame/handles only while editing/selected (constant size on screen), first tap elsewhere ends editing, Text box style popup (presets/custom), boxes in PDF export.
- Shapes: geometric outline (round joins, clean closing point), fill colour (tool + selection), in export.
- Laser: red only, one smooth line. Library rename fixed (also when open, case-only renames).
- Pictures: rotate (buttons + handle), transparency, offline AI background removal (ISNet int8, onnxruntime-node in a worker), alpha hit test (clicks through transparent parts), export rotation/opacity verified by pixel test.
- Pages: add page same style, before/after + style menu, "+" at the end and 2-s overscroll with ring, rotate page (content + PDF + export), bookmarks (ribbon, sidebar filter), duplicate, red delete icons.
- Independent review found 10 issues, all fixed with tests: cleanup race with sync (pages newer than notebook.json kept, Recycle Bin, skipped while syncing, notebook marked open before loading); Drive folder cache refreshed every sync (trashed folders); close waits for a fresh sync; snapshots per notebook resilient + id-keyed; damaged pages forgotten in sync state so Drive restores them; damaged notebook.json never uploaded; open list reset after renderer crash; saves frozen during close sync; Settings "Sync now" saves first; bgremove dispose waits for a running job.
- Tests: unit 81/81, e2e run 30/30, v11 24/24, v12 22/22, v13 32/32, real PDF ok; packaged: 30/24/17/24.
- Limits: Drive only tested against a simulated Drive; background removal needs the VC++ 2015–2022 runtime on Windows.

# v1.4 – plan (2026-10-26)

## Now (v1.4)
### Sync & Google
- [x] Built-in Google client (ID + new secret) → one-click "Sign in with Google", no settings to fill in
- [x] Unchanged notebooks: no new save, upload, PDF or backup (root cause: closing/flushing rewrites notebook.json just for the scroll position → move view state to a local, not-synced file)
### Editing
- [x] Group / ungroup selected strokes + pictures (Ctrl+G / Ctrl+Shift+G)
- [x] Rotate text boxes and shapes (rotate handle for any selection)
- [x] Shapes from draw & hold keep pen type, texture and width (fountain, pencil, brush, neon)
- [x] Partial eraser works on shapes (no whole-stroke delete)
- [x] Brush: one smooth stroke instead of many lines
- [x] Custom pen size (slider / number)
- [x] Text: frame disappears right after editing ends (also in text mode); size menu with common sizes + ▲▼ arrows
- [x] Tables: type into a cell (check/fix)
### Pages & look
- [x] Page background cream #FAF6E8 on screen, white in PDF export
- [x] New notebooks start with a cover page (like GoodNotes)
- [x] Add-page: 0.5 s overscroll, also pull with the hand tool / touch; "+" centred; add-page menu stays inside the window
- [x] Endless board: "back to centre" button
### App
- [x] Open PDF files with StudyNotes (Windows "Open with" / double-click)
- [x] Shortcuts work with Russian (any) keyboard layout
- [x] "What's new" window after an update
- [x] graphify knowledge graph for the project (graphify-out/, CLAUDE.md)

## Next (v1.5)
- [ ] Russian interface language (Settings → Language)
- [ ] Quick PDF editor (start screen): open one PDF, fill form fields, signature (draw or picture, saved for later), save/export

## Later (v2)
- [ ] Android app (shared code via Capacitor) + sync with the PC over the same Google Drive library
- [ ] Edit text inside PDFs (digital PDFs first; scans need OCR)

## Review v1.4 (2026-10-26)
- All "Now" items done. Tests: unit 84/84; e2e run 30/30, v11 24/24, v12 22/22, v13 32/32, v14 23/23, real PDFs ok; packaged Linux: run 30/30, v14 23/23.
- Independent review of "open PDF in place" found data-loss risks, all fixed with tests: notes not yet in the file are kept as a library notebook when the PDF was changed elsewhere; write-back never overwrites a PDF changed by another program (writes "… (StudyNotes).pdf" instead); re-opening an open tab never rebuilds it; closing the app warns when a PDF could not be written (busy in Acrobat); protected PDFs are imported instead; Insert PDF blocked for opened files; case-insensitive path match; old working copies cleaned after 60 days.
- Also fixed: notebook.json cache checks size too; What's new handles "1.5.0-beta"; page count clamped.
- Known limits: bookmarks/forms of an opened PDF are not kept in the rewritten file; the file association only adds StudyNotes to "Open with" (Windows keeps your default PDF app).

# v1.5 – plan (2026-10-30)

## From the v1.4 plan
- [ ] Russian interface language (Settings → Language: English / Русский)
- [ ] Fill & sign: start-screen "Fill & sign" opens one PDF; fill form fields; signature (draw or picture), saved for reuse; save / export
- [ ] Licences file (THIRD-PARTY-NOTICES) + "About StudyNotes" window

## New requests
- [ ] Alt + mouse wheel changes size: selected strokes / text / pictures; nothing selected → current tool size (pen, highlighter, eraser, text)
- [ ] Pen side button = eraser while held, back to the previous tool on release (also the pen's eraser end)
- [ ] Ink tip stops "wiggling" while drawing (stable live outline: last segment only re-rendered, no re-smoothing of the whole tail)
- [ ] Partial eraser: the rest of the line stays still while erasing (no re-smoothing / jumping)
- [ ] Partial eraser option "Exact": removes exactly the eraser circle (precise cut), next to the current mode
- [ ] Pen, highlighter, eraser: size control like the text one (number + list + ▲▼); higher maximums
- [ ] Eraser option "Also text & pictures" (off by default; touching removes the whole text box / picture, undoable)

## Publishing
- [ ] GitHub repo: code + description (README with screenshots, download from Releases); client secret kept out of the public code (injected at build)

## Verify
- [ ] Unit + all e2e suites + new v15 e2e with screenshots; independent review; Windows build; packaged e2e

## Review v1.5 (2026-10-30)
- Done: Russian UI (DOM translation, user content excluded), Fill & sign (form fields, signatures, date/✓, flattened values), calmer live ink (last:true live, no live end taper, pressure smoothing), eraser keeps points / exact circle / text & pictures, pen button erases while held, Alt+wheel, size fields with higher maximums, About + licences, real covers in the library with fitted titles.
- Review (8 findings) fixed: page rotation keeps eraser cuts; cuts stored as a list (no erased ink returns); near misses change nothing; cover/folder names never translated; form-fill errors shown; placing wins over panning; Alt+wheel never shrinks beyond the list; Russian clear-page text.
- Tests: unit 90/90; e2e run 30/30, v11 24/24, v12 22/22, v13 32/32, v14 23/23, v15 17/17.
- GitHub: source pushed to vlmelnik/studynotes (secret kept out), README with framed neutral screenshots, release workflow (needs repo secrets for the built-in Google client).
