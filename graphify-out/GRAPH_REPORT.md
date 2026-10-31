# Graph Report - studynotes  (2026-10-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1333 nodes · 3311 edges · 72 communities (56 shown, 16 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 230 edges (avg confidence: 0.85)
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
- h
- .onMove
- export.js
- bgremove.js
- with
- ref_fs
- v14.test.js
- editor-objects.js
- with
- Plan
- toast
- dependencies
- tools.js
- localbackup.js
- FakeDriveApi
- tools.js
- Editor
- ink.js
- v13.test.js
- CloudSync
- geometry.js
- v11.test.js
- FakeRemote
- i18n.js
- build
- .onKey
- v13.js
- richtext.js
- sync.test.js
- Laser
- library-view.js
- PageView
- cleanup-branches.yml
- scripts
- FakeAuth
- Changelog
- Thumbs
- external.js
- v14.js
- run.js
- Lessons
- PdfDoc
- StudyNotes – notes for Claude
- FakeRemote
- screenshots.js
- h
- pen-filter.js
- v15.js
- Now (v1.4)
- StudyNotes – GoodNotes-style desktop app for Windows
- v16.js
- BitmapCache
- todo.md
- Review v1.1 (2026-10-19)
- v1.5 – plan (2026-10-30)
- v1.6 – plan (2026-10-31)
- release-notes.md
- fill-sign.js
- playwright-core
- itemBBox
- build.js

