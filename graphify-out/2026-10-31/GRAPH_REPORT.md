# Graph Report - studynotes  (2026-10-31)

## Corpus Check
- 79 files · ~131,665 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 8, .css 1)

## Summary
- 1302 nodes · 3253 edges · 70 communities (55 shown, 15 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 231 edges (avg confidence: 0.85)
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
- h
- Tools
- export.js
- bgremove.js
- with
- ref_os
- v14.test.js
- editor-objects.js
- with
- Plan
- DriveRemote
- dependencies
- tools.js
- localbackup.js
- FakeDriveApi
- round2
- Editor
- v13.test.js
- CloudSync
- geometry.js
- v11.test.js
- FakeRemote
- i18n.js
- build
- v13.js
- richtext.js
- sync.js
- Laser
- library-view.js
- stacked
- cleanup-branches.yml
- scripts
- FakeAuth
- Changelog
- Thumbs
- sync.test.js
- v14.js
- run.js
- Lessons
- PdfDoc
- StudyNotes – notes for Claude
- FakeRemote
- screenshots.js
- ui.js
- tools.js
- v15.js
- .folderFor
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
- bgremove.test.js

## God Nodes (most connected - your core abstractions)
1. `Editor` - 86 edges
2. `h()` - 73 edges
3. `Tools` - 67 edges
4. `Library` - 41 edges
5. `App` - 40 edges
6. `icon()` - 36 edges
7. `toast()` - 36 edges
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
- `setup()` --calls--> `syncLibrary()`  [EXTRACTED]
  test/sync.test.js → src/main/sync.js

## Import Cycles
- None detected.

## Communities (70 total, 15 thin omitted)

### Community 1 - "drive.js"
Cohesion: 0.17
Nodes (8): AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), DONE_PAGE(), GoogleAuth, MIME

### Community 2 - "main/main.js"
Cohesion: 0.06
Nodes (44): entryStream(), exportLibrary(), exportNotebookArchive(), importLibrary(), openZip(), readEntries(), readManifest(), walk() (+36 more)

### Community 3 - "editor.js"
Cohesion: 0.13
Nodes (15): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+7 more)

### Community 4 - "editor-panels.js"
Cohesion: 0.20
Nodes (12): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+4 more)

### Community 5 - "App"
Cohesion: 0.09
Nodes (4): defaultToolState(), LibraryView, App, toast()

### Community 6 - "inkrender.js"
Cohesion: 0.06
Nodes (43): cutClipCache, cutClips(), drawLive(), drawPaperRegion(), drawStrokes(), fillCache, fillPath(), noiseTile() (+35 more)

### Community 7 - "Library"
Cohesion: 0.08
Nodes (27): cleanupExternal(), copyName(), externalPath(), hasUnwrittenNotes(), idFor(), isExternal(), openExternal(), readEmbedded() (+19 more)

### Community 8 - "h"
Cohesion: 0.16
Nodes (10): ALIGN_ICON, ALIGN_NEXT, sizeControl(), swatch(), TEXT_SIZES, TextBar, closeMenu(), h() (+2 more)

### Community 9 - "Tools"
Cohesion: 0.15
Nodes (3): penButton(), segTouchesRect(), Tools

### Community 10 - "export.js"
Cohesion: 0.15
Nodes (27): contentBBox(), drawContent(), drawImage(), drawObject(), drawPaper(), drawPolyline(), drawRich(), drawStroke() (+19 more)

### Community 11 - "bgremove.js"
Cohesion: 0.12
Nodes (25): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+17 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, permissions (+20 more)

### Community 13 - "ref_os"
Cohesion: 0.14
Nodes (8): out, root, out, results, root, out, results, root

### Community 14 - "v14.test.js"
Cohesion: 0.15
Nodes (3): pdf-lib, @pdf-lib/fontkit, FONT

### Community 15 - "editor-objects.js"
Cohesion: 0.10
Nodes (16): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+8 more)

### Community 16 - "with"
Cohesion: 0.10
Nodes (20): jobs, publish, name, permissions, contents, runs-on, steps, branches (+12 more)

### Community 17 - "Plan"
Cohesion: 0.20
Nodes (10): A. Sync & data safety (most important), B. Text box (GoodNotes style), C. Shapes, D. Laser, E. Library, F. Pictures, G. Pages, H. Misc (+2 more)

### Community 18 - "DriveRemote"
Cohesion: 0.20
Nodes (6): DriveError, DriveRemote, encodePath(), mimeOf(), rangeEnd(), sleep()

### Community 19 - "dependencies"
Cohesion: 0.08
Nodes (29): author, dependencies, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, yauzl@^3.4.0, yazl@^3.3.1 (+21 more)

### Community 20 - "tools.js"
Cohesion: 0.21
Nodes (9): before(), build(), charAt(), layouts, ready, spanBetween(), textLayout(), TextSelection (+1 more)

