# Graph Report - studynotes  (2026-11-14)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1868 nodes · 4514 edges · 99 communities (79 shown, 20 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 310 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4c4941c4`
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
- ocr-golden.test.js
- library.js
- package.json
- .endStroke
- localbackup.js
- FakeDriveApi
- PenFilter
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
- editor.js
- Editor
- StudyNotes – rules for coding agents
- h
- editor-panels.js
- Ocr
- pen-filter.js
- v15.js
- external.js
- app.js
- pdfdoc.js
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
- tools.js
- ref_fs
- drive-sync.test.js
- BitmapCache
- fill-sign.js
- ref_os
- .selectionToolbar
- fonts.test.js
- shared-guard.test.js
- paintStroke
- library-assets.test.js

## God Nodes (most connected - your core abstractions)
1. `Editor` - 95 edges
2. `Tools` - 77 edges
3. `h()` - 77 edges
4. `editableRun()` - 46 edges
5. `Library` - 45 edges
6. `App` - 43 edges
7. `toast()` - 42 edges
8. `Viewer` - 37 edges
9. `icon()` - 37 edges
10. `DriveRemote` - 32 edges

## Surprising Connections (you probably didn't know these)
- `replay()` --calls--> `narrowLangs()`  [EXTRACTED]
  test/unit/shared/ocr-golden.test.js → src/shared/scan-text.js
- `replay()` --calls--> `skewOf()`  [EXTRACTED]
  test/unit/shared/ocr-golden.test.js → src/shared/scan-text.js
- `setup()` --calls--> `syncLibrary()`  [EXTRACTED]
  test/unit/main/sync.test.js → src/main/sync.js
- `fix()` --calls--> `correctLines()`  [EXTRACTED]
  test/unit/main/spell.test.js → src/main/spell.js
- `ids()` --calls--> `stacked()`  [EXTRACTED]
  test/unit/shared/stacking.test.js → src/shared/stacking.js

## Import Cycles
- 2-file cycle: `src/renderer/fill-sign.js -> src/renderer/tools.js -> src/renderer/fill-sign.js`
- 4-file cycle: `src/renderer/ocr.js -> src/renderer/scan-edit.js -> src/renderer/tools.js -> src/renderer/pdf-text.js -> src/renderer/ocr.js`
- 5-file cycle: `src/renderer/ocr.js -> src/renderer/scan-edit.js -> src/renderer/tools.js -> src/renderer/viewer.js -> src/renderer/pdf-text.js -> src/renderer/ocr.js`

## Communities (99 total, 20 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.06
Nodes (23): CloudSync, AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), crypto, decodePath() (+15 more)

### Community 2 - "main/main.js"
Cohesion: 0.07
Nodes (33): exportNotebookArchive(), fillForm(), { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, clipboard, nativeTheme, safeStorage, net, utilityProcess }, ASSETS, buildPdf(), config, configFile(), createWindow() (+25 more)

### Community 3 - "drawObject"
Cohesion: 0.36
Nodes (8): applyH(), boxWarp(), colourAt(), cssMatrix3d(), homography(), validStops(), assert, test

### Community 4 - "ocr-bench.js"
Cohesion: 0.14
Nodes (11): CONDS, FONTS, fs, goldenFile, os, out, path, { PDFDocument, StandardFonts } (+3 more)

### Community 6 - "inkrender.js"
Cohesion: 0.14
Nodes (18): cutClipCache, drawLive(), drawStrokes(), fillCache, fillPath(), liveCache, livePath(), noiseTile() (+10 more)

### Community 7 - "Library"
Cohesion: 0.10
Nodes (11): atomicWrite(), exists(), firstPageLook(), Library, newId(), readJson(), sanitizeName(), sleep() (+3 more)

### Community 8 - "showMenu"
Cohesion: 0.19
Nodes (9): ALIGN_ICON, ALIGN_NEXT, sizeControl(), swatch(), TEXT_SIZES, TextBar, closeMenu(), showMenu() (+1 more)

### Community 9 - "ink.js"
Cohesion: 0.15
Nodes (26): angleBetween(), applyTapers(), bandPiece(), beadOutline(), beadPath(), catmull(), ccw(), circlePiece() (+18 more)

### Community 10 - "export.js"
Cohesion: 0.12
Nodes (34): drawContent(), drawImage(), drawInkText(), drawObject(), drawPaper(), drawPolyline(), drawRich(), drawStroke() (+26 more)

### Community 11 - "bgremove.js"
Cohesion: 0.08
Nodes (38): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+30 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, on (+20 more)

### Community 13 - "report.js"
Cohesion: 0.13
Nodes (19): check(), errors, finish(), fs, results, fs, os, PAGES (+11 more)

### Community 14 - "publish.test.js"
Cohesion: 0.15
Nodes (16): crypto, dayOf(), notebookSignatures(), os, pad(), path, publish(), assert (+8 more)

