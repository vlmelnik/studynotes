# `window.api`

The renderer talks to the Electron main process only through `window.api`.
It is defined in `src/main/preload.js`. Each method forwards to an
`ipcMain.handle` handler registered in `src/main/main.js`. Every method returns a
Promise unless noted.

`test/unit/main/api-doc.test.js` checks that this file lists exactly the
methods that `preload.js` exposes. When you add, rename or remove a method
in `preload.js`, change the tables here as well.

Paths named `rel` are library-relative paths with `/` separators, for
example `Physics/Mechanics`. An empty string is the library root.

The last column is the plan for the Android 2.0 port:

- `needed`: the editor cannot open, edit, save, export or sync a notebook without it.
- `later`: useful, but not required for 2.0.
- `desktop-only`: depends on Windows, a desktop window, local file paths or a desktop program; not planned for Android.

Two handlers exist only when the app runs with `STUDYNOTES_TEST` set
(automated tests): `exportTo`, `testExportBackup`, `testImportBackup`.

## App & settings

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `info` | none | `{ libraryRoot, settings, version, platform, test }` | Returns the library folder, the saved settings, the app version and the platform. | needed |
| `setSettings` | `settings` (partial object) | the merged settings object | Merges the given keys into the saved settings and writes the config file. | needed |
| `setTheme` | `pref` (`'dark'`, `'system'` or other = light) | nothing | Sets the native window theme and its background colour. | needed |
| `chooseLibrary` | none | new library path, or `null` if cancelled | Opens a folder dialog and switches the library to the chosen folder. | desktop-only |
| `showLibraryFolder` | none | string (empty on success, else an error message) | Opens the library folder in the system file manager. | desktop-only |
| `closeReady` | none | nothing | Called when the editor has saved everything: writes pending external PDFs, ends the session and closes the window. | desktop-only |
| `closeAck` | none | nothing | Tells the main process that the editor received the before-close event, so it does not force-close after 4 seconds. | desktop-only |
| `notices` | none | string | Returns the text of the third-party notices file (empty string if missing). | later |
| `startupReport` | none | `{ crashed, repaired, unrepairable }` or `null` | Returns once the result of the crash check done at start-up, then forgets it. | later |
| `exportSettings` | `settings` | file path, or `null` if cancelled | Asks for a file and writes the settings to it as JSON. | later |
| `importSettings` | none | the merged settings, or `null` if cancelled | Asks for a settings file, merges it into the saved settings. | later |

## Library (notebooks, folders)

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `list` | `rel` | `{ path, folders, notebooks }` | Lists the sub-folders and notebooks of one folder. | needed |
| `allFolders` | none | list of folders | Lists all folders of the library (for the "move to" picker). | needed |
| `createFolder` | `parentRel`, `name` | `rel` of the new folder | Creates a folder with a unique name under the parent. | needed |
| `createNotebook` | `parentRel`, `opts` (title, paper, size, cover colour, page count, kind, landscape, ...) | `rel` of the new notebook | Creates a notebook folder with its `notebook.json`. | needed |
| `importDialog` | `parentRel` | list of new notebook `rel`s (empty if cancelled) | Opens a PDF picker (multi-select) and imports each PDF as a notebook. | needed |
| `importFiles` | `parentRel`, `files` (absolute paths) | list of new notebook `rel`s | Imports the given PDF files (drag and drop) as notebooks; other file types are skipped. | later |
| `readNotebook` | `rel` | notebook object | Reads and migrates `notebook.json` and attaches the saved view state. | needed |
| `writeNotebook` | `rel`, `notebook` | modified time (number) | Writes `notebook.json` and schedules a write-back if the notebook is an external PDF. | needed |
| `rename` | `rel`, `name` | new `rel` | Renames a folder, or a notebook (title and directory). | needed |
| `move` | `rel`, `destFolderRel` | new `rel` | Moves a folder or notebook into another folder. | needed |
| `duplicate` | `rel` | `rel` of the copy | Copies a notebook next to the original. | needed |
| `trash` | `rel` | nothing | Moves a folder or notebook to the Recycle Bin (deletes it if that fails); refuses the library root. | needed |
| `search` | `query` | list of `{ path, title, hits, titleMatch }` | Searches titles, PDF text and typed text of all notebooks. | needed |

