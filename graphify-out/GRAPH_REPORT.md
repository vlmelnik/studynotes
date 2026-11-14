# Graph Report - studynotes  (2026-11-14)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1854 nodes · 4484 edges · 97 communities (79 shown, 18 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 309 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a7396f73`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- ink.js
- export.js
- bgremove.js
- with
- report.js
- publish.test.js
- editor-objects.js
- with
- scan-text.js
- library.js
- dependencies
- .endStroke
- localbackup.js
- FakeDriveApi
- .onMove
- toast
- scan-edit.js
- PageView
- steps
- geometry.js
- ref_fs
- FakeRemote
- i18n.js
- build
- Tools
- v13.js
- sync.js
- editor.js
- renderer/ocr.js
- cleanup-branches.yml
- scripts
- FakeAuth
- Changelog
- Thumbs
- backup.test.js
- v14.js
- ref_node_assert
- spell.js
- library-view.js
- Editor
- StudyNotes – rules for coding agents
- h
- editor-panels.js
- Ocr
- pen-filter.js
- v15.js
- external.js
- app.js
- ocr.test.js
- sync.test.js
- tools.js
- export-content.test.js
- Laser
- run.js
- v161.js
- release-notes.md
- package.json
- screenshots.js
- richtext.js
- handwriting.js
- v17.js
- scan-geo.js
- scan-clean.js
- v16.js
- scan-layout.js
- FakeRemote
- electron
- ink-recognize.ps1
- v17b.js
- send.js
- export.test.js
- library-pages.test.js
- build.js
- .select
- ref_fs
- drive-sync.test.js
- BitmapCache
- fill-sign.js
- ref_os
- fonts.test.js
- shared-guard.test.js
- fonts.js

## God Nodes (most connected - your core abstractions)
1. `Editor` - 95 edges
2. `Tools` - 77 edges
3. `h()` - 77 edges
4. `Library` - 45 edges
5. `editableRun()` - 44 edges
6. `App` - 43 edges
7. `toast()` - 42 edges
8. `Viewer` - 37 edges
9. `icon()` - 37 edges
10. `DriveRemote` - 32 edges

## Surprising Connections (you probably didn't know these)
- `setup()` --calls--> `syncLibrary()`  [EXTRACTED]
  test/unit/main/sync.test.js → src/main/sync.js
- `fix()` --calls--> `correctLines()`  [EXTRACTED]
  test/unit/main/spell.test.js → src/main/spell.js
- `ids()` --calls--> `stacked()`  [EXTRACTED]
  test/unit/shared/stacking.test.js → src/shared/stacking.js
- `openLibrary()` --calls--> `Library`  [EXTRACTED]
  src/main/main.js → src/main/library.js
- `tmpLib()` --calls--> `Library`  [EXTRACTED]
  test/unit/main/library.test.js → src/main/library.js

## Import Cycles
- 2-file cycle: `src/renderer/fill-sign.js -> src/renderer/tools.js -> src/renderer/fill-sign.js`
- 4-file cycle: `src/renderer/ocr.js -> src/renderer/scan-edit.js -> src/renderer/tools.js -> src/renderer/pdf-text.js -> src/renderer/ocr.js`
- 5-file cycle: `src/renderer/ocr.js -> src/renderer/scan-edit.js -> src/renderer/tools.js -> src/renderer/viewer.js -> src/renderer/pdf-text.js -> src/renderer/ocr.js`

## Communities (97 total, 18 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.06
Nodes (23): CloudSync, AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), crypto, decodePath() (+15 more)

### Community 2 - "main/main.js"
Cohesion: 0.06
Nodes (39): exportNotebookArchive(), fillForm(), { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, clipboard, nativeTheme, safeStorage, net, utilityProcess }, ASSETS, backupDir(), buildPdf(), config, configFile() (+31 more)

### Community 3 - "drawObject"
Cohesion: 0.36
Nodes (9): drawObject(), applyH(), boxWarp(), colourAt(), cssMatrix3d(), homography(), validStops(), assert (+1 more)

### Community 4 - "ocr-bench.js"
Cohesion: 0.14
Nodes (11): CONDS, FONTS, fs, goldenFile, os, out, path, { PDFDocument, StandardFonts } (+3 more)

### Community 5 - "App"
Cohesion: 0.13
Nodes (3): defaultToolState(), App, encodeRel()

### Community 6 - "inkrender.js"
Cohesion: 0.13
Nodes (26): cutClipCache, cutClips(), drawLive(), drawStrokes(), fillCache, fillPath(), liveCache, livePath() (+18 more)