## God Nodes (most connected - your core abstractions)
1. `Editor` - 86 edges
2. `h()` - 75 edges
3. `Tools` - 68 edges
4. `App` - 42 edges
5. `Library` - 41 edges
6. `toast()` - 37 edges
7. `icon()` - 36 edges
8. `Viewer` - 33 edges
9. `DriveRemote` - 28 edges
10. `showMenu()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `Bugs found and fixed` --references--> `snapAngle()`  [INFERRED]
  tasks/todo.md → src/shared/geometry.js
- `2026-10-26 (v1.4)` --references--> `h()`  [INFERRED]
  tasks/lessons.md → src/renderer/ui.js
- `tmpLib()` --calls--> `Library`  [EXTRACTED]
  test/library.test.js → src/main/library.js
- `extWrite()` --indirect_call--> `library()`  [INFERRED]
  src/main/main.js → test/v13.test.js
- `extWriteAll()` --indirect_call--> `library()`  [INFERRED]
  src/main/main.js → test/v13.test.js

## Import Cycles
- None detected.

## Communities (72 total, 16 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.09
Nodes (16): AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), decodePath(), DONE_PAGE(), DriveError (+8 more)

### Community 2 - "main/main.js"
Cohesion: 0.06
Nodes (42): entryStream(), exportLibrary(), exportNotebookArchive(), importLibrary(), openZip(), readEntries(), readManifest(), walk() (+34 more)

### Community 3 - "editor.js"
Cohesion: 0.12
Nodes (18): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+10 more)

### Community 4 - "editor-panels.js"
Cohesion: 0.22
Nodes (10): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+2 more)

### Community 6 - "inkrender.js"
Cohesion: 0.11
Nodes (29): cutClipCache, cutClips(), drawLive(), drawPaper(), drawPaperRegion(), drawStrokes(), fillCache, fillPath() (+21 more)

### Community 7 - "Library"
Cohesion: 0.12
Nodes (6): exists(), firstPageLook(), Library, readJson(), sanitizeName(), uniqueChild()

### Community 8 - "h"
Cohesion: 0.15
Nodes (5): sizeControl(), swatch(), TextBar, closeMenu(), showMenu()

### Community 10 - "export.js"
Cohesion: 0.16
Nodes (27): contentBBox(), drawContent(), drawImage(), drawObject(), drawPaper(), drawPolyline(), drawRich(), drawStroke() (+19 more)

### Community 11 - "bgremove.js"
Cohesion: 0.12
Nodes (25): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+17 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, permissions (+20 more)

### Community 13 - "ref_fs"
Cohesion: 0.09
Nodes (11): parts, root, out, root, out, results, root, out (+3 more)

### Community 14 - "v14.test.js"
Cohesion: 0.15
Nodes (5): checkResult(), meanAlpha(), MODEL, pngInfo(), tmpLib()

### Community 15 - "editor-objects.js"
Cohesion: 0.08
Nodes (23): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+15 more)

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
Cohesion: 0.13
Nodes (19): author, dependencies, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, yauzl@^3.4.0, yazl@^3.3.1 (+11 more)

### Community 20 - "tools.js"
Cohesion: 0.18
Nodes (10): before(), build(), charAt(), layouts, peekLayout(), ready, spanBetween(), textLayout() (+2 more)

### Community 21 - "localbackup.js"
Cohesion: 0.25
Nodes (17): copyFile(), dayOf(), deleteMarked(), entryFor(), findNotebooks(), listSnapshots(), loadIndex(), notebookFiles() (+9 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.20
Nodes (6): compile(), FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 23 - "tools.js"
Cohesion: 0.15
Nodes (16): placeAt(), highlightStrokes(), rotPt(), segTouchesRect(), textBBox(), transformItem(), turnedBox(), uid() (+8 more)

### Community 25 - "ink.js"
Cohesion: 0.18
Nodes (23): angleBetween(), applyTapers(), bandPiece(), beadOutline(), beadPath(), catmull(), ccw(), circlePiece() (+15 more)

### Community 26 - "v13.test.js"
Cohesion: 0.31
Nodes (6): dayOf(), notebookSignatures(), pad(), publish(), bump(), write()

### Community 28 - "geometry.js"
Cohesion: 0.18
Nodes (24): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), BOX_SHAPES, densify(), distPointSeg(), distSegRect() (+16 more)

### Community 29 - "v11.test.js"
Cohesion: 0.20
Nodes (13): sleep(), findThunderbird(), outlookScript(), powershell(), psQuote(), run(), sendMail(), sendTelegram() (+5 more)

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.08
Nodes (25): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+17 more)

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (9): driveDir, driveFile(), driveIndex(), errors, libDir, out, results, root (+1 more)

### Community 35 - "richtext.js"
Cohesion: 0.31
Nodes (10): decode(), ENTITIES, parseRich(), plainFromParas(), richToPlain(), spanStyle(), layerOf(), restack() (+2 more)

### Community 36 - "sync.test.js"
Cohesion: 0.11
Nodes (20): local, absInside(), conflictName(), isIgnoredName(), isNotebookJson(), loadState(), md5Buffer(), md5File() (+12 more)

### Community 38 - "library-view.js"
Cohesion: 0.18
Nodes (16): COVER_COLORS, fitTitle(), pageCanvas(), LABEL, templatePicker(), thumbCanvas(), formatDate(), COVERS (+8 more)

### Community 39 - "PageView"
Cohesion: 0.16
Nodes (4): contains(), dpr(), intersect(), PageView

### Community 40 - "cleanup-branches.yml"
Cohesion: 0.15
Nodes (12): runs-on, steps, jobs, delete, name, permissions, contents, branches (+4 more)

### Community 41 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dist:win, graph, start, test

### Community 43 - "Changelog"
Cohesion: 0.09
Nodes (19): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.6.1, Changelog (+11 more)

### Community 45 - "external.js"
Cohesion: 0.22
Nodes (15): cleanupExternal(), copyName(), externalPath(), hasUnwrittenNotes(), idFor(), isExternal(), openExternal(), readEmbedded() (+7 more)

### Community 46 - "v14.js"
Cohesion: 0.18
Nodes (7): errors, libDir, out, results, root, tmp, userData

### Community 48 - "run.js"
Cohesion: 0.28
Nodes (6): check(), main(), mem(), out, results, root

### Community 49 - "Lessons"
Cohesion: 0.29
Nodes (6): 2026-10-26 (v1.4), 2026-10-30 (v1.5), 2026-10-31 (v1.6), Lessons, v1.6.1, v1.6 review fixes

### Community 50 - "PdfDoc"
Cohesion: 0.22
Nodes (4): CancelError, enqueue(), PdfDoc, pump()

### Community 51 - "StudyNotes – notes for Claude"
Cohesion: 0.50
Nodes (3): Checks, Code map (graphify), StudyNotes – notes for Claude

### Community 53 - "screenshots.js"
Cohesion: 0.18
Nodes (5): FRAMES, outDir, rawDir, root, tmp

### Community 54 - "h"
Cohesion: 0.21
Nodes (12): confirmDialog(), debounce(), describeKey(), h(), iconButton(), keySignature(), modal(), shortcutKey() (+4 more)

### Community 55 - "pen-filter.js"
Cohesion: 0.25
Nodes (3): alpha(), OneEuro, PenFilter

### Community 56 - "v15.js"
Cohesion: 0.09
Nodes (13): pdf-lib, errors, libDir, out, results, root, tmp, userData (+5 more)

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
Cohesion: 0.25
Nodes (7): Decisions (your answers), Plan, Review v1.2 (2026-10-20), Review v1.3 (2026-10-20), v1.2 – feature requests (2026-10-19), v1.3 – feature requests (2026-10-20), v1.6.1 – plan (2026-10-31)

### Community 63 - "Review v1.1 (2026-10-19)"
Cohesion: 0.29
Nodes (7): Bugs found and fixed, Decisions (your answers), Not testable here (Windows-only, needs your PC), Plan, Review v1.1 (2026-10-19), v1.1 – feature requests (2026-10-19), Verification

### Community 64 - "v1.5 – plan (2026-10-30)"
Cohesion: 0.33
Nodes (6): From the v1.4 plan, New requests, Publishing, Review v1.5 (2026-10-30), v1.5 – plan (2026-10-30), Verify

### Community 65 - "v1.6 – plan (2026-10-31)"
Cohesion: 0.50
Nodes (4): Bugs, Features, Release, v1.6 – plan (2026-10-31)

### Community 68 - "fill-sign.js"
Cohesion: 0.28
Nodes (10): cropToInk(), fillBar(), placeNext(), renderFormFields(), signatureDialog(), todayText(), urlFor(), whiteToTransparent() (+2 more)

### Community 69 - "playwright-core"
Cohesion: 0.18
Nodes (9): devDependencies, electron@^44.9.0, electron-builder@^26.15.3, pdfjs-dist@^6.4.299, playwright-core@^1.64.1, electron, electron-builder, pdfjs-dist (+1 more)

### Community 70 - "itemBBox"
Cohesion: 0.38
Nodes (5): itemBBox(), pointInPolygon(), rectsIntersect(), resample(), strokeInLasso()

### Community 71 - "build.js"
Cohesion: 0.33
Nodes (5): esbuild@^0.28.2, esbuild, dist, pdfjs, root

## Knowledge Gaps
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `snapAngle()` connect `tools.js` to `.onMove`, `geometry.js`, `Review v1.1 (2026-10-19)`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Should `DriveRemote` be split into smaller, more focused modules?**
  _Cohesion score 0.08735150244584207 - nodes in this community are weakly interconnected._
- **Why does `Bugs found and fixed` connect `Review v1.1 (2026-10-19)` to `tools.js`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06259426847662142 - nodes in this community are weakly interconnected._
- **Should `editor.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12380952380952381 - nodes in this community are weakly interconnected._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.12436974789915967 - nodes in this community are weakly interconnected._
- **Should `inkrender.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11491935483870967 - nodes in this community are weakly interconnected._