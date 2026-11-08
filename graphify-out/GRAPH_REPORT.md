# Graph Report - studynotes  (2026-11-08)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1417 nodes · 3531 edges · 83 communities (63 shown, 20 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 250 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Viewer
- drive.js
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
- v14.test.js
- editor-objects.js
- with
- Plan
- toast
- dependencies
- tools.js
- localbackup.js
- FakeDriveApi
- DriveRemote
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
- sync.js
- Laser
- library-view.js
- PageView
- cleanup-branches.yml
- scripts
- FakeAuth
- Changelog
- Thumbs
- v14.js
- run.js
- Lessons
- PdfDoc
- StudyNotes – notes for Claude
- FakeRemote
- screenshots.js
- h
- v14.test.js
- v15.js
- Now (v1.4)
- StudyNotes – GoodNotes-style desktop app for Windows
- v16.js
- BitmapCache
- todo.md
- Review v1.1 (2026-10-19)
- v1.5 – plan (2026-10-30)
- sync.test.js
- release-notes.md
- fill-sign.js
- package.json
- tools.js
- build.js
- .folderFor
- handwriting.js
- v17.js
- v161.js
- nsis
- win
- notices.js
- FontBox
- electron
- ink-recognize.ps1
- v1.2 – feature requests (2026-10-19)