## Pages & assets

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `readPages` | `rel` | object: page id to page data | Reads every stored page file of a notebook. | needed |
| `writePage` | `rel`, `pageId`, `data` | nothing | Writes one page file (deletes it if the page is empty) and schedules a write-back for external PDFs. | needed |
| `cleanupPages` | `rel` | list of removed page ids | Removes page files that `notebook.json` no longer lists; returns an empty list while a sync is running. | later |
| `readText` | `rel`, `src` | text data or `null` | Reads the extracted PDF text of one source (used by search). | needed |
| `writeText` | `rel`, `data`, `src` | nothing | Stores the extracted PDF text of one source. | needed |
| `writeAsset` | `rel`, `bytes`, `ext` | asset name, e.g. `assets/<hash>.png` | Stores an image under a content hash (same bytes give the same file). | needed |
| `writeCover` | `rel`, `bytes` (PNG) | nothing | Writes `cover.png` of a notebook. | needed |
| `addSourceDialog` | `rel` | `{ id, file, name }` or `null` if cancelled | Opens a PDF picker and copies the PDF into the notebook as an extra source; refuses external PDFs. | later |
| `addSourceFile` | `rel`, `file` (absolute path) | `{ id, file, name }` | Copies the given PDF into the notebook as an extra source; refuses external PDFs. | later |
| `pickImages` | none | list of `{ name, bytes }` (empty if cancelled) | Opens an image picker (multi-select) and returns the file contents. | needed |
| `readImageFile` | `file` (absolute path) | file bytes | Reads an image file from disk; throws if the extension is not an image type. | later |
| `removeBackground` | `bytes` | image bytes | Removes the background of an image with an offline model run in a worker thread. | later |

## Export

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `exportPdf` | `rel`, `pageIds` (or `null` for all), `inline` (optional: extension pictures by key, docs/EXTENSIONS.md) | saved file path, or `null` if cancelled | Asks where to save, builds the PDF and shows it in the file manager. | needed |
| `exportTo` | `rel`, `pageIds`, `outFile`, `inline` (optional) | `outFile` | Builds the PDF at a given path without a dialog; registered only in test mode. | desktop-only |
| `send` | `rel`, `pageIds`, `via` (`'mail'` or other = Telegram), `label` | `{ file, method, ... }` | Exports a PDF to a temp folder and opens the mail client or Telegram with it. | desktop-only |

## Sync & cloud (Drive)

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `cloudInfo` | none | `{ configured, ownClient, account, status, auto }` | Returns the sync set-up, the signed-in account and the current status. | needed |
| `cloudConfigure` | `cfg` (Drive settings) | same as `cloudInfo` | Saves the Drive settings and re-arms the sync timer. | needed |
| `cloudSignIn` | none | `{ account, info }` | Signs in to Google through the browser. | needed |
| `cloudSignOut` | none | same as `cloudInfo` | Signs out, deletes the stored token and the sync state. | needed |
| `cloudSync` | `opts` | sync result | Runs a sync; a call during a running sync queues one more run. | needed |
| `cloudOpenNotebooks` | `list` (array of `rel`) | nothing | Tells the sync which notebooks are open in the editor. | needed |

## Recognition (OCR, handwriting, spelling)

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `ocrStatus` | none | `{ installed, langs, workers, files }` | Reports which recognition languages are available. | later |
| `ocrRecognize` | `image`, `langs` | recognition result (lines and words) | Reads text from an image with the built-in recognizer. | later |
| `ocrGoogle` | `images`, `lang` | recognition result | Reads text from images with Google Drive's text recognition (one call at a time). | later |
| `readOcr` | `rel`, `src` | stored recognition data or `null` | Reads the saved text recognition result of one source. | later |
| `writeOcr` | `rel`, `data`, `src` | nothing | Stores the text recognition result of one source. | later |
| `ocrSpell` | `lines` | corrected lines | Checks and corrects recognized lines in a separate process that ends after 2 idle minutes. | later |
| `inkRecognize` | `strokes`, `recognizer` | `{ words, text }` | Recognizes handwriting with the Windows recognizer through PowerShell. | desktop-only |
| `inkRecognizers` | none | list of recognizer names | Lists the installed Windows handwriting recognizers. | desktop-only |