### Community 7 - "Library"
Cohesion: 0.11
Nodes (8): atomicWrite(), exists(), Library, newId(), readJson(), sanitizeName(), uniqueChild(), tmpLib()

### Community 8 - "showMenu"
Cohesion: 0.25
Nodes (7): ALIGN_ICON, ALIGN_NEXT, sizeControl(), swatch(), TextBar, closeMenu(), showMenu()

### Community 9 - "ink.js"
Cohesion: 0.14
Nodes (27): angleBetween(), applyTapers(), bandPiece(), beadOutline(), beadPath(), catmull(), ccw(), circlePiece() (+19 more)

### Community 10 - "export.js"
Cohesion: 0.10
Nodes (36): contentBBox(), drawContent(), drawImage(), drawInkText(), drawPaper(), drawPolyline(), drawRich(), drawStroke() (+28 more)

### Community 11 - "bgremove.js"
Cohesion: 0.08
Nodes (38): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+30 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, on (+20 more)

### Community 13 - "report.js"
Cohesion: 0.14
Nodes (17): check(), errors, finish(), fs, results, { execFileSync }, fs, os (+9 more)

### Community 14 - "publish.test.js"
Cohesion: 0.24
Nodes (9): assert, bump(), fs, library(), os, path, test, tmp() (+1 more)

### Community 15 - "editor-objects.js"
Cohesion: 0.09
Nodes (21): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+13 more)

### Community 16 - "with"
Cohesion: 0.08
Nodes (24): GH_TOKEN, jobs, publish, name, on, push, permissions, contents (+16 more)

### Community 17 - "scan-text.js"
Cohesion: 0.13
Nodes (23): paragraphs(), darkShare(), dilateMask(), escHtml(), fixUmlauts(), invert(), invertHex(), isDark() (+15 more)

### Community 18 - "library.js"
Cohesion: 0.18
Nodes (13): crypto, firstPageLook(), fs, path, sleep(), makeSettingsExport(), migrateNotebook(), migratePage() (+5 more)

### Community 19 - "dependencies"
Cohesion: 0.17
Nodes (12): dependencies, nspell@^2.1.5, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, perfect-freehand@^1.2.3, yauzl@^3.4.0, yazl@^3.3.1, nspell (+4 more)

### Community 20 - ".endStroke"
Cohesion: 0.12
Nodes (20): layoutFromOcr(), build(), forgetLayouts(), layouts, peekLayout(), ready, textLayout(), TextSelection (+12 more)

### Community 21 - "localbackup.js"
Cohesion: 0.12
Nodes (30): backupRootFor(), copyFile(), crypto, dayOf(), deleteMarked(), entryFor(), findNotebooks(), fs (+22 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.19
Nodes (7): compile(), crypto, FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 23 - ".onMove"
Cohesion: 0.16
Nodes (3): penButton(), segTouchesRect(), PenFilter

### Community 24 - "toast"
Cohesion: 0.25
Nodes (3): LibraryView, promptDialog(), toast()

### Community 25 - "scan-edit.js"
Cohesion: 0.13
Nodes (28): BLURS, cssFont(), editableRun(), ensureEditable(), ensureOcr(), fontScores(), imageCanvas(), LANGS (+20 more)

### Community 26 - "PageView"
Cohesion: 0.08
Nodes (15): drawPaperRegion(), CancelError, enqueue(), isCancel(), PdfDoc, pump(), queue, Util (+7 more)

### Community 27 - "steps"
Cohesion: 0.09
Nodes (23): ONNXRUNTIME_NODE_INSTALL, jobs, linux, windows, env, runs-on, steps, name (+15 more)

### Community 28 - "geometry.js"
Cohesion: 0.11
Nodes (30): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), BOX_SHAPES, densify(), distPointSeg(), distSegRect() (+22 more)

### Community 29 - "ref_fs"
Cohesion: 0.14
Nodes (13): @pdf-lib/fontkit@^1.1.1, @pdf-lib/fontkit, fs, path, { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup }, readFormFields(), signatures(), sigStore() (+5 more)

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.08
Nodes (25): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+17 more)

### Community 33 - "Tools"
Cohesion: 0.10
Nodes (3): placeAt(), Tools, uid()

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (10): driveDir, driveFile(), driveIndex(), fs, libDir, os, out, path (+2 more)

### Community 36 - "sync.js"
Cohesion: 0.21
Nodes (16): absInside(), conflictName(), crypto, fs, isIgnoredName(), isNotebookJson(), loadState(), md5Buffer() (+8 more)

