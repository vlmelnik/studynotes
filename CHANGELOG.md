# Changelog

## 1.7.0

**Fixes (re-release, 14 Nov 2026)**
- Dictionary check keeps formula symbols and variables (tf, lc, "поле B равно").
- "Make text editable" replaces only the letters: figures and the PDF around the text stay the original.
- One recognition per page at a time; red / orange text gets a matching font; very large areas give a clear message.
- Underline: no longer confused with a ruled line at the edge of the selection.
- "Read better with Google": calls no longer disturb each other; the spelling check can't hold up recognition.
- Search lists a word made editable once.

**Scans and PDFs: make printed text editable**
- Lasso tool → option "Text area": draw a rectangle around printed text on a scan, photo or PDF page; or use the new page button in the toolbar (also in the page menu) for the whole page. The normal lasso stays as it was.
- Text is recognised offline (Tesseract, German first so umlauts are right, English, Russian; very large or small text is rescaled for a second pass); the language data (7 MB) comes with the app.
- Photos: uneven light, shadows and glare are evened out before reading; tilted text (crooked scan or photo) is straightened for reading and the text boxes get the same tilt; headings are read once more at their best size.
- One typeface for the whole text, matched by drawing every font of the app (regular first, then bold / italic of the best few) and comparing them with the scan; the classic office fonts win ties; Cyrillic text only gets fonts with Cyrillic letters; bold and italic only where clearly different from the other lines; size and colour from the scan.
- Light text on a dark background (dark-mode screenshots, menus, signs) is read on the negative; colours stay light.
- A German / English page is read again without Russian (and the other way round) when stray look-alike letters show up; wide gaps split a line into separate boxes (columns, prices); very short or oversized "lines" (logos, keyboard, handwriting in a photo) need a high confidence.
- Photos taken at a slant: every line gets its own tilt.