### Community 15 - "editor-objects.js"
Cohesion: 0.09
Nodes (21): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+13 more)

### Community 16 - "with"
Cohesion: 0.08
Nodes (24): GH_TOKEN, jobs, publish, name, on, push, permissions, contents (+16 more)

### Community 17 - "ocr-golden.test.js"
Cohesion: 0.19
Nodes (12): paragraphs(), escHtml(), fixUmlauts(), joinParagraphs(), assert, dir, expectFile, fs (+4 more)

### Community 18 - "library.js"
Cohesion: 0.23
Nodes (10): crypto, fs, path, makeSettingsExport(), migrateNotebook(), migratePage(), pageIsEmpty(), readSettingsImport() (+2 more)

### Community 19 - "package.json"
Cohesion: 0.11
Nodes (23): author, dependencies, nspell@^2.1.5, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, tesseract.js@^7.0.0 (+15 more)

### Community 20 - ".endStroke"
Cohesion: 0.12
Nodes (20): layoutFromOcr(), build(), forgetLayouts(), layouts, peekLayout(), ready, textLayout(), TextSelection (+12 more)

### Community 21 - "localbackup.js"
Cohesion: 0.11
Nodes (33): backupRootFor(), copyFile(), crypto, dayOf(), deleteMarked(), entryFor(), findNotebooks(), fs (+25 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.19
Nodes (7): compile(), crypto, FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 24 - "toast"
Cohesion: 0.25
Nodes (3): LibraryView, promptDialog(), toast()

### Community 25 - "scan-edit.js"
Cohesion: 0.11
Nodes (37): BLURS, cssFont(), editableRun(), ensureEditable(), ensureOcr(), fontScores(), imageCanvas(), LANGS (+29 more)

### Community 26 - "PageView"
Cohesion: 0.17
Nodes (5): isCancel(), contains(), dpr(), intersect(), PageView

### Community 27 - "steps"
Cohesion: 0.09
Nodes (23): ONNXRUNTIME_NODE_INSTALL, jobs, linux, windows, env, runs-on, steps, name (+15 more)

### Community 28 - "geometry.js"
Cohesion: 0.13
Nodes (26): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), BOX_SHAPES, densify(), distPointSeg(), distSegRect() (+18 more)

### Community 29 - "ref_fs"
Cohesion: 0.16
Nodes (11): fs, path, { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup }, readFormFields(), signatures(), sigStore(), assert, fs (+3 more)

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.08
Nodes (25): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+17 more)

### Community 33 - "Tools"
Cohesion: 0.10
Nodes (5): penButton(), Tools, uid(), mapCuts(), round2()

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (10): driveDir, driveFile(), driveIndex(), fs, libDir, os, out, path (+2 more)

### Community 36 - "sync.js"
Cohesion: 0.21
Nodes (16): absInside(), conflictName(), crypto, fs, isIgnoredName(), isNotebookJson(), loadState(), md5Buffer() (+8 more)

### Community 38 - "editor.js"
Cohesion: 0.27
Nodes (11): icon(), P, debounce(), describeKey(), iconButton(), keySignature(), shortcutKey(), maybeShowWhatsNew() (+3 more)

### Community 39 - "renderer/ocr.js"
Cohesion: 0.27
Nodes (8): recognizePage(), pngBlob(), readWithGoogle(), recognizeSized(), linesFrom(), r2(), editDistance(), googleLine()

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
Cohesion: 0.15
Nodes (9): assert, remote, test, assert, test, assert, test, assert (+1 more)

### Community 48 - "spell.js"
Cohesion: 0.16
Nodes (15): correctLines(), DIR, fs, known(), load(), path, SAME, TO_CYR (+7 more)

### Community 49 - "editor.js"
Cohesion: 0.08
Nodes (35): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+27 more)

### Community 51 - "StudyNotes – rules for coding agents"
Cohesion: 0.22
Nodes (7): Commands, Private development notes (not in this repository), Project, Rules, StudyNotes – rules for coding agents, Code map (graphify), StudyNotes – notes for Claude

### Community 52 - "h"
Cohesion: 0.20
Nodes (5): templatePicker(), thumbCanvas(), confirmDialog(), h(), modal()

### Community 53 - "editor-panels.js"
Cohesion: 0.14
Nodes (16): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+8 more)

### Community 55 - "pen-filter.js"
Cohesion: 0.25
Nodes (4): alpha(), OneEuro, assert, test

### Community 56 - "v15.js"
Cohesion: 0.17
Nodes (9): fs, libDir, os, out, path, { PDFDocument }, root, tmp (+1 more)

### Community 57 - "external.js"
Cohesion: 0.12
Nodes (25): cleanupExternal(), copyName(), crypto, externalPath(), fs, hasUnwrittenNotes(), idFor(), isExternal() (+17 more)

