# Graph Report - studynotes  (2026-11-08)

## Corpus Check
- 91 files · ~181,782 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 8, .css 1)

## Summary
- 1499 nodes · 3730 edges · 76 communities (59 shown, 17 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 262 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Viewer
- DriveRemote
- main/main.js
- drawObject
- ocr-bench.js
- App
- inkrender.js
- Library
- showMenu
- Tools
- export.js
- bgremove.js
- with
- ref_os
- v13.test.js
- editor-objects.js
- with
- Plan
- v11.test.js
- dependencies
- tools.js
- localbackup.js
- FakeDriveApi
- inkrender.js
- .renderOptions
- scan-edit.js
- PageView
- FakeRemote
- geometry.js
- ref_fs
- FakeRemote
- i18n.js
- build
- Tools
- v13.js
- sync.js
- Laser
- library-view.js
- editor-panels.js
- cleanup-branches.yml
- scripts
- FakeAuth
- Changelog
- Thumbs
- backup.js
- v14.js
- Editor
- win
- Lessons
- StudyNotes – notes for Claude
- run.js
- extWrite
- Ocr
- pen-filter.js
- v15.js
- build.js
- Now (v1.4)
- StudyNotes – GoodNotes-style desktop app for Windows
- v1.6 – plan (2026-10-31)
- todo.md
- Review v1.1 (2026-10-19)
- v1.5 – plan (2026-10-30)
- round2
- release-notes.md
- package.json
- tools.js
- richtext.js
- handwriting.js
- v17.js
- nsis
- electron
- ink-recognize.ps1
- v1.2 – feature requests (2026-10-19)

## God Nodes (most connected - your core abstractions)
1. `Editor` - 92 edges
2. `h()` - 78 edges
3. `Tools` - 75 edges
4. `App` - 43 edges
5. `Library` - 41 edges
6. `toast()` - 41 edges
7. `makeTextEditable()` - 39 edges
8. `icon()` - 37 edges
9. `Viewer` - 33 edges
10. `DriveRemote` - 31 edges

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

## Communities (76 total, 17 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.07
Nodes (17): CloudSync, AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), decodePath(), DONE_PAGE() (+9 more)

### Community 2 - "main/main.js"
Cohesion: 0.09
Nodes (22): ASSETS, backupDir(), config, configFile(), createWindow(), DIST, endSession(), extRunning (+14 more)

### Community 3 - "drawObject"
Cohesion: 0.23
Nodes (13): drawObject(), BOX_PRESETS, boxStyle(), docLook(), roundedRect(), softLimit(), softOf(), applyH() (+5 more)

### Community 4 - "ocr-bench.js"
Cohesion: 0.17
Nodes (9): CONDS, errors, FONTS, launch(), ocrUrl(), out, results, root (+1 more)

### Community 5 - "App"
Cohesion: 0.07
Nodes (14): P, LibraryView, App, confirmDialog(), debounce(), describeKey(), keySignature(), modal() (+6 more)

### Community 6 - "inkrender.js"
Cohesion: 0.20
Nodes (22): angleBetween(), applyTapers(), bandPiece(), beadOutline(), beadPath(), catmull(), ccw(), circlePiece() (+14 more)

### Community 7 - "Library"
Cohesion: 0.08
Nodes (26): cleanupExternal(), copyName(), externalPath(), hasUnwrittenNotes(), idFor(), isExternal(), openExternal(), readEmbedded() (+18 more)

### Community 8 - "showMenu"
Cohesion: 0.18
Nodes (10): icon(), ALIGN_ICON, ALIGN_NEXT, sizeControl(), swatch(), TextBar, closeMenu(), h() (+2 more)

### Community 10 - "export.js"
Cohesion: 0.11
Nodes (35): contentBBox(), drawContent(), drawImage(), drawInkText(), drawPaper(), drawPolyline(), drawRich(), drawStroke() (+27 more)

### Community 11 - "bgremove.js"
Cohesion: 0.12
Nodes (25): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+17 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, permissions (+20 more)

### Community 13 - "ref_os"
Cohesion: 0.05
Nodes (24): playwright-core, FRAMES, outDir, rawDir, root, tmp, out, root (+16 more)

### Community 14 - "v13.test.js"
Cohesion: 0.33
Nodes (6): dayOf(), notebookSignatures(), pad(), publish(), bump(), write()

### Community 15 - "editor-objects.js"
Cohesion: 0.08
Nodes (17): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+9 more)

### Community 16 - "with"
Cohesion: 0.08
Nodes (24): GH_TOKEN, jobs, publish, name, permissions, contents, runs-on, steps (+16 more)

