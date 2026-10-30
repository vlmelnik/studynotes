# StudyNotes – user guide

## Install

1. Run `StudyNotes-Setup-1.5.0.exe`. Updating from an older version: just install over it, your notes stay where they are.
2. Windows SmartScreen may say "Windows protected your PC", because the app isn't code-signed. Click **More info → Run anyway**.
3. No installer wanted? Unzip `StudyNotes-1.5.0-win-x64.zip` anywhere and start `StudyNotes.exe`.

### Graphics tablet (Wacom, XP-Pen, Huion)

Pen pressure only works when the driver sends Windows Ink:

- **Wacom:** Wacom Tablet Properties → Mapping → tick **Use Windows Ink**
- **XP-Pen / Huion:** driver settings → enable **Windows Ink**

Pen buttons: the eraser end of the pen and the side (barrel) button both erase while you hold them; let go and you write again.

## Your notes and sync

- Notes are saved automatically, as you write.
- They are stored as plain folders. The default location is `Documents\StudyNotes`.
- To sync between PCs: use the built-in **Google Drive sync** (see "New in 1.2"), or open **Settings (gear icon) → Change…** and pick a folder inside OneDrive or Dropbox.
- Don't edit the same notebook on two PCs at the same time. If the sync client creates conflict copies, StudyNotes leaves them alone.
- Deleted notebooks go to the Recycle Bin.

Folder layout, one folder per notebook:

```
<Library>\<Folder>\<Notebook>\notebook.json   page list, title, last position
                               source.pdf      your imported PDF (never modified)
                               pages\*.json    ink and text per page
                               text.json       PDF text for search
                               cover.png
```

## Features

- **Library:**
  - Folders and notebooks with covers
  - Rename, duplicate, move (also by drag & drop onto a folder), delete
  - Drag PDFs from Explorer into the window to import them
- **PDF:**
  - Only visible pages are rendered; the rest load on demand, so huge PDFs stay fast
  - Pages get a quick preview while you scroll fast, then turn sharp
  - Zoom up to 600% with Ctrl + mouse wheel or a touchpad pinch
- **Paper notebooks:**
  - Blank, lined, narrow ruled, grid or dotted paper
  - A4, A5, Letter or A4 landscape
  - You can insert paper pages anywhere in a PDF too
- **Tools:**
  - Pen (ballpoint or fountain, with pressure) and highlighter (straight-line mode)
  - Eraser: partial or whole stroke, optionally highlighter only
  - Lasso: select, then move, resize, recolor, cut, copy, paste, duplicate or delete
  - Shapes: line, arrow, rectangle, ellipse, triangle
  - **Draw & hold:** keep the pen still at the end of a stroke to snap it into a clean line, rectangle, triangle or circle
  - Text boxes (Unicode, so Cyrillic and umlauts work)
- **Pages:**
  - Thumbnail sidebar
  - Insert, duplicate, delete, reorder by drag & drop, go to page
- **Search:**
  - Ctrl+F searches the PDF text and your typed notes, then highlights the hit on the page
  - The library search box searches across all notebooks
  - Scanned PDFs without a text layer are not searchable (no OCR)
- **Export:**
  - Whole notebook, current page or a page range, to PDF
  - Ink stays vector, so it's sharp at any zoom, and the original PDF pages are kept intact
- **Undo / redo** for everything, including page changes.
- **Tabs** for several open notebooks.

## Shortcuts

| Keys | Action |
|---|---|
| V | Select tool |
| P / H / E | Pen / Highlighter / Eraser |
| L / S / T | Lasso / Shapes / Text |
| K | Laser pointer |
| Space + drag, middle mouse | Pan |
| Ctrl + wheel, Ctrl + / − | Zoom |
| Ctrl + 0 | Fit width |
| Ctrl + Z / Ctrl + Y | Undo / Redo |
| Ctrl + C / X / V / D, Del | Copy / Cut / Paste / Duplicate / Delete selection |
| Ctrl + F | Search in notebook |
| Ctrl + B | Show / hide page thumbnails |
| PgUp / PgDn | Previous / next page |
| Ctrl + W, Ctrl + Tab | Close tab, next tab |
| Alt + wheel | Resize the selection, or the size of the current tool |
| Ctrl + G / Ctrl + Shift + G | Group / ungroup |
| Pen side button (hold) | Erase, then back to the pen |

By default the mouse draws too. If you'd rather scroll with the mouse and only write with the pen, turn off **Settings → Mouse can draw**.