**Match the document**
- Edited text looks like the scan around it: as soft as the original (the blur is measured from the letters' edges, independent of the font). On by itself for recognised text; a new button in the text bar and the selection bar turns it on or off for any text box (typed text takes the look of the nearest scanned text). Sharp while typing. The PDF export draws it soft too (outlines, the real text stays searchable and copyable).

**Perspective, light, bold**
- Photos taken at a slant: the size change along the lines and the letters' lean are measured for the whole page (one flat sheet, robust against single odd lines), against the chosen font drawn flat; with "Match the document" the text box is shown in that perspective (CSS matrix3d) and exported so (each letter placed by the perspective). Straight while typing.
- Glare and shadow: the ink colour along each line is measured and the text is filled with it (gradient); per letter in the PDF.
- Blur per line (a part of the page out of focus is softer).
- Bold: the real strokes are compared with the font drawn at the same size and blur, relative to the other lines; headings much larger than the text need less – semibold headings come out bold.
- Dark labels next to light paper (price tags): the original picture is read too and the lines found only there are added.

**Handwriting in photos and scans**
- Handwritten pages (letters standing unevenly, size jumping, a less sure reading) become typed text in the closest of 5 handwriting fonts (Neucha, Caveat, Pangolin, Marck Script, Bad Script – all with Cyrillic), straight and sharp; lines read less surely are kept for handwriting.
- "Read better with Google" (in the message after recognising, only for handwriting or unsure readings): the line pictures go to the user's Google Drive as a temporary Google Doc with text recognition, the text replaces the boxes' text (one undo step), the doc is deleted right away.

**More fonts**
- 14 widely used fonts plus 4 handwriting fonts (SIL OFL / Apache): Cambria style (Caladea), Georgia style (Gelasio), Garamond style (EB Garamond), Open Sans, Roboto, Inter, Lato, Source Sans 3, Fira Sans, Montserrat, Noto Sans, Noto Serif, PT Sans, PT Serif – each with bold and italic, ordered by how common they are.
- The paper is painted back where the text was (with the grain of the surrounding paper), as a picture over that area; the lines become normal text boxes on top. One undo step.

**Text recognition built in; "Editable scans" is an add-on**
- The language data (German, English, Russian, 7 MB) comes with the app – no download any more (data downloaded by early 1.7 builds is removed).
- "Make text editable" (scans/photos → editable text boxes in a matching look) is the add-on "Editable scans": turned on once – asked at its first use, or Settings → Add-ons.

**Reading and highlighting (contribution #1 by Pedro Falbo, integrated)**
- PDF letters drawn as smooth vector shapes (Settings → "Round PDF letters", on by default); pages sit on whole screen pixels and are shown 1:1 (also at 125 / 150 / 200 % Windows scaling); redrawn at the exact screen size after zooming; at high zoom the visible part is rendered again at full resolution.
- Text selection keeps the columns of a page apart; the page's text is loaded in advance; I-beam cursor over PDF text.
- Highlighter: round tip option, multiply blending (black text stays black), a free marker by default (Shift = straight line; "Always straight" and "Snap to text" are options; saved settings are moved over once).
- Shift + wheel scrolls fast. The exact page, scroll position and zoom come back when switching notebooks.
- Searchable scans – standard now, like in any PDF reader: when a PDF is opened, its scanned pages (no printed text) are recognised in the background by themselves (Settings key autoOcr = false turns it off; Search → "Recognize text (OCR)" runs / stops it by hand). It recognises scanned PDF pages with the text recognition add-on (German, English, Russian; the contribution used a second, bundled engine for Portuguese/English – adapted) and keeps the text as an invisible layer (ocr.json): search, search highlights, text selection and the highlighter work on the scan; the page itself is not changed (unlike "Make text editable").

**Handwriting → text**
- Select handwriting → "Copy as text" or "To text" (a text box in the ink colour). Uses the handwriting recognizer built into Windows (offline); Settings → Add-ons shows which languages Windows can read.
- Settings → "Export handwriting as text": the exported PDF contains the recognised handwriting as invisible, searchable and copyable text.

**Eyedropper**
- Eyedropper button next to the colours (tool options, selection bar, "More colours"): click anywhere on the page to take that colour. Shortcut: I, then click; or hold Alt and click. On ink it takes the ink's exact colour. No separate tool.

**Recognition: paragraphs, underline, logos**
- Lines that belong together become one text box: a paragraph with its line breaks and the scan's line spacing, a centred or right-aligned title of several lines. Same font, size and colour, evenly spaced and aligned; lines in perspective, tilted or handwritten stay one box per line.
- Underlined words and lines are recognised (a thin line of ink under the letters, not descenders); the scan's underline is cleaned away.
- Logos stay as they are: text next to a solid sign (a logo's mark) is not turned into a text box.
- "Combine": select several text boxes → one box (side by side → one line, one under the other → lines; bold, size, font and colour kept per part). Also in the text toolbar.
- "Read better with Google": Google's export starts with a separator line "________________" – it was taken as the text. Now the separator is ignored and of several lines the one most like ours is used.

**Recognition: dictionary check, bold words**
- Recognised text is checked against dictionaries (offline: Russian and English Hunspell, a German word list): a Russian word read with Latin look-alike letters ("Tak" → "Так"), mixed-up similar letters and a lost space after a short preposition ("сконтакторами" → "с контакторами") are corrected; when two real words fit equally well, nothing is changed; terms and acronyms stay.
- Single bold words inside a regular line become bold on their own (compared with the line's other words).

**Settings: Add-ons tab**
- Settings have two tabs, General and Add-ons. Each add-on has a real switch and its own settings: Searchable scans (on by default), Editable scans, Handwriting to text (always on; read with Windows offline or Google online with the user's Google account).
- Long texts in Settings wrap instead of running off the side; the window is wider.

**Fixes**
- PDF text selection works by whole lines, like a text editor: a drag down selects the full lines in between (not pairs of words on the left); ending next to a line's end, left of its start or between two lines no longer jumps; PDFs that write every word separately join into lines first; table rows are selected across (cells separated by a tab when copied), real two-column articles still column by column.
- Dragging on highlighted PDF text selects the text instead of a strange box with handles; a click without moving still selects the highlight.
- Double-click on a text box edits it with the lasso too (right after "Text area"); then a click into the text puts the cursor there (it used to end editing).
- Lasso: a text box can be dragged by its frame; a selected box moves when grabbed at its edge, its blue handles change its width.
- "Text area" button: the icon no longer overlaps its label.
- Windows handwriting recognizer: the "Unable to find type [Windows.Foundation.Point]" error on some PCs is fixed; if Windows still can't read handwriting, Google can be chosen.
- Library → notebook (and switching tabs) keeps the page and zoom instead of jumping to the cover.
- Objects dragged onto the next page no longer disappear behind it: they stay in front while dragging and move to that page (on top of what is there), one undo step.

## 1.6.1

**Ink**
- New line engine: a line is built from round pieces along the pen's path, so letters stay exactly as written (no wobble while writing, no change when the pen lifts), sharp turns and small curls stay clean (no triangles or spikes), and lines no longer end in a thin tail with a dot.
- Pen input filter no longer depends on the tablet's timing (uneven timing used to bend lines); pressure feels more even, light touches give a usable line.
- Pencil: fine, soft graphite grain (also while drawing).
- Pen eraser / "Erase" side button: also works when the driver reports no pressure for the eraser or sends it as a new pointer.

**Keys & tablet**
- Ctrl+Z / Ctrl+Y also for keys sent by tablet drivers with a Russian layout.
- Settings → Graphics tablet: learn which key a tablet button sends for Undo / Redo (for drivers whose Ctrl+Z arrives as something else).
- Settings → Graphics tablet → Pen check: shows what the pen sends and copies a report.

**Text**
- The selection frame always fits the real text height (after changing the width, pasting, other fonts).
- The side handles can be grabbed along the whole side of the box.
- Mouse wheel over a size field changes the size.
- Settings → "Scribbling also erases text" (off by default).

**Notebooks**
- A notebook in a background tab now keeps its page and zoom when the app closes.

## 1.6

**Ink**
- The line no longer shakes or deforms while you write: pen input is filtered (one-euro filter) and drawn with the same settings as the finished line. Small loops and dots come out right (a tap with the brush now leaves a dot).
- Settings → **Smooth my handwriting**: evens out tremor and curves, keeps your own letters.
- **Scribble to erase**: scribble back and forth over handwriting to erase it (on/off in Settings).
- Pen side button: works with pens without pressure and with drivers that send it as a right click.

**PDF**
- Select printed PDF text with the select tool → Copy, Highlight, Underline. The highlighter snaps to text lines (option "Snap to text").
- Form fields of every PDF can be clicked and typed into directly.

**Text**
- Paragraphs are kept when a word gets another colour or size; the style goes exactly to the selected characters.
- Double-click selects the word under the pointer.
- Pasting works with every tool (also after editing a text box); pasted text lies on top, pictures on top of the other pictures (below the ink).
- Long text boxes get their real height (frame and handles cover all the text).
- **Format painter** in the text bar.

**Pages & dialogs**
- Toolbar button: delete the current page (Ctrl+Z restores).
- Fixed: Cancel buttons (e.g. "Clear page") did nothing.
- Shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+C …) work with every keyboard layout: German QWERTZ uses the key labelled Z, Russian the key in the Z place.

## 1.5

**Russian interface** – Settings → Language → Русский. Switches at once, no restart.

**Fill & sign** – button in the library: open a PDF form, type into its fields, tick boxes, add your signature (drawn or from a picture, saved for next time), a date or a ✓, then **Save PDF**. The values are written into the form fields of the file.

**Calmer ink and a better eraser**
- The tip of the line no longer wiggles while you write; nothing jumps when you lift the pen.
- While erasing, the rest of the line stays exactly as it was.
- Partial eraser option **Exact circle**: removes exactly the circle of the eraser.
- Eraser option **Text & pictures too**: also removes text boxes and pictures it touches (undoable).

**Pen and sizes**
- Hold the **side button of the pen** to erase – let go and you write again (also in the middle of a line).
- **Alt + mouse wheel**: resizes what is selected; with nothing selected it changes the pen / highlighter / eraser / text size.
- Pen, highlighter and eraser have the same size field as text (type a number, ▾ list, ▲▼) with higher maximums (pen 60 pt, highlighter 120 pt, eraser 300 px).

**About & licences** – Settings → About StudyNotes shows the licences of everything bundled.

## 1.4

**Start faster**
- **New notebook:** pick a **cover** (Simple / Solid) and a **paper** (Essentials, Writing papers, Planner), paper colour (cream, white, dark), size and portrait/landscape – like GoodNotes.
- Pages are **cream (#FAF6E8)** on screen and **white** in exported PDFs.
- **Add page → More templates…** opens the same picker. The add-page menu always fits in the window.
- Keep scrolling (or pull with the hand) past the last page for **half a second** to add a page.

**Open any PDF with StudyNotes**
- Right-click a PDF → **Open with → StudyNotes** (or double-click if you make StudyNotes the default).
- Your notes are written **into that PDF file** – every PDF reader shows them – shortly after you write, on **Ctrl+S**, when you close the tab and when you close the app.
- Open it again in StudyNotes and everything is still editable. These files are not added to your library and not synced.
- If the PDF is open in another program (e.g. Acrobat), saving waits until you close it there.

**Editing**
- **Group** strokes, text and pictures (Ctrl+G, Ctrl+Shift+G to ungroup). **Rotate** text, shapes and groups with the round handle.
- Text: size list with common sizes + ▲▼; the frame disappears when you stop typing. Tables: click a cell and type.
- Pens: **custom sizes** (… button). Shapes (draw & hold) keep the pen look and width. The brush paints one smooth stroke. The eraser can erase part of a shape.
- Endless board: **back to centre** button. Shortcuts work with the Russian keyboard layout.
- A **What's new** window shows once after an update (also in Settings).

**Sync**
- **Sign in with Google** in one click – nothing to set up.
- Just opening, scrolling and closing a notebook changes nothing, so nothing is uploaded or re-exported.

## 1.3

**Your notes are safe**
- Saved at most ~2 seconds after every change, and written so that a power cut can't leave a half-written file.
- **Backups:** every hour, notebooks that changed are copied to the folder next to your library (`Documents\StudyNotes Backups`). Kept: every hour of today, one per day for 7 days.
- **Restore:** right-click a notebook → **Restore from backup…**. It is added as a copy; nothing is overwritten.
- **After a crash or power cut** StudyNotes checks every notebook at the next start, repairs damaged files from the backups and tells you.

**Google Drive sync**
- Every 15 minutes, with the cloud button, with **Ctrl+S**, and **when you close the app** (a window shows the progress; "Close without syncing" skips it).
- Open notebooks are saved and uploaded too. Changes from your other PC arrive when you close the notebook.
- In Drive, "StudyNotes Library" now has three folders:
  - **PDF** – every notebook as a PDF, to look at on your phone or any PC
  - **Backups** – one `.studynotes` file per notebook and day (7 days); import it with Settings → Import notes
  - **Sync data (do not edit)** – the working files of the sync
- Status ("Synced 10:59") next to the cloud button in the library.

**Text boxes (like GoodNotes)**
- A new box starts thin and grows while you type. Frame and small blue handles only while you edit or select it.
- Tap elsewhere: editing ends and the frame disappears; tap again for a new box.
- **Text box style** in the text bar: presets (colours, rounded) or Custom (any fill, border, corners).

**Shapes:** corners join cleanly; **Fill** for shapes (shape options, or select a shape → Fill).

**Pictures** (select one with the select tool)
- Rotate: ↺ / ↻ buttons, or drag the round handle under the picture (snaps to 0°/90°/180°/270°, Shift = 15° steps).
- Transparency slider.
- **Remove background** – works offline, takes a few seconds. Ctrl+Z brings the original back. (Needs the Microsoft Visual C++ runtime, which almost every Windows PC has; if it's missing, the message tells you.)
- Transparent parts of a picture don't block your writing: clicks go through to what is behind.

**Pages**
- **Add page** (toolbar) adds a page in the same style after the current one. The small arrow next to it: choose a style, before or after.
- At the end of the notebook: **+** button, or just keep scrolling down for 2 seconds (a ring fills up).
- Page menu (right-click a thumbnail, or ⋯ → This page): **Rotate**, **Bookmark**, **Duplicate**, add page before.
- Bookmarked pages have a red ribbon; the sidebar's **Bookmarks** filter shows only them.

**Laser pointer:** red only, one smooth glowing line.

**Renaming** a notebook from the library works again (also while it is open).

## 1.2

**Look**
- Blue toolbar with the tools in the middle. Each tool's options (pen types, sizes, colours) float in a dark strip below it.
- The zoom % appears bottom-right while you zoom, then disappears.
- **Dark mode:** moon button in the library, or Settings → Appearance (Light / Dark / System). Only the interface goes dark; pages stay white.

**Text**
- GoodNotes-style text box: thin frame and blue side handles to change the width. A dark text bar appears under the box.
- Text bar: colour, size, font, **B** *I* U, alignment, bullet list, box style (none / border / filled), cut, duplicate, delete, more.
- **Select some words** → the change applies only to them. **No words selected** (or the box selected with the select tool) → it applies to the whole box.
- Any size: type a number (e.g. 37) into the size field and press Enter, or pick one from the list.

**Objects**
- **Bring to front / Send to back** now works for pictures, tables and text boxes, also over your handwriting.

**Laser pointer** (key **K**)
- Glowing dot plus a fading trail, for presenting. Nothing is saved.
- Options: colour, dot or trail.

**Google Drive sync** (built in)
- Settings → Google Drive sync → **Sign in with Google**.
- Syncs your whole library both ways (since 1.3: every 15 minutes, Ctrl+S, cloud button, when closing).
- StudyNotes can only see the files it created in your Drive, nothing else.
- A notebook that is open is synced after you close it.
- Edited on two PCs before syncing? Both versions are kept ("conflict" copy), nothing is lost.
- **One-time setup (about 15 min):** Google requires your own free "client ID":
  1. Open console.cloud.google.com and create a project ("StudyNotes").
  2. APIs & Services → Library → **Google Drive API** → Enable.
  3. OAuth consent screen → External → app name + your e-mail → add yourself as a **Test user**.
  4. Credentials → Create credentials → OAuth client ID → type **Desktop app**.
  5. Paste the Client ID and Client secret into Settings → Google Drive sync → Sign in.
  6. Recommended: OAuth consent screen → **Publish app**. Otherwise Google signs you out every 7 days.
- The steps are also in the app: Settings → "How to get a client ID".

## 1.1

- **Paste anything (Ctrl+V):**
  - Pictures and screenshots, text, and tables from Excel / Word / web pages (they become editable tables)
  - Pictures and PDFs copied in Explorer
  - After pasting, the pasted object is selected so you can move it right away
- **Select tool** (arrow, left of the pen, key **V**):
  - Click any object to select it, drag to move, corners to resize
  - Change colour, font, size; double-click text or a table cell to edit
- **Insert a PDF into a notebook:** all pages or a range like `2-5, 9`, at the start, the end or after the current page
- **Pictures and tables:** Insert menu, or drag image files into the window
- **Text:** six fonts, **bold**, *italic*, underline, per word or per box
- **Pens:** ballpoint, fountain, pencil, marker, brush, neon; bigger palette, neon colours, custom colours
- **Favourite and recent pens:** click ☆ to save the current pen; recent pens appear automatically
- **Shapes:**
  - line, arrow, double arrow, rectangle, rounded rectangle, ellipse, triangles, diamond, pentagon, hexagon, star, parallelogram, speech bubble, cross, cylinder, coordinate axes
  - Draw & hold now also recognises rounded rectangles and draws smoother shapes
- **Page templates:** college ruled, 5/10 mm grid, engineering, Cornell notes, music staff, isometric, to-do, hexagon and more
- **Endless board:** New → Endless board. A whiteboard that grows in every direction; export crops to your content
- **Send:** page or notebook as PDF by e-mail (Outlook / Thunderbird) or Telegram (Telegram opens, the PDF is on the clipboard – press Ctrl+V in the chat)
- **Backup:** Settings → export/import settings, back up all notes into one `.studynotes` file, import it again (goes into a new folder, nothing is overwritten). Files from older versions always open in newer ones
- **Smoother zoom:** animated, anchored at the mouse