### Community 17 - "Plan"
Cohesion: 0.20
Nodes (10): A. Sync & data safety (most important), B. Text box (GoodNotes style), C. Shapes, D. Laser, E. Library, F. Pictures, G. Pages, H. Misc (+2 more)

### Community 18 - "v11.test.js"
Cohesion: 0.29
Nodes (9): findThunderbird(), outlookScript(), powershell(), psQuote(), run(), sendMail(), sendTelegram(), thunderbirdArgs() (+1 more)

### Community 19 - "dependencies"
Cohesion: 0.12
Nodes (21): author, dependencies, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, tesseract.js@^7.0.0, yauzl@^3.4.0 (+13 more)

### Community 20 - "tools.js"
Cohesion: 0.17
Nodes (12): before(), build(), charAt(), highlightStrokes(), layouts, peekLayout(), ready, spanBetween() (+4 more)

### Community 21 - "localbackup.js"
Cohesion: 0.25
Nodes (17): copyFile(), dayOf(), deleteMarked(), entryFor(), findNotebooks(), listSnapshots(), loadIndex(), notebookFiles() (+9 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.20
Nodes (6): compile(), FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 23 - "inkrender.js"
Cohesion: 0.16
Nodes (21): cutClipCache, cutClips(), drawLive(), fillCache, fillPath(), liveCache, livePath(), noiseTile() (+13 more)

### Community 25 - "scan-edit.js"
Cohesion: 0.09
Nodes (49): bestOf(), BLURS, boldLines(), chooseFonts(), CLASSIC, cssFont(), darkShare(), dilateMask() (+41 more)

### Community 26 - "PageView"
Cohesion: 0.10
Nodes (9): drawStrokes(), overlaps(), BitmapCache, contains(), dpr(), intersect(), MAX_ZOOM, MIN_ZOOM (+1 more)

### Community 28 - "geometry.js"
Cohesion: 0.19
Nodes (23): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), densify(), distPointSeg(), distSegRect(), distSegSeg() (+15 more)

### Community 29 - "ref_fs"
Cohesion: 0.08
Nodes (10): pdf-lib, parts, root, local, FILES, checkResult(), meanAlpha(), MODEL (+2 more)

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.17
Nodes (12): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+4 more)

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (9): driveDir, driveFile(), driveIndex(), errors, libDir, out, results, root (+1 more)

### Community 36 - "sync.js"
Cohesion: 0.13
Nodes (19): absInside(), conflictName(), isIgnoredName(), isNotebookJson(), loadState(), md5Buffer(), md5File(), pad() (+11 more)

### Community 38 - "library-view.js"
Cohesion: 0.15
Nodes (21): drawPaper(), drawPaperRegion(), strokePaperLines(), COVER_COLORS, fitTitle(), pageCanvas(), LABEL, templatePicker() (+13 more)

### Community 39 - "editor-panels.js"
Cohesion: 0.06
Nodes (41): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+33 more)

### Community 40 - "cleanup-branches.yml"
Cohesion: 0.15
Nodes (12): runs-on, steps, jobs, delete, name, permissions, contents, branches (+4 more)

### Community 41 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dist:win, graph, start, test

### Community 43 - "Changelog"
Cohesion: 0.09
Nodes (20): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.6.1, 1.7.0 (+12 more)

### Community 45 - "backup.js"
Cohesion: 0.29
Nodes (10): entryStream(), exportLibrary(), exportNotebookArchive(), importLibrary(), openZip(), readEntries(), readManifest(), walk() (+2 more)

### Community 46 - "v14.js"
Cohesion: 0.18
Nodes (7): errors, libDir, out, results, root, tmp, userData

### Community 48 - "win"
Cohesion: 0.40
Nodes (5): win, artifactName, files, icon, target

### Community 49 - "Lessons"
Cohesion: 0.25
Nodes (7): 2026-10-26 (v1.4), 2026-10-30 (v1.5), 2026-10-31 (v1.6), Lessons, v1.6.1, v1.6 review fixes, v1.7

### Community 51 - "StudyNotes – notes for Claude"
Cohesion: 0.50
Nodes (3): Checks, Code map (graphify), StudyNotes – notes for Claude

### Community 52 - "run.js"
Cohesion: 0.28
Nodes (6): check(), main(), mem(), out, results, root

### Community 53 - "extWrite"
Cohesion: 0.24
Nodes (10): buildPdf(), exportTo(), extChanged(), extWrite(), extWriteAll(), openFileRequest(), send(), setupCloud() (+2 more)

### Community 55 - "pen-filter.js"
Cohesion: 0.25
Nodes (3): alpha(), OneEuro, PenFilter

### Community 56 - "v15.js"
Cohesion: 0.18
Nodes (7): errors, libDir, out, results, root, tmp, userData