### Community 58 - "app.js"
Cohesion: 0.11
Nodes (15): { _electron: electron }, path, root, { execFileSync }, fs, os, out, path (+7 more)

### Community 59 - "pdfdoc.js"
Cohesion: 0.18
Nodes (6): CancelError, enqueue(), PdfDoc, pump(), queue, Util

### Community 60 - "sync.test.js"
Cohesion: 0.12
Nodes (13): md5File(), assert, crypto, edit(), fs, http, os, path (+5 more)

### Community 61 - "tools.js"
Cohesion: 0.21
Nodes (8): transformItem(), transformStroke(), layerOf(), restack(), stacked(), assert, ids(), test

### Community 62 - "export-content.test.js"
Cohesion: 0.18
Nodes (8): contentBBox(), assert, { execFileSync }, fs, path, { PDFDocument, degrees }, ROOT, test

### Community 64 - "run.js"
Cohesion: 0.18
Nodes (11): launch(), assert, check(), { execFileSync }, fs, main(), mem(), os (+3 more)

### Community 65 - "v161.js"
Cohesion: 0.20
Nodes (7): fs, os, out, path, { PDFDocument, StandardFonts }, root, tmp

### Community 69 - "package.json"
Cohesion: 0.15
Nodes (13): devDependencies, electron-builder@^26.15.3, pdfjs-dist@^6.4.299, playwright-core@^1.64.1, @tesseract.js-data/deu@^1.0.0, @tesseract.js-data/eng@^1.0.0, @tesseract.js-data/rus@^1.0.0, electron-builder (+5 more)

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
Cohesion: 0.14
Nodes (20): clampBox(), cleanLines(), dilate(), inkColor(), inpaint(), letterInk(), lineInk(), longRuns() (+12 more)

### Community 77 - "v16.js"
Cohesion: 0.18
Nodes (8): at(), fs, os, out, path, { PDFDocument, StandardFonts }, root, tmp

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
Cohesion: 0.14
Nodes (9): pdf-lib, fs, { PDFDocument, StandardFonts, rgb, degrees }, assert, FONT, fs, path, { PDFDocument, degrees } (+1 more)

### Community 85 - "library-pages.test.js"
Cohesion: 0.27
Nodes (9): assert, bump(), fs, library(), os, path, test, tmp() (+1 more)

### Community 86 - "build.js"
Cohesion: 0.20
Nodes (9): esbuild@^0.28.2, esbuild, dist, esbuild, { fontFaceCss }, fs, path, pdfjs (+1 more)

### Community 87 - "tools.js"
Cohesion: 0.17
Nodes (14): placeAt(), itemBBox(), rotPt(), segTouchesRect(), textBBox(), turnedBox(), unionBox(), isScribble() (+6 more)

### Community 88 - "ref_fs"
Cohesion: 0.09
Nodes (18): fs, parts, path, root, crypto, path, local, FILES (+10 more)

### Community 89 - "drive-sync.test.js"
Cohesion: 0.20
Nodes (7): assert, bump(), fs, os, path, test, write()

### Community 91 - "fill-sign.js"
Cohesion: 0.36
Nodes (9): cropToInk(), fillBar(), loadFormFields(), placeNext(), renderFormFields(), signatureDialog(), todayText(), urlFor() (+1 more)

### Community 92 - "ref_os"
Cohesion: 0.22
Nodes (7): CONDS, fs, N, os, path, TEXT, tmp

### Community 94 - "fonts.test.js"
Cohesion: 0.33
Nodes (5): assert, fs, path, ROOT, test

### Community 95 - "shared-guard.test.js"
Cohesion: 0.33
Nodes (5): assert, dir, fs, path, test

### Community 97 - "paintStroke"
Cohesion: 0.25
Nodes (8): withCuts(), cutClips(), paintFill(), paintStroke(), capsulePolygon(), isClosedShape(), lighten(), strokeLook()

### Community 98 - "library-assets.test.js"
Cohesion: 0.25
Nodes (6): assert, fs, os, path, { PDFDocument }, test

## Knowledge Gaps
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pdf-lib` connect `export.test.js` to `v161.js`, `library-assets.test.js`, `ocr-bench.js`, `screenshots.js`, `export.js`, `v17.js`, `v16.js`, `v14.js`, `v17b.js`, `package.json`, `editor-panels.js`, `v15.js`, `external.js`, `ref_fs`, `export-content.test.js`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Should `DriveRemote` be split into smaller, more focused modules?**
  _Cohesion score 0.05708548479632817 - nodes in this community are weakly interconnected._
- **Why does `Viewer` connect `Viewer` to `.setPageData`, `BitmapCache`, `.constructor`, `editor.js`, `PageView`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Why does `pdfjs-dist` connect `package.json` to `pdfdoc.js`, `package.json`, `export.test.js`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Should `ocr-bench.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.13709677419354838 - nodes in this community are weakly interconnected._