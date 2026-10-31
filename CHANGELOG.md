# Changelog

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