## God Nodes (most connected - your core abstractions)
1. `Editor` - 90 edges
2. `h()` - 78 edges
3. `Tools` - 75 edges
4. `App` - 43 edges
5. `Library` - 41 edges
6. `toast()` - 40 edges
7. `icon()` - 36 edges
8. `Viewer` - 33 edges
9. `DriveRemote` - 28 edges
10. `showMenu()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `Bugs found and fixed` --references--> `snapAngle()`  [INFERRED]
  tasks/todo.md → src/shared/geometry.js
- `2026-10-26 (v1.4)` --references--> `h()`  [INFERRED]
  tasks/lessons.md → src/renderer/ui.js
- `extWrite()` --indirect_call--> `library()`  [INFERRED]
  src/main/main.js → test/v13.test.js
- `extWriteAll()` --indirect_call--> `library()`  [INFERRED]
  src/main/main.js → test/v13.test.js
- `setup()` --calls--> `syncLibrary()`  [EXTRACTED]
  test/sync.test.js → src/main/sync.js

## Import Cycles
- None detected.

## Communities (83 total, 20 thin omitted)

### Community 1 - "drive.js"
Cohesion: 0.17
Nodes (8): AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), DONE_PAGE(), GoogleAuth, MIME

### Community 2 - "main/main.js"
Cohesion: 0.05
Nodes (48): entryStream(), exportLibrary(), exportNotebookArchive(), importLibrary(), openZip(), readEntries(), readManifest(), walk() (+40 more)

### Community 3 - "editor.js"
Cohesion: 0.09
Nodes (30): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+22 more)

### Community 4 - "editor-panels.js"
Cohesion: 0.22
Nodes (10): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+2 more)

### Community 5 - "App"
Cohesion: 0.12
Nodes (3): defaultToolState(), App, encodeRel()

### Community 6 - "inkrender.js"
Cohesion: 0.08
Nodes (48): cutClipCache, cutClips(), drawLive(), drawStrokes(), fillCache, fillPath(), liveCache, livePath() (+40 more)

### Community 7 - "Library"
Cohesion: 0.08
Nodes (23): cleanupExternal(), copyName(), externalPath(), hasUnwrittenNotes(), idFor(), isExternal(), openExternal(), readEmbedded() (+15 more)

### Community 8 - "showMenu"
Cohesion: 0.18
Nodes (10): ALIGN_ICON, ALIGN_NEXT, sizeControl(), swatch(), TEXT_SIZES, TextBar, closeMenu(), showMenu() (+2 more)

### Community 9 - ".onMove"
Cohesion: 0.17
Nodes (4): placeAt(), penButton(), segTouchesRect(), uid()

### Community 10 - "export.js"
Cohesion: 0.17
Nodes (26): contentBBox(), drawContent(), drawImage(), drawInkText(), drawObject(), drawPaper(), drawPolyline(), drawRich() (+18 more)

### Community 11 - "bgremove.js"
Cohesion: 0.12
Nodes (25): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+17 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, permissions (+20 more)

### Community 13 - "ref_os"
Cohesion: 0.15
Nodes (10): playwright-core@^1.64.1, playwright-core, out, root, out, results, root, out (+2 more)

### Community 14 - "v14.test.js"
Cohesion: 0.15
Nodes (5): checkResult(), meanAlpha(), MODEL, pngInfo(), FONT

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
Cohesion: 0.25
Nodes (3): LibraryView, promptDialog(), toast()

### Community 19 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, tesseract.js@^7.0.0, yauzl@^3.4.0, yazl@^3.3.1 (+5 more)

### Community 20 - "tools.js"
Cohesion: 0.16
Nodes (8): charAt(), highlightStrokes(), peekLayout(), spanBetween(), TextSelection, unionBox(), releaseCanvas(), isScribble()

### Community 21 - "localbackup.js"
Cohesion: 0.25
Nodes (17): copyFile(), dayOf(), deleteMarked(), entryFor(), findNotebooks(), listSnapshots(), loadIndex(), notebookFiles() (+9 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.20
Nodes (6): compile(), FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 23 - "DriveRemote"
Cohesion: 0.20
Nodes (6): DriveError, DriveRemote, encodePath(), mimeOf(), rangeEnd(), sleep()

### Community 25 - "scan-edit.js"
Cohesion: 0.23
Nodes (16): CANDIDATES, cssFont(), ensureOcr(), installOcr(), loadImage(), makeTextEditable(), matchFont(), rasterize() (+8 more)

### Community 26 - "ref_fs"
Cohesion: 0.17
Nodes (10): local, FILES, dayOf(), notebookSignatures(), pad(), publish(), bump(), library() (+2 more)

### Community 28 - "geometry.js"
Cohesion: 0.18
Nodes (24): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), densify(), distPointSeg(), distSegRect(), distSegSeg() (+16 more)

### Community 29 - "v11.test.js"
Cohesion: 0.18
Nodes (15): wrapText(), makeSettingsExport(), migrateNotebook(), migratePage(), pageIsEmpty(), readSettingsImport(), decode(), ENTITIES (+7 more)

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.17
Nodes (12): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+4 more)

### Community 33 - ".onKey"
Cohesion: 0.12
Nodes (6): rotPt(), Tools, transformItem(), mapCuts(), round2(), transformStroke()

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (9): driveDir, driveFile(), driveIndex(), errors, libDir, out, results, root (+1 more)

### Community 36 - "sync.js"
Cohesion: 0.29
Nodes (13): absInside(), conflictName(), isIgnoredName(), isNotebookJson(), loadState(), md5Buffer(), pad(), pruneEmptyDirs() (+5 more)

### Community 38 - "library-view.js"
Cohesion: 0.16
Nodes (20): drawPaper(), drawPaperRegion(), strokePaperLines(), COVER_COLORS, fitTitle(), pageCanvas(), LABEL, templatePicker() (+12 more)

### Community 39 - "PageView"
Cohesion: 0.17
Nodes (4): contains(), dpr(), intersect(), PageView

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

### Community 48 - "run.js"
Cohesion: 0.28
Nodes (6): check(), main(), mem(), out, results, root

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

### Community 54 - "h"
Cohesion: 0.22
Nodes (7): confirmDialog(), h(), modal(), maybeShowWhatsNew(), newer(), RELEASES, showWhatsNew()

### Community 55 - "v14.test.js"
Cohesion: 0.13
Nodes (5): pdf-lib, @pdf-lib/fontkit, alpha(), OneEuro, PenFilter

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

### Community 65 - "sync.test.js"
Cohesion: 0.19
Nodes (6): md5File(), edit(), setup(), smallLibrary(), tmpdir(), write()

### Community 68 - "fill-sign.js"
Cohesion: 0.25
Nodes (10): cropToInk(), fillBar(), placeNext(), renderFormFields(), signatureDialog(), todayText(), urlFor(), whiteToTransparent() (+2 more)

### Community 69 - "package.json"
Cohesion: 0.12
Nodes (20): author, description, devDependencies, electron-builder@^26.15.3, esbuild@^0.28.2, pdfjs-dist@^6.4.299, @tesseract.js-data/deu@^1.0.0, @tesseract.js-data/eng@^1.0.0 (+12 more)

### Community 70 - "tools.js"
Cohesion: 0.24
Nodes (12): itemBBox(), textBBox(), turnedBox(), LINE_SHAPES, pointInPolygon(), rectsIntersect(), resample(), strokeInLasso() (+4 more)

### Community 71 - "build.js"
Cohesion: 0.50
Nodes (3): dist, pdfjs, root

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

### Community 77 - "win"
Cohesion: 0.40
Nodes (5): win, artifactName, files, icon, target

### Community 82 - "v1.2 – feature requests (2026-10-19)"
Cohesion: 0.50
Nodes (4): Decisions (your answers), Plan, Review v1.2 (2026-10-20), v1.2 – feature requests (2026-10-19)

## Knowledge Gaps
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `snapAngle()` connect `geometry.js` to `.onMove`, `tools.js`, `tools.js`, `Review v1.1 (2026-10-19)`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.052464947987336044 - nodes in this community are weakly interconnected._
- **Why does `Bugs found and fixed` connect `Review v1.1 (2026-10-19)` to `geometry.js`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Should `editor.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09041835357624832 - nodes in this community are weakly interconnected._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.11948790896159317 - nodes in this community are weakly interconnected._
- **Should `inkrender.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08446455505279035 - nodes in this community are weakly interconnected._
- **Should `Library` be split into smaller, more focused modules?**
  _Cohesion score 0.08361581920903954 - nodes in this community are weakly interconnected._