### Community 21 - "localbackup.js"
Cohesion: 0.25
Nodes (17): copyFile(), dayOf(), deleteMarked(), entryFor(), findNotebooks(), listSnapshots(), loadIndex(), notebookFiles() (+9 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.20
Nodes (6): compile(), FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 23 - "round2"
Cohesion: 0.18
Nodes (7): placeAt(), rotPt(), transformItem(), uid(), mapCuts(), round2(), transformStroke()

### Community 26 - "v13.test.js"
Cohesion: 0.11
Nodes (10): dist, pdfjs, root, parts, root, local, dayOf(), notebookSignatures() (+2 more)

### Community 28 - "geometry.js"
Cohesion: 0.21
Nodes (21): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), BOX_SHAPES, densify(), distPointSeg(), distSegRect() (+13 more)

### Community 29 - "v11.test.js"
Cohesion: 0.47
Nodes (8): findThunderbird(), outlookScript(), powershell(), psQuote(), run(), sendMail(), sendTelegram(), thunderbirdArgs()

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
Cohesion: 0.26
Nodes (10): wrapText(), decode(), ENTITIES, layoutRich(), parseRich(), plainFromParas(), plainToHtml(), richToPlain() (+2 more)

### Community 36 - "sync.js"
Cohesion: 0.29
Nodes (13): absInside(), conflictName(), isIgnoredName(), isNotebookJson(), loadState(), md5Buffer(), pad(), pruneEmptyDirs() (+5 more)

### Community 38 - "library-view.js"
Cohesion: 0.18
Nodes (16): drawPaper(), COVER_COLORS, fitTitle(), pageCanvas(), LABEL, templatePicker(), thumbCanvas(), encodeRel() (+8 more)

### Community 39 - "stacked"
Cohesion: 0.73
Nodes (4): layerOf(), restack(), stacked(), ids()

### Community 40 - "cleanup-branches.yml"
Cohesion: 0.15
Nodes (12): runs-on, steps, jobs, delete, name, permissions, contents, branches (+4 more)

### Community 41 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dist:win, graph, start, test

### Community 43 - "Changelog"
Cohesion: 0.10
Nodes (18): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, Changelog, Features (+10 more)

### Community 45 - "sync.test.js"
Cohesion: 0.19
Nodes (6): md5File(), edit(), setup(), smallLibrary(), tmpdir(), write()

### Community 46 - "v14.js"
Cohesion: 0.18
Nodes (7): errors, libDir, out, results, root, tmp, userData

### Community 48 - "run.js"
Cohesion: 0.28
Nodes (6): check(), main(), mem(), out, results, root

### Community 49 - "Lessons"
Cohesion: 0.33
Nodes (5): 2026-10-26 (v1.4), 2026-10-30 (v1.5), 2026-10-31 (v1.6), Lessons, v1.6 review fixes

### Community 50 - "PdfDoc"
Cohesion: 0.22
Nodes (4): CancelError, enqueue(), PdfDoc, pump()

### Community 51 - "StudyNotes – notes for Claude"
Cohesion: 0.50
Nodes (3): Checks, Code map (graphify), StudyNotes – notes for Claude

### Community 53 - "screenshots.js"
Cohesion: 0.18
Nodes (5): FRAMES, outDir, rawDir, root, tmp

### Community 54 - "ui.js"
Cohesion: 0.26
Nodes (12): icon(), P, confirmDialog(), iconButton(), modal(), parseRange(), promptDialog(), shortcutKey() (+4 more)

### Community 55 - "tools.js"
Cohesion: 0.12
Nodes (19): highlightStrokes(), peekLayout(), itemBBox(), textBBox(), turnedBox(), unionBox(), releaseCanvas(), isScribble() (+11 more)

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
Cohesion: 0.29
Nodes (6): Decisions (your answers), Plan, Review v1.2 (2026-10-20), Review v1.3 (2026-10-20), v1.2 – feature requests (2026-10-19), v1.3 – feature requests (2026-10-20)

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
Cohesion: 0.42
Nodes (8): cropToInk(), fillBar(), placeNext(), renderFormFields(), signatureDialog(), todayText(), urlFor(), whiteToTransparent()

### Community 69 - "bgremove.test.js"
Cohesion: 0.47
Nodes (4): checkResult(), meanAlpha(), MODEL, pngInfo()

## Knowledge Gaps
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Editor` connect `Editor` to `Viewer`, `.onKey`, `editor.js`, `editor-panels.js`, `App`, `h`, `Thumbs`, `.pageData`, `ui.js`, `tools.js`, `.buildToolbar`, `BitmapCache`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05889724310776942 - nodes in this community are weakly interconnected._
- **Why does `h()` connect `h` to `Viewer`, `.onKey`, `editor.js`, `editor-panels.js`, `fill-sign.js`, `library-view.js`, `App`, `Laser`, `Tools`, `inkrender.js`, `Thumbs`, `editor-objects.js`, `Lessons`, `tools.js`, `ui.js`, `tools.js`, `Editor`, `.buildToolbar`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Should `editor.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12631578947368421 - nodes in this community are weakly interconnected._
- **Why does `snapAngle()` connect `tools.js` to `Tools`, `geometry.js`, `Review v1.1 (2026-10-19)`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.08717948717948718 - nodes in this community are weakly interconnected._
- **Should `inkrender.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0648018648018648 - nodes in this community are weakly interconnected._