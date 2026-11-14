# Graph Report - studynotes  (2026-11-14)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1832 nodes · 4440 edges · 90 communities (73 shown, 17 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 306 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f40ee3c7`
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
- v161.js
- publish.test.js
- editor-objects.js
- with
- drive.js
- library.js
- dependencies
- .endStroke
- localbackup.js
- FakeDriveApi
- PdfDoc
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
- pdf-text.js
- cleanup-branches.yml
- scripts
- FakeAuth
- Changelog
- Thumbs
- backup.test.js
- v14.js
- ref_node_assert
- spell.js
- CloudSync
- Editor
- StudyNotes – rules for coding agents
- h
- editor-panels.js
- Ocr
- pen-filter.js
- v15.js
- external.js
- app.js
- ref_path
- sync.test.js
- tools.js
- export-content.test.js
- Laser
- run.js
- uid
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
- itemBBox
- notices.js
- ocr-text.test.js

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
- `tmpLib()` --calls--> `Library`  [EXTRACTED]
  test/unit/main/library.test.js → src/main/library.js
- `checkResult()` --calls--> `decodePNG()`  [EXTRACTED]
  test/unit/main/bgremove.test.js → src/main/bgremove.js

## Import Cycles
- 2-file cycle: `src/renderer/fill-sign.js -> src/renderer/tools.js -> src/renderer/fill-sign.js`
- 4-file cycle: `src/renderer/ocr.js -> src/renderer/scan-edit.js -> src/renderer/tools.js -> src/renderer/pdf-text.js -> src/renderer/ocr.js`
- 5-file cycle: `src/renderer/ocr.js -> src/renderer/scan-edit.js -> src/renderer/tools.js -> src/renderer/viewer.js -> src/renderer/pdf-text.js -> src/renderer/ocr.js`

## Communities (90 total, 17 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.16
Nodes (6): decodePath(), DriveError, DriveRemote, q(), rangeEnd(), sleep()

### Community 2 - "main/main.js"
Cohesion: 0.07
Nodes (33): exportNotebookArchive(), fillForm(), { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, clipboard, nativeTheme, safeStorage, net, utilityProcess }, ASSETS, buildPdf(), config, configFile(), createWindow() (+25 more)

### Community 3 - "drawObject"
Cohesion: 0.36
Nodes (9): drawObject(), applyH(), boxWarp(), colourAt(), cssMatrix3d(), homography(), validStops(), assert (+1 more)

### Community 4 - "ocr-bench.js"
Cohesion: 0.15
Nodes (9): CONDS, FONTS, fs, os, out, path, { PDFDocument, StandardFonts }, root (+1 more)

### Community 6 - "inkrender.js"
Cohesion: 0.19
Nodes (18): drawStrokeInk(), cutClipCache, cutClips(), drawLive(), fillCache, fillPath(), liveCache, noiseTile() (+10 more)

### Community 7 - "Library"
Cohesion: 0.10
Nodes (11): atomicWrite(), exists(), firstPageLook(), Library, newId(), readJson(), sanitizeName(), sleep() (+3 more)

### Community 8 - "showMenu"
Cohesion: 0.28
Nodes (7): ALIGN_ICON, ALIGN_NEXT, sizeControl(), swatch(), TextBar, closeMenu(), showMenu()

### Community 9 - "ink.js"
Cohesion: 0.12
Nodes (32): livePath(), sizedPath(), strokePath(), angleBetween(), applyTapers(), bandPiece(), beadOutline(), beadPath() (+24 more)

### Community 10 - "export.js"
Cohesion: 0.10
Nodes (35): contentBBox(), drawContent(), drawImage(), drawInkText(), drawPaper(), drawPolyline(), drawRich(), drawStroke() (+27 more)

### Community 11 - "bgremove.js"
Cohesion: 0.08
Nodes (38): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+30 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, on (+20 more)

### Community 13 - "v161.js"
Cohesion: 0.10
Nodes (22): check(), errors, finish(), fs, results, { execFileSync }, fs, os (+14 more)

### Community 14 - "publish.test.js"
Cohesion: 0.09
Nodes (22): crypto, path, local, crypto, dayOf(), notebookSignatures(), os, pad() (+14 more)

### Community 15 - "editor-objects.js"
Cohesion: 0.09
Nodes (21): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+13 more)

### Community 16 - "with"
Cohesion: 0.08
Nodes (24): GH_TOKEN, jobs, publish, name, on, push, permissions, contents (+16 more)

### Community 17 - "drive.js"
Cohesion: 0.11
Nodes (16): AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), crypto, DONE_PAGE(), encodePath() (+8 more)