### Community 38 - "editor.js"
Cohesion: 0.12
Nodes (24): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+16 more)

### Community 39 - "renderer/ocr.js"
Cohesion: 0.60
Nodes (4): recognizePage(), recognizeSized(), linesFrom(), r2()

### Community 40 - "cleanup-branches.yml"
Cohesion: 0.15
Nodes (12): runs-on, steps, jobs, delete, name, on, push, permissions (+4 more)

### Community 41 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dist:win, graph, start, test, test:all, test:e2e (+2 more)

### Community 43 - "Changelog"
Cohesion: 0.09
Nodes (20): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.6.1, 1.7.0 (+12 more)

### Community 45 - "backup.test.js"
Cohesion: 0.11
Nodes (22): entryStream(), exportLibrary(), fs, importLibrary(), openZip(), path, readEntries(), readManifest() (+14 more)

### Community 46 - "v14.js"
Cohesion: 0.17
Nodes (9): fs, libDir, os, out, path, { PDFDocument }, root, tmp (+1 more)

### Community 47 - "ref_node_assert"
Cohesion: 0.13
Nodes (11): assert, remote, test, assert, test, assert, test, assert (+3 more)

### Community 48 - "spell.js"
Cohesion: 0.16
Nodes (15): correctLines(), DIR, fs, known(), load(), path, SAME, TO_CYR (+7 more)

### Community 49 - "library-view.js"
Cohesion: 0.19
Nodes (15): drawPaper(), COVER_COLORS, fitTitle(), pageCanvas(), LABEL, templatePicker(), thumbCanvas(), formatDate() (+7 more)

### Community 51 - "StudyNotes – rules for coding agents"
Cohesion: 0.22
Nodes (7): Commands, Private development notes (not in this repository), Project, Rules, StudyNotes – rules for coding agents, Code map (graphify), StudyNotes – notes for Claude

### Community 52 - "h"
Cohesion: 0.25
Nodes (3): confirmDialog(), h(), modal()

### Community 53 - "editor-panels.js"
Cohesion: 0.14
Nodes (16): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+8 more)

### Community 54 - "Ocr"
Cohesion: 0.27
Nodes (4): tesseract.js@^7.0.0, tesseract.js, getOcr(), Ocr

### Community 56 - "v15.js"
Cohesion: 0.17
Nodes (9): fs, libDir, os, out, path, { PDFDocument }, root, tmp (+1 more)

### Community 57 - "external.js"
Cohesion: 0.14
Nodes (23): cleanupExternal(), copyName(), crypto, externalPath(), fs, hasUnwrittenNotes(), idFor(), isExternal() (+15 more)

### Community 58 - "app.js"
Cohesion: 0.18
Nodes (9): { _electron: electron }, path, root, { execFileSync }, fs, os, out, path (+1 more)

### Community 59 - "ocr.test.js"
Cohesion: 0.22
Nodes (8): FILES, fs, path, assert, fs, os, path, test

### Community 60 - "sync.test.js"
Cohesion: 0.12
Nodes (13): md5File(), assert, crypto, edit(), fs, http, os, path (+5 more)

### Community 61 - "tools.js"
Cohesion: 0.21
Nodes (13): rotPt(), scaleLook(), transformItem(), turnedBox(), mapCuts(), round2(), transformStroke(), layerOf() (+5 more)

### Community 62 - "export-content.test.js"
Cohesion: 0.20
Nodes (7): assert, { execFileSync }, fs, path, { PDFDocument, degrees }, ROOT, test

### Community 64 - "run.js"
Cohesion: 0.18
Nodes (11): launch(), assert, check(), { execFileSync }, fs, main(), mem(), os (+3 more)

### Community 65 - "v161.js"
Cohesion: 0.14
Nodes (10): pdf-lib, fs, { PDFDocument, StandardFonts, rgb, degrees }, fs, os, out, path, { PDFDocument, StandardFonts } (+2 more)

### Community 69 - "package.json"
Cohesion: 0.12
Nodes (20): author, description, devDependencies, electron-builder@^26.15.3, pdfjs-dist@^6.4.299, playwright-core@^1.64.1, @tesseract.js-data/deu@^1.0.0, @tesseract.js-data/eng@^1.0.0 (+12 more)

### Community 71 - "screenshots.js"
Cohesion: 0.12
Nodes (10): { _electron: electron }, FRAMES, fs, os, outDir, path, { PDFDocument, StandardFonts, rgb }, rawDir (+2 more)

