# Graph Report - studynotes  (2026-11-08)

## Corpus Check
- 87 files · ~153,473 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 8, .css 1)

## Summary
- 1423 nodes · 3544 edges · 84 communities (63 shown, 21 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 250 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Viewer
- DriveRemote
- main/main.js
- editor.js
- editor-panels.js
- App
- inkrender.js
- Library
- showMenu
- .onMove
- export.js
- bgremove.js
- with
- ref_os
- ref_fs
- editor-objects.js
- with
- Plan
- toast
- dependencies
- tools.js
- localbackup.js
- FakeDriveApi
- inkrender.js
- Editor
- scan-edit.js
- ref_fs
- CloudSync
- geometry.js
- v11.test.js
- FakeRemote
- i18n.js
- build
- .onKey
- v13.js
- sync.test.js
- Laser
- library-view.js
- PageView
- cleanup-branches.yml
- scripts
- FakeAuth
- Changelog
- Thumbs
- v14.js
- external.js
- Lessons
- PdfDoc
- StudyNotes – notes for Claude
- FakeRemote
- screenshots.js
- ui.js
- pen-filter.js
- v15.js
- Now (v1.4)
- StudyNotes – GoodNotes-style desktop app for Windows
- v16.js
- BitmapCache
- todo.md
- Review v1.1 (2026-10-19)
- v1.5 – plan (2026-10-30)
- release-notes.md
- fill-sign.js
- package.json
- tools.js
- backup.js
- richtext.js
- handwriting.js
- v17.js
- v161.js
- nsis
- Ocr
- notices.js
- send.js
- electron
- ink-recognize.ps1
- v1.2 – feature requests (2026-10-19)

## God Nodes (most connected - your core abstractions)
1. `Editor` - 92 edges
2. `h()` - 78 edges
3. `Tools` - 75 edges
4. `App` - 43 edges
5. `Library` - 41 edges
6. `toast()` - 40 edges
7. `icon()` - 37 edges
8. `Viewer` - 33 edges
9. `DriveRemote` - 28 edges
10. `showMenu()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `2026-10-26 (v1.4)` --references--> `h()`  [INFERRED]
  tasks/lessons.md → src/renderer/ui.js
- `Bugs found and fixed` --references--> `snapAngle()`  [INFERRED]
  tasks/todo.md → src/shared/geometry.js
- `extWrite()` --indirect_call--> `library()`  [INFERRED]
  src/main/main.js → test/v13.test.js
- `extWriteAll()` --indirect_call--> `library()`  [INFERRED]
  src/main/main.js → test/v13.test.js
- `ids()` --calls--> `stacked()`  [EXTRACTED]
  test/v12.test.js → src/shared/stacking.js

## Import Cycles
- None detected.

## Communities (84 total, 21 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.09
Nodes (16): AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), decodePath(), DONE_PAGE(), DriveError (+8 more)

### Community 2 - "main/main.js"
Cohesion: 0.08
Nodes (29): exportNotebookArchive(), ASSETS, backupDir(), buildPdf(), config, configFile(), createWindow(), DIST (+21 more)

### Community 3 - "editor.js"
Cohesion: 0.10
Nodes (23): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+15 more)

### Community 4 - "editor-panels.js"
Cohesion: 0.22
Nodes (10): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+2 more)

### Community 5 - "App"
Cohesion: 0.11
Nodes (3): defaultToolState(), icon(), App

### Community 6 - "inkrender.js"
Cohesion: 0.14
Nodes (29): livePath(), sizedPath(), strokePath(), angleBetween(), applyTapers(), bandPiece(), beadOutline(), beadPath() (+21 more)

### Community 7 - "Library"
Cohesion: 0.12
Nodes (7): exists(), Library, newId(), readJson(), sanitizeName(), uniqueChild(), tmpLib()

### Community 8 - "showMenu"
Cohesion: 0.30
Nodes (5): swatch(), TextBar, closeMenu(), h(), showMenu()

### Community 9 - ".onMove"
Cohesion: 0.21
Nodes (4): penButton(), mapCuts(), round2(), transformStroke()

### Community 10 - "export.js"
Cohesion: 0.14
Nodes (28): contentBBox(), drawContent(), drawImage(), drawInkText(), drawObject(), drawPaper(), drawPolyline(), drawRich() (+20 more)

### Community 11 - "bgremove.js"
Cohesion: 0.12
Nodes (25): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+17 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, permissions (+20 more)

### Community 13 - "ref_os"
Cohesion: 0.11
Nodes (15): playwright-core, out, root, check(), main(), mem(), out, results (+7 more)

### Community 14 - "ref_fs"
Cohesion: 0.11
Nodes (10): pdf-lib, dist, pdfjs, root, FILES, checkResult(), meanAlpha(), MODEL (+2 more)

### Community 15 - "editor-objects.js"
Cohesion: 0.10
Nodes (16): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+8 more)

### Community 16 - "with"
Cohesion: 0.10
Nodes (20): jobs, publish, name, permissions, contents, runs-on, steps, branches (+12 more)

### Community 17 - "Plan"
Cohesion: 0.20
Nodes (10): A. Sync & data safety (most important), B. Text box (GoodNotes style), C. Shapes, D. Laser, E. Library, F. Pictures, G. Pages, H. Misc (+2 more)

### Community 18 - "toast"
Cohesion: 0.23
Nodes (3): LibraryView, promptDialog(), toast()

### Community 19 - "dependencies"
Cohesion: 0.12
Nodes (21): author, dependencies, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, tesseract.js@^7.0.0, yauzl@^3.4.0 (+13 more)

### Community 20 - "tools.js"
Cohesion: 0.20
Nodes (11): before(), build(), charAt(), highlightStrokes(), layouts, peekLayout(), ready, spanBetween() (+3 more)

### Community 21 - "localbackup.js"
Cohesion: 0.25
Nodes (17): copyFile(), dayOf(), deleteMarked(), entryFor(), findNotebooks(), listSnapshots(), loadIndex(), notebookFiles() (+9 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.20
Nodes (6): compile(), FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 23 - "inkrender.js"
Cohesion: 0.15
Nodes (22): cutClipCache, cutClips(), drawLive(), drawPaperRegion(), fillCache, fillPath(), liveCache, noiseTile() (+14 more)

### Community 25 - "scan-edit.js"
Cohesion: 0.18
Nodes (20): CANDIDATES, chooseFonts(), cssFont(), ensureOcr(), fontScores(), installOcr(), LANGS, loadImage() (+12 more)

### Community 26 - "ref_fs"
Cohesion: 0.22
Nodes (9): local, dayOf(), notebookSignatures(), pad(), publish(), bump(), library(), tmp() (+1 more)

### Community 28 - "geometry.js"
Cohesion: 0.15
Nodes (27): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), BOX_SHAPES, densify(), distPointSeg(), distSegRect() (+19 more)

### Community 29 - "v11.test.js"
Cohesion: 0.24
Nodes (8): firstPageLook(), sleep(), makeSettingsExport(), migrateNotebook(), migratePage(), pageIsEmpty(), readSettingsImport(), ROOT

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.12
Nodes (17): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+9 more)

### Community 33 - ".onKey"
Cohesion: 0.11
Nodes (3): placeAt(), Tools, uid()

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (9): driveDir, driveFile(), driveIndex(), errors, libDir, out, results, root (+1 more)

### Community 36 - "sync.test.js"
Cohesion: 0.12
Nodes (19): absInside(), conflictName(), isIgnoredName(), isNotebookJson(), loadState(), md5Buffer(), md5File(), pad() (+11 more)

### Community 38 - "library-view.js"
Cohesion: 0.14
Nodes (17): drawPaper(), COVER_COLORS, fitTitle(), pageCanvas(), LABEL, templatePicker(), thumbCanvas(), encodeRel() (+9 more)

### Community 39 - "PageView"
Cohesion: 0.14
Nodes (6): drawStrokes(), overlaps(), contains(), dpr(), intersect(), PageView

### Community 40 - "cleanup-branches.yml"
Cohesion: 0.15
Nodes (12): runs-on, steps, jobs, delete, name, permissions, contents, branches (+4 more)

### Community 41 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dist:win, graph, start, test

### Community 43 - "Changelog"
Cohesion: 0.09
Nodes (20): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.6.1, 1.7.0 (+12 more)

### Community 46 - "v14.js"
Cohesion: 0.18
Nodes (7): errors, libDir, out, results, root, tmp, userData

### Community 48 - "external.js"
Cohesion: 0.25
Nodes (14): cleanupExternal(), copyName(), externalPath(), hasUnwrittenNotes(), idFor(), isExternal(), openExternal(), readEmbedded() (+6 more)

### Community 49 - "Lessons"
Cohesion: 0.25
Nodes (7): 2026-10-26 (v1.4), 2026-10-30 (v1.5), 2026-10-31 (v1.6), Lessons, v1.6.1, v1.6 review fixes, v1.7

### Community 50 - "PdfDoc"
Cohesion: 0.21
Nodes (4): CancelError, enqueue(), PdfDoc, pump()

### Community 51 - "StudyNotes – notes for Claude"
Cohesion: 0.50
Nodes (3): Checks, Code map (graphify), StudyNotes – notes for Claude

### Community 53 - "screenshots.js"
Cohesion: 0.18
Nodes (5): FRAMES, outDir, rawDir, root, tmp

### Community 54 - "ui.js"
Cohesion: 0.24
Nodes (11): P, confirmDialog(), debounce(), describeKey(), keySignature(), modal(), shortcutKey(), maybeShowWhatsNew() (+3 more)

### Community 55 - "pen-filter.js"
Cohesion: 0.25
Nodes (3): alpha(), OneEuro, PenFilter

### Community 56 - "v15.js"
Cohesion: 0.18
Nodes (7): errors, libDir, out, results, root, tmp, userData

### Community 58 - "Now (v1.4)"
Cohesion: 0.22
Nodes (9): App, Editing, Later (v2), Next (v1.5), Now (v1.4), Pages & look, Review v1.4 (2026-10-26), Sync & Google (+1 more)

### Community 59 - "StudyNotes – GoodNotes-style desktop app for Windows"
Cohesion: 0.22
Nodes (9): Architecture, Decisions (from your answers), Issues found and fixed during verification, Known limits (v1), Not in v1 (possible later), Review (2026-10-19), StudyNotes – GoodNotes-style desktop app for Windows, Tasks (+1 more)

### Community 60 - "v16.js"
Cohesion: 0.22
Nodes (5): errors, out, results, root, tmp

### Community 62 - "todo.md"
Cohesion: 0.22
Nodes (8): Bugs, Features, Release, Review v1.3 (2026-10-20), v1.3 – feature requests (2026-10-20), v1.6.1 – plan (2026-10-31), v1.6 – plan (2026-10-31), v1.7.0 – plan (2026-11-08)

### Community 63 - "Review v1.1 (2026-10-19)"
Cohesion: 0.29
Nodes (7): Bugs found and fixed, Decisions (your answers), Not testable here (Windows-only, needs your PC), Plan, Review v1.1 (2026-10-19), v1.1 – feature requests (2026-10-19), Verification

### Community 64 - "v1.5 – plan (2026-10-30)"
Cohesion: 0.33
Nodes (6): From the v1.4 plan, New requests, Publishing, Review v1.5 (2026-10-30), v1.5 – plan (2026-10-30), Verify

### Community 68 - "fill-sign.js"
Cohesion: 0.36
Nodes (9): cropToInk(), fillBar(), loadFormFields(), placeNext(), renderFormFields(), signatureDialog(), todayText(), urlFor() (+1 more)

### Community 69 - "package.json"
Cohesion: 0.14
Nodes (14): devDependencies, electron-builder@^26.15.3, esbuild@^0.28.2, pdfjs-dist@^6.4.299, playwright-core@^1.64.1, @tesseract.js-data/deu@^1.0.0, @tesseract.js-data/eng@^1.0.0, @tesseract.js-data/rus@^1.0.0 (+6 more)

### Community 70 - "tools.js"
Cohesion: 0.16
Nodes (16): itemBBox(), rotPt(), segTouchesRect(), textBBox(), transformItem(), turnedBox(), unionBox(), releaseCanvas() (+8 more)

### Community 71 - "backup.js"
Cohesion: 0.31
Nodes (9): entryStream(), exportLibrary(), importLibrary(), openZip(), readEntries(), readManifest(), walk(), zipFolder() (+1 more)

### Community 72 - "richtext.js"
Cohesion: 0.36
Nodes (9): wrapText(), decode(), ENTITIES, layoutRich(), parseRich(), plainFromParas(), plainToHtml(), richToPlain() (+1 more)

### Community 73 - "handwriting.js"
Cohesion: 0.42
Nodes (10): encodedScript(), fake(), fakeRecognize(), recognize(), recognizeMany(), recognizers(), runPowerShell(), SCRIPT (+2 more)

### Community 74 - "v17.js"
Cohesion: 0.22
Nodes (7): errors, launch(), ocrUrl(), out, results, root, tmp

### Community 75 - "v161.js"
Cohesion: 0.22
Nodes (5): errors, out, results, root, tmp

### Community 76 - "nsis"
Cohesion: 0.25
Nodes (8): nsis, allowToChangeInstallationDirectory, artifactName, createDesktopShortcut, createStartMenuShortcut, oneClick, perMachine, shortcutName

### Community 79 - "send.js"
Cohesion: 0.47
Nodes (8): findThunderbird(), outlookScript(), powershell(), psQuote(), run(), sendMail(), sendTelegram(), thunderbirdArgs()

### Community 82 - "v1.2 – feature requests (2026-10-19)"
Cohesion: 0.50
Nodes (4): Decisions (your answers), Plan, Review v1.2 (2026-10-20), v1.2 – feature requests (2026-10-19)

## Knowledge Gaps
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Editor` connect `Editor` to `Viewer`, `.onKey`, `.pageMenu`, `editor.js`, `editor-panels.js`, `App`, `showMenu`, `Thumbs`, `.constructor`, `.pageData`, `ui.js`, `BitmapCache`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Should `DriveRemote` be split into smaller, more focused modules?**
  _Cohesion score 0.0899854862119013 - nodes in this community are weakly interconnected._
- **Why does `snapAngle()` connect `geometry.js` to `.onMove`, `tools.js`, `Review v1.1 (2026-10-19)`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08108108108108109 - nodes in this community are weakly interconnected._
- **Why does `Bugs found and fixed` connect `Review v1.1 (2026-10-19)` to `geometry.js`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Should `editor.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09885057471264368 - nodes in this community are weakly interconnected._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.11470985155195682 - nodes in this community are weakly interconnected._