### Community 57 - "build.js"
Cohesion: 0.33
Nodes (5): esbuild@^0.28.2, esbuild, dist, pdfjs, root

### Community 58 - "Now (v1.4)"
Cohesion: 0.22
Nodes (9): App, Editing, Later (v2), Next (v1.5), Now (v1.4), Pages & look, Review v1.4 (2026-10-26), Sync & Google (+1 more)

### Community 59 - "StudyNotes – GoodNotes-style desktop app for Windows"
Cohesion: 0.22
Nodes (9): Architecture, Decisions (from your answers), Issues found and fixed during verification, Known limits (v1), Not in v1 (possible later), Review (2026-10-19), StudyNotes – GoodNotes-style desktop app for Windows, Tasks (+1 more)

### Community 60 - "v1.6 – plan (2026-10-31)"
Cohesion: 0.50
Nodes (4): Bugs, Features, Release, v1.6 – plan (2026-10-31)

### Community 62 - "todo.md"
Cohesion: 0.29
Nodes (6): 1.7.0 redo #2 – perspective, lighting, bold, handwriting (2026-11-08 evening), 1.7.0 redo – more fonts, "Match the document" (2026-11-08), Review v1.3 (2026-10-20), v1.3 – feature requests (2026-10-20), v1.6.1 – plan (2026-10-31), v1.7.0 – plan (2026-11-08)

### Community 63 - "Review v1.1 (2026-10-19)"
Cohesion: 0.29
Nodes (7): Bugs found and fixed, Decisions (your answers), Not testable here (Windows-only, needs your PC), Plan, Review v1.1 (2026-10-19), v1.1 – feature requests (2026-10-19), Verification

### Community 64 - "v1.5 – plan (2026-10-30)"
Cohesion: 0.33
Nodes (6): From the v1.4 plan, New requests, Publishing, Review v1.5 (2026-10-30), v1.5 – plan (2026-10-30), Verify

### Community 65 - "round2"
Cohesion: 0.20
Nodes (8): placeAt(), scaleLook(), segTouchesRect(), transformItem(), uid(), mapCuts(), round2(), transformStroke()

### Community 69 - "package.json"
Cohesion: 0.17
Nodes (12): devDependencies, electron-builder@^26.15.3, pdfjs-dist@^6.4.299, playwright-core@^1.64.1, @tesseract.js-data/deu@^1.0.0, @tesseract.js-data/eng@^1.0.0, @tesseract.js-data/rus@^1.0.0, electron-builder (+4 more)

### Community 70 - "tools.js"
Cohesion: 0.18
Nodes (15): itemBBox(), textBBox(), turnedBox(), unionBox(), releaseCanvas(), LINE_SHAPES, pointInPolygon(), rectsIntersect() (+7 more)

### Community 72 - "richtext.js"
Cohesion: 0.33
Nodes (10): wrapText(), decode(), ENTITIES, escapeHtml(), layoutRich(), parseRich(), plainFromParas(), plainToHtml() (+2 more)

### Community 73 - "handwriting.js"
Cohesion: 0.42
Nodes (10): encodedScript(), fake(), fakeRecognize(), recognize(), recognizeMany(), recognizers(), runPowerShell(), SCRIPT (+2 more)

### Community 74 - "v17.js"
Cohesion: 0.22
Nodes (7): errors, launch(), ocrUrl(), out, results, root, tmp

### Community 76 - "nsis"
Cohesion: 0.25
Nodes (8): nsis, allowToChangeInstallationDirectory, artifactName, createDesktopShortcut, createStartMenuShortcut, oneClick, perMachine, shortcutName

### Community 82 - "v1.2 – feature requests (2026-10-19)"
Cohesion: 0.50
Nodes (4): Decisions (your answers), Plan, Review v1.2 (2026-10-20), v1.2 – feature requests (2026-10-19)

## Knowledge Gaps
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Editor` connect `Editor` to `Viewer`, `.addPageMenu`, `App`, `editor-panels.js`, `showMenu`, `Thumbs`, `.onKey`, `.renderOptions`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `DriveRemote` be split into smaller, more focused modules?**
  _Cohesion score 0.06527682843472317 - nodes in this community are weakly interconnected._
- **Why does `snapAngle()` connect `geometry.js` to `Tools`, `tools.js`, `tools.js`, `Review v1.1 (2026-10-19)`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08735632183908046 - nodes in this community are weakly interconnected._
- **Why does `Bugs found and fixed` connect `Review v1.1 (2026-10-19)` to `geometry.js`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.06834733893557422 - nodes in this community are weakly interconnected._
- **Should `Library` be split into smaller, more focused modules?**
  _Cohesion score 0.07886904761904762 - nodes in this community are weakly interconnected._