### Community 18 - "library.js"
Cohesion: 0.23
Nodes (10): crypto, fs, path, makeSettingsExport(), migrateNotebook(), migratePage(), pageIsEmpty(), readSettingsImport() (+2 more)

### Community 19 - "dependencies"
Cohesion: 0.14
Nodes (14): dependencies, nspell@^2.1.5, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, yauzl@^3.4.0, yazl@^3.3.1 (+6 more)

### Community 20 - ".endStroke"
Cohesion: 0.11
Nodes (16): peekLayout(), TextSelection, underlineStrokes(), unionBox(), isScribble(), before(), charAt(), columnCuts() (+8 more)

### Community 21 - "localbackup.js"
Cohesion: 0.11
Nodes (33): backupRootFor(), copyFile(), crypto, dayOf(), deleteMarked(), entryFor(), findNotebooks(), fs (+25 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.11
Nodes (14): compile(), crypto, FakeDriveApi, json(), md5(), parseMultipart(), unquote(), assert (+6 more)

### Community 23 - "PdfDoc"
Cohesion: 0.21
Nodes (4): CancelError, enqueue(), PdfDoc, pump()

### Community 24 - "toast"
Cohesion: 0.25
Nodes (3): LibraryView, promptDialog(), toast()

### Community 25 - "scan-edit.js"
Cohesion: 0.11
Nodes (42): BLURS, cssFont(), editableRun(), ensureEditable(), ensureOcr(), fontScores(), imageCanvas(), LANGS (+34 more)

### Community 26 - "PageView"
Cohesion: 0.10
Nodes (7): drawStrokes(), overlaps(), BitmapCache, contains(), intersect(), PageView, releaseCanvas()

### Community 27 - "steps"
Cohesion: 0.09
Nodes (23): ONNXRUNTIME_NODE_INSTALL, jobs, linux, windows, env, runs-on, steps, name (+15 more)

### Community 28 - "geometry.js"
Cohesion: 0.12
Nodes (28): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), BOX_SHAPES, densify(), distPointSeg(), distSegRect() (+20 more)

### Community 29 - "ref_fs"
Cohesion: 0.13
Nodes (14): pdf-lib, fs, { PDFDocument, StandardFonts, rgb, degrees }, fs, path, { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup }, readFormFields(), signatures() (+6 more)

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.08
Nodes (25): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+17 more)

### Community 33 - "Tools"
Cohesion: 0.10
Nodes (3): penButton(), segTouchesRect(), Tools

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (10): driveDir, driveFile(), driveIndex(), fs, libDir, os, out, path (+2 more)

### Community 36 - "sync.js"
Cohesion: 0.21
Nodes (16): absInside(), conflictName(), crypto, fs, isIgnoredName(), isNotebookJson(), loadState(), md5Buffer() (+8 more)

### Community 38 - "editor.js"
Cohesion: 0.07
Nodes (46): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+38 more)

### Community 39 - "pdf-text.js"
Cohesion: 0.23
Nodes (10): layoutFromOcr(), recognizePage(), build(), forgetLayouts(), layouts, ready, textLayout(), Util (+2 more)

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
Cohesion: 0.15
Nodes (10): at(), fs, libDir, os, out, path, { PDFDocument }, root (+2 more)

### Community 47 - "ref_node_assert"
Cohesion: 0.11
Nodes (14): assert, remote, test, assert, test, assert, test, assert (+6 more)

### Community 48 - "spell.js"
Cohesion: 0.16
Nodes (15): correctLines(), DIR, fs, known(), load(), path, SAME, TO_CYR (+7 more)

### Community 51 - "StudyNotes – rules for coding agents"
Cohesion: 0.22
Nodes (7): Commands, Private development notes (not in this repository), Project, Rules, StudyNotes – rules for coding agents, Code map (graphify), StudyNotes – notes for Claude

### Community 52 - "h"
Cohesion: 0.17
Nodes (17): cropToInk(), fillBar(), placeNext(), renderFormFields(), signatureDialog(), todayText(), urlFor(), whiteToTransparent() (+9 more)

### Community 53 - "editor-panels.js"
Cohesion: 0.14
Nodes (16): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+8 more)

### Community 54 - "Ocr"
Cohesion: 0.27
Nodes (4): tesseract.js@^7.0.0, tesseract.js, getOcr(), Ocr

### Community 55 - "pen-filter.js"
Cohesion: 0.25
Nodes (3): alpha(), OneEuro, PenFilter

### Community 56 - "v15.js"
Cohesion: 0.17
Nodes (9): fs, libDir, os, out, path, { PDFDocument }, root, tmp (+1 more)