### Community 72 - "richtext.js"
Cohesion: 0.27
Nodes (12): wrapText(), decode(), ENTITIES, escapeHtml(), layoutRich(), parseRich(), plainFromParas(), plainToHtml() (+4 more)

### Community 73 - "handwriting.js"
Cohesion: 0.20
Nodes (15): encodedScript(), fake(), fakeRecognize(), fs, path, recognize(), recognizeMany(), recognizers() (+7 more)

### Community 74 - "v17.js"
Cohesion: 0.20
Nodes (7): fs, os, out, path, { PDFDocument, StandardFonts }, root, tmp

### Community 75 - "scan-geo.js"
Cohesion: 0.29
Nodes (9): lineLight(), lineWarp(), pageWarps(), renderMask(), bandFit(), ownInk(), shearOf(), assert (+1 more)

### Community 76 - "scan-clean.js"
Cohesion: 0.14
Nodes (20): clampBox(), cleanLines(), dilate(), inkColor(), inpaint(), letterInk(), lineInk(), longRuns() (+12 more)

### Community 77 - "v16.js"
Cohesion: 0.13
Nodes (12): at(), { execFileSync }, fs, os, path, fs, os, out (+4 more)

### Community 78 - "scan-layout.js"
Cohesion: 0.24
Nodes (9): besideMark(), combineBoxes(), esc(), graphicMarks(), lum(), r2(), underlinedWords(), assert (+1 more)

### Community 80 - "electron"
Cohesion: 0.40
Nodes (3): electron@^44.9.0, electron, { contextBridge, ipcRenderer, webUtils }

### Community 82 - "v17b.js"
Cohesion: 0.18
Nodes (8): fs, LINES, os, out, path, { PDFDocument, StandardFonts }, root, tmp

### Community 83 - "send.js"
Cohesion: 0.25
Nodes (13): { execFile }, findThunderbird(), fs, outlookScript(), path, powershell(), psQuote(), run() (+5 more)

### Community 84 - "export.test.js"
Cohesion: 0.20
Nodes (6): assert, FONT, fs, path, { PDFDocument, degrees }, test

### Community 85 - "library-pages.test.js"
Cohesion: 0.27
Nodes (9): assert, bump(), fs, library(), os, path, test, tmp() (+1 more)

### Community 86 - "build.js"
Cohesion: 0.20
Nodes (9): esbuild@^0.28.2, esbuild, dist, esbuild, { fontFaceCss }, fs, path, pdfjs (+1 more)

### Community 87 - ".select"
Cohesion: 0.33
Nodes (7): itemBBox(), textBBox(), unionBox(), releaseCanvas(), pointInPolygon(), strokeBBox(), strokeInLasso()

### Community 88 - "ref_fs"
Cohesion: 0.09
Nodes (16): fs, parts, path, root, crypto, path, local, crypto (+8 more)

### Community 89 - "drive-sync.test.js"
Cohesion: 0.20
Nodes (7): assert, bump(), fs, os, path, test, write()

### Community 91 - "fill-sign.js"
Cohesion: 0.36
Nodes (9): cropToInk(), fillBar(), loadFormFields(), placeNext(), renderFormFields(), signatureDialog(), todayText(), urlFor() (+1 more)

### Community 92 - "ref_os"
Cohesion: 0.31
Nodes (7): crypto, dayOf(), notebookSignatures(), os, pad(), path, publish()

### Community 94 - "fonts.test.js"
Cohesion: 0.33
Nodes (5): assert, fs, path, ROOT, test

### Community 95 - "shared-guard.test.js"
Cohesion: 0.33
Nodes (5): assert, dir, fs, path, test

## Knowledge Gaps
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Editor` connect `Editor` to `Viewer`, `.toast`, `.setPageData`, `App`, `.constructor`, `editor.js`, `editor-panels.js`, `BitmapCache`, `.runOcr`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `DriveRemote` be split into smaller, more focused modules?**
  _Cohesion score 0.05708548479632817 - nodes in this community are weakly interconnected._
- **Why does `pdf-lib` connect `v161.js` to `ocr-bench.js`, `package.json`, `screenshots.js`, `export.js`, `v17.js`, `v16.js`, `v14.js`, `v17b.js`, `dependencies`, `export.test.js`, `editor-panels.js`, `v15.js`, `external.js`, `ref_fs`, `ref_fs`, `export-content.test.js`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06086956521739131 - nodes in this community are weakly interconnected._
- **Why does `Viewer` connect `Viewer` to `.setPageData`, `BitmapCache`, `.constructor`, `editor.js`, `PageView`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Should `ocr-bench.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.13068181818181818 - nodes in this community are weakly interconnected._