## Backup

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `exportBackup` | none | `{ file, ... }` or `null` if cancelled | Asks for a file and writes the whole library to a `.studynotes` archive. | later |
| `importBackup` | none | `{ rel, files }` or `null` if cancelled | Asks for a `.studynotes` or `.zip` archive and unpacks it into a new `Imported <date>` folder. | later |
| `testExportBackup` | `file` | export result | Writes the library archive to a given path; registered only in test mode. | desktop-only |
| `testImportBackup` | `file` | `{ rel, files }` | Imports an archive from a given path; registered only in test mode. | desktop-only |
| `backupSnapshotNow` | none | `{ saved, error? }` | Takes a local snapshot of changed notebooks now (one at a time). | later |
| `backupList` | `rel` | list of snapshots | Lists the local snapshots of one notebook. | later |
| `backupRestore` | `rel`, `stamp` | `rel` of the restored copy | Restores a snapshot as a new notebook next to the original; never overwrites. | later |
| `backupOpenFolder` | none | string (empty on success, else an error message) | Opens the local backup folder in the file manager. | desktop-only |

## External PDFs

PDFs opened with "Open with" are not in the library. The notes are written
back into the PDF file itself.

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `extPending` | none | list of file paths | Returns the PDF paths given at start-up and marks the renderer as ready. | desktop-only |
| `extOpen` | `file` (absolute path) | `{ rel }` | Opens an external PDF as a hidden notebook under `.external/`. | desktop-only |
| `extPath` | `rel` | file path or `null` | Returns the original file path of an external notebook. | desktop-only |
| `extWrite` | `rel` | write-back result | Writes the notes of one external notebook into its PDF file. | desktop-only |
| `extWriteAll` | none | list of `{ path, message }` for failed writes | Writes all pending external notebooks. | desktop-only |
| `extPickFill` | none | file path or `null` | Opens a PDF picker for the fill-and-sign flow. | desktop-only |

## Signatures & forms

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `formFields` | `rel` | list of form fields | Reads the form fields of the main PDF of a notebook (empty if none). | later |
| `sigList` | none | list of `{ id, bytes }` | Lists the saved signature images. | later |
| `sigSave` | `bytes` (PNG) | id string | Saves a signature image. | later |
| `sigRemove` | `id` | nothing | Deletes a saved signature. | later |

## Other

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `screenPixel` | `x`, `y` | colour as `#rrggbb`, or `null` | Captures the window and returns the colour of one pixel (eyedropper). | desktop-only |
| `clipboardFiles` | none | list of `{ kind, path, name, bytes? }` | Returns image and PDF files copied in the file manager. | desktop-only |
| `copyToClipboard` | `{ png?, rect?, text, html }` | `true` when a picture was written | Writes a copy to the system clipboard: picture (given PNG bytes or a screenshot of `rect`), text and HTML. | needed |
| `pathForFile` | `file` (a dropped `File`) | absolute path (synchronous) | Returns the path of a dropped file; runs in the preload script, no handler. | desktop-only |

## Events (main process to renderer)

Each method registers a listener and returns nothing. They are plain
`ipcRenderer.on` listeners, not Promise calls.

| Method | Arguments | Result | What it does | Android 2.0 |
| --- | --- | --- | --- | --- |
| `onBeforeClose` | `fn()` | nothing | Called when the window is about to close, so the editor can save. | desktop-only |
| `onOpenFile` | `fn(file)` | nothing | Called with the path of a PDF opened with the app while it is running. | desktop-only |
| `onExtConflict` | `fn({ rel, path })` | nothing | Called when an external PDF changed on disk and was not overwritten. | desktop-only |
| `onExtError` | `fn({ rel, message })` | nothing | Called when writing an external PDF failed; the write is retried later. | desktop-only |
| `onCloudStatus` | `fn(status)` | nothing | Called whenever the sync status changes. | needed |
| `onCloudRequestSync` | `fn()` | nothing | Called by the 15-minute timer: the editor should save everything and then call `cloudSync`. | needed |
| `onLibraryChanged` | `fn()` | nothing | Called when a sync changed files in the library. | needed |