### Community 57 - "external.js"
Cohesion: 0.12
Nodes (25): cleanupExternal(), copyName(), crypto, externalPath(), fs, hasUnwrittenNotes(), idFor(), isExternal() (+17 more)

### Community 58 - "app.js"
Cohesion: 0.10
Nodes (17): playwright-core@^1.64.1, playwright-core, { _electron: electron }, path, root, { execFileSync }, fs, os (+9 more)

### Community 59 - "ref_path"
Cohesion: 0.12
Nodes (14): FILES, fs, path, assert, fs, os, path, { PDFDocument } (+6 more)

### Community 60 - "sync.test.js"
Cohesion: 0.12
Nodes (13): md5File(), assert, crypto, edit(), fs, http, os, path (+5 more)

### Community 61 - "tools.js"
Cohesion: 0.23
Nodes (12): rotPt(), scaleLook(), transformItem(), mapCuts(), round2(), transformStroke(), layerOf(), restack() (+4 more)

### Community 62 - "export-content.test.js"
Cohesion: 0.11
Nodes (13): FONTS, assert, { execFileSync }, fs, path, { PDFDocument, degrees }, ROOT, test (+5 more)

### Community 64 - "run.js"
Cohesion: 0.18
Nodes (11): launch(), assert, check(), { execFileSync }, fs, main(), mem(), os (+3 more)

### Community 69 - "package.json"
Cohesion: 0.13
Nodes (18): author, description, devDependencies, electron-builder@^26.15.3, pdfjs-dist@^6.4.299, @tesseract.js-data/deu@^1.0.0, @tesseract.js-data/eng@^1.0.0, @tesseract.js-data/rus@^1.0.0 (+10 more)

### Community 71 - "screenshots.js"
Cohesion: 0.12
Nodes (10): { _electron: electron }, FRAMES, fs, os, outDir, path, { PDFDocument, StandardFonts, rgb }, rawDir (+2 more)

### Community 72 - "richtext.js"
Cohesion: 0.27
Nodes (12): wrapText(), decode(), ENTITIES, escapeHtml(), layoutRich(), parseRich(), plainFromParas(), plainToHtml() (+4 more)

### Community 73 - "handwriting.js"
Cohesion: 0.29
Nodes (13): encodedScript(), fake(), fakeRecognize(), fs, path, recognize(), recognizeMany(), recognizers() (+5 more)

### Community 74 - "v17.js"
Cohesion: 0.20
Nodes (7): fs, os, out, path, { PDFDocument, StandardFonts }, root, tmp

### Community 75 - "scan-geo.js"
Cohesion: 0.29
Nodes (9): lineLight(), lineWarp(), pageWarps(), renderMask(), bandFit(), ownInk(), shearOf(), assert (+1 more)

### Community 76 - "scan-clean.js"
Cohesion: 0.28
Nodes (11): clampBox(), cleanLines(), dilate(), inkColor(), inpaint(), lineInk(), lum(), normalizeLight() (+3 more)

### Community 77 - "v16.js"
Cohesion: 0.20
Nodes (7): fs, os, out, path, { PDFDocument, StandardFonts }, root, tmp

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

### Community 87 - "itemBBox"
Cohesion: 0.31
Nodes (7): itemBBox(), textBBox(), turnedBox(), pointInPolygon(), rectsIntersect(), resample(), strokeInLasso()

### Community 88 - "notices.js"
Cohesion: 0.29
Nodes (4): fs, parts, path, root

### Community 89 - "ocr-text.test.js"
Cohesion: 0.47
Nodes (4): editDistance(), googleLine(), assert, test

## Knowledge Gaps
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Editor` connect `Editor` to `Viewer`, `.pageMenu`, `.setPageData`, `App`, `.constructor`, `editor.js`, `Thumbs`, `h`, `editor-panels.js`, `PageView`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Should `Viewer` be split into smaller, more focused modules?**
  _Cohesion score 0.14864864864864866 - nodes in this community are weakly interconnected._
- **Why does `Tools` connect `Tools` to `uid`, `.constructor`, `editor.js`, `.endStroke`, `itemBBox`, `PageView`, `tools.js`, `Laser`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Why does `pdf-lib` connect `ref_fs` to `ocr-bench.js`, `package.json`, `screenshots.js`, `export.js`, `v17.js`, `v16.js`, `v14.js`, `v161.js`, `v17b.js`, `dependencies`, `export.test.js`, `editor-panels.js`, `v15.js`, `external.js`, `ref_path`, `export-content.test.js`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.11605937921727395 - nodes in this community are weakly interconnected._
- **Should `Library` be split into smaller, more focused modules?**
  _Cohesion score 0.10083256244218317 - nodes in this community are weakly interconnected._