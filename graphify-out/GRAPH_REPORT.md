# Graph Report - studynotes  (2026-11-14)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1862 nodes · 4533 edges · 88 communities (72 shown, 16 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 310 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5fa40882`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Viewer
- DriveRemote
- main/main.js
- scan-geo.js
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
- .toast
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
- cloud.js
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
- notices.js
- editor-panels.js
- Ocr
- PenFilter
- v15.js
- external.js
- ocr-text.test.js
- sync.test.js
- tools.js
- Laser
- run.js
- release-notes.md
- package.json
- screenshots.js
- richtext.js
- handwriting.js
- v17.js
- scan-clean.js
- v16.js
- scan-layout.js
- FakeRemote
- electron
- ink-recognize.ps1
- send.js
- export.test.js
- library-pages.test.js
- build.js
- .select
- ref_path
- drive-sync.test.js
- editor.js
- shared-guard.test.js

## God Nodes (most connected - your core abstractions)
1. `Editor` - 95 edges
2. `Tools` - 77 edges
3. `h()` - 77 edges
4. `editableRun()` - 48 edges
5. `Library` - 45 edges
6. `App` - 43 edges
7. `toast()` - 42 edges
8. `Viewer` - 37 edges
9. `icon()` - 37 edges
10. `DriveRemote` - 32 edges

## Surprising Connections (you probably didn't know these)
- `replay()` --calls--> `joinParagraphs()`  [EXTRACTED]
  test/unit/shared/ocr-golden.test.js → src/shared/scan-text.js
- `replay()` --calls--> `narrowLangs()`  [EXTRACTED]
  test/unit/shared/ocr-golden.test.js → src/shared/scan-text.js
- `replay()` --calls--> `skewOf()`  [EXTRACTED]
  test/unit/shared/ocr-golden.test.js → src/shared/scan-text.js
- `setup()` --calls--> `syncLibrary()`  [EXTRACTED]
  test/unit/main/sync.test.js → src/main/sync.js
- `fix()` --calls--> `correctLines()`  [EXTRACTED]
  test/unit/main/spell.test.js → src/main/spell.js

## Import Cycles
- 2-file cycle: `src/renderer/fill-sign.js -> src/renderer/tools.js -> src/renderer/fill-sign.js`
- 4-file cycle: `src/renderer/ocr.js -> src/renderer/scan-edit.js -> src/renderer/tools.js -> src/renderer/pdf-text.js -> src/renderer/ocr.js`
- 5-file cycle: `src/renderer/ocr.js -> src/renderer/scan-edit.js -> src/renderer/tools.js -> src/renderer/viewer.js -> src/renderer/pdf-text.js -> src/renderer/ocr.js`

## Communities (88 total, 16 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.06
Nodes (23): CloudSync, AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), crypto, decodePath() (+15 more)

### Community 2 - "main/main.js"
Cohesion: 0.06
Nodes (36): exportNotebookArchive(), pdfArgs(), fillForm(), { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, clipboard, nativeTheme, safeStorage, net, utilityProcess }, ASSETS, buildPdf(), config, configFile() (+28 more)

### Community 3 - "scan-geo.js"
Cohesion: 0.23
Nodes (16): lineLight(), lineWarp(), pageWarps(), renderMask(), bandFit(), ownInk(), shearOf(), median() (+8 more)

### Community 4 - "ocr-bench.js"
Cohesion: 0.15
Nodes (10): CONDS, FONTS, fs, goldenFile, os, out, path, RAW_CASES (+2 more)

### Community 5 - "App"
Cohesion: 0.11
Nodes (3): defaultToolState(), App, encodeRel()

### Community 6 - "inkrender.js"
Cohesion: 0.16
Nodes (21): drawStrokeInk(), withCuts(), cutClipCache, cutClips(), drawLive(), fillCache, fillPath(), liveCache (+13 more)

### Community 7 - "Library"
Cohesion: 0.10
Nodes (12): atomicWrite(), exists(), firstPageLook(), Library, newId(), readJson(), sanitizeName(), sleep() (+4 more)

### Community 8 - "showMenu"
Cohesion: 0.18
Nodes (5): sizeControl(), swatch(), TextBar, closeMenu(), showMenu()

### Community 9 - "ink.js"
Cohesion: 0.12
Nodes (31): livePath(), sizedPath(), strokePath(), angleBetween(), applyTapers(), bandPiece(), beadOutline(), beadPath() (+23 more)

### Community 10 - "export.js"
Cohesion: 0.09
Nodes (36): contentBBox(), drawContent(), drawImage(), drawInkText(), drawObject(), drawPaper(), drawPolyline(), drawRich() (+28 more)

### Community 11 - "bgremove.js"
Cohesion: 0.08
Nodes (38): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+30 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, on (+20 more)

### Community 13 - "report.js"
Cohesion: 0.07
Nodes (34): { _electron: electron }, path, root, check(), errors, finish(), fs, results (+26 more)

### Community 14 - "publish.test.js"
Cohesion: 0.24
Nodes (9): assert, bump(), fs, library(), os, path, test, tmp() (+1 more)

### Community 15 - "editor-objects.js"
Cohesion: 0.06
Nodes (28): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+20 more)

### Community 16 - "with"
Cohesion: 0.08
Nodes (24): GH_TOKEN, jobs, publish, name, on, push, permissions, contents (+16 more)

### Community 17 - "ocr-golden.test.js"
Cohesion: 0.24
Nodes (9): fixUmlauts(), assert, dir, expectFile, fs, path, r2(), replay() (+1 more)

### Community 18 - "library.js"
Cohesion: 0.23
Nodes (10): crypto, fs, path, makeSettingsExport(), migrateNotebook(), migratePage(), pageIsEmpty(), readSettingsImport() (+2 more)

### Community 19 - "package.json"
Cohesion: 0.14
Nodes (14): dependencies, nspell@^2.1.5, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, yauzl@^3.4.0, yazl@^3.3.1 (+6 more)

### Community 20 - ".endStroke"
Cohesion: 0.11
Nodes (21): layoutFromOcr(), build(), layouts, peekLayout(), ready, textLayout(), TextSelection, underlineStrokes() (+13 more)

### Community 21 - "localbackup.js"
Cohesion: 0.11
Nodes (33): backupRootFor(), copyFile(), crypto, dayOf(), deleteMarked(), entryFor(), findNotebooks(), fs (+25 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.19
Nodes (7): compile(), crypto, FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 24 - "toast"
Cohesion: 0.24
Nodes (3): LibraryView, promptDialog(), toast()

### Community 25 - "scan-edit.js"
Cohesion: 0.11
Nodes (40): BLURS, cssFont(), editableRun(), ensureEditable(), ensureOcr(), fontScores(), imageCanvas(), LANGS (+32 more)

### Community 26 - "PageView"
Cohesion: 0.10
Nodes (12): drawPaperRegion(), drawStrokes(), overlaps(), strokePaperLines(), isCancel(), BitmapCache, contains(), dpr() (+4 more)

### Community 27 - "steps"
Cohesion: 0.09
Nodes (23): ONNXRUNTIME_NODE_INSTALL, jobs, linux, windows, env, runs-on, steps, name (+15 more)

### Community 28 - "geometry.js"
Cohesion: 0.13
Nodes (27): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), densify(), distPointSeg(), distSegRect(), distSegSeg() (+19 more)

### Community 29 - "ref_fs"
Cohesion: 0.08
Nodes (23): pdf-lib, fs, { PDFDocument, StandardFonts, rgb, degrees }, fs, path, { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup }, readFormFields(), signatures() (+15 more)

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.08
Nodes (25): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+17 more)

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (10): driveDir, driveFile(), driveIndex(), fs, libDir, os, out, path (+2 more)

### Community 35 - "cloud.js"
Cohesion: 0.20
Nodes (10): crypto, path, local, crypto, dayOf(), notebookSignatures(), os, pad() (+2 more)

### Community 36 - "sync.js"
Cohesion: 0.21
Nodes (16): absInside(), conflictName(), crypto, fs, isIgnoredName(), isNotebookJson(), loadState(), md5Buffer() (+8 more)

### Community 38 - "editor.js"
Cohesion: 0.23
Nodes (13): templatePicker(), thumbCanvas(), confirmDialog(), debounce(), describeKey(), h(), keySignature(), modal() (+5 more)

### Community 39 - "renderer/ocr.js"
Cohesion: 0.31
Nodes (6): recognizePage(), recognizeSized(), linesFrom(), r2(), assert, test

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
Cohesion: 0.07
Nodes (20): FONTS, assert, remote, test, assert, { execFileSync }, fs, path (+12 more)

### Community 48 - "spell.js"
Cohesion: 0.16
Nodes (15): correctLines(), DIR, fs, known(), load(), path, SAME, TO_CYR (+7 more)

### Community 49 - "library-view.js"
Cohesion: 0.19
Nodes (14): drawPaper(), COVER_COLORS, fitTitle(), pageCanvas(), LABEL, formatDate(), iconButton(), COVERS (+6 more)

### Community 51 - "StudyNotes – rules for coding agents"
Cohesion: 0.22
Nodes (7): Commands, Private development notes (not in this repository), Project, Rules, StudyNotes – rules for coding agents, Code map (graphify), StudyNotes – notes for Claude

### Community 52 - "notices.js"
Cohesion: 0.29
Nodes (4): fs, parts, path, root

### Community 53 - "editor-panels.js"
Cohesion: 0.14
Nodes (16): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+8 more)

### Community 54 - "Ocr"
Cohesion: 0.27
Nodes (4): tesseract.js@^7.0.0, tesseract.js, getOcr(), Ocr

### Community 55 - "PenFilter"
Cohesion: 0.33
Nodes (3): PenFilter, assert, test

### Community 56 - "v15.js"
Cohesion: 0.20
Nodes (7): fs, os, out, path, { PDFDocument }, root, tmp

### Community 57 - "external.js"
Cohesion: 0.15
Nodes (22): cleanupExternal(), copyName(), crypto, externalPath(), fs, hasUnwrittenNotes(), idFor(), isExternal() (+14 more)

### Community 58 - "ocr-text.test.js"
Cohesion: 0.47
Nodes (4): editDistance(), googleLine(), assert, test

### Community 60 - "sync.test.js"
Cohesion: 0.12
Nodes (13): md5File(), assert, crypto, edit(), fs, http, os, path (+5 more)

### Community 61 - "tools.js"
Cohesion: 0.17
Nodes (15): placeAt(), rotPt(), scaleLook(), segTouchesRect(), transformItem(), uid(), mapCuts(), round2() (+7 more)

### Community 64 - "run.js"
Cohesion: 0.12
Nodes (16): launch(), { execFileSync }, fs, os, out, path, root, check() (+8 more)

### Community 69 - "package.json"
Cohesion: 0.12
Nodes (20): author, description, devDependencies, electron-builder@^26.15.3, pdfjs-dist@^6.4.299, playwright-core@^1.64.1, @tesseract.js-data/deu@^1.0.0, @tesseract.js-data/eng@^1.0.0 (+12 more)

### Community 71 - "screenshots.js"
Cohesion: 0.12
Nodes (10): { _electron: electron }, FRAMES, fs, os, outDir, path, { PDFDocument, StandardFonts, rgb }, rawDir (+2 more)

### Community 72 - "richtext.js"
Cohesion: 0.29
Nodes (11): wrapText(), decode(), ENTITIES, layoutRich(), parseRich(), plainFromParas(), plainToHtml(), richToPlain() (+3 more)

### Community 73 - "handwriting.js"
Cohesion: 0.22
Nodes (15): encodedScript(), fake(), fakeRecognize(), fs, path, recognize(), recognizeMany(), recognizers() (+7 more)

### Community 74 - "v17.js"
Cohesion: 0.22
Nodes (6): fs, os, out, path, root, tmp

### Community 76 - "scan-clean.js"
Cohesion: 0.14
Nodes (20): clampBox(), cleanLines(), dilate(), inkColor(), inpaint(), letterInk(), lineInk(), longRuns() (+12 more)

### Community 77 - "v16.js"
Cohesion: 0.09
Nodes (16): at(), fs, os, out, path, { PDFDocument, StandardFonts }, root, tmp (+8 more)

### Community 78 - "scan-layout.js"
Cohesion: 0.20
Nodes (11): besideMark(), combineBoxes(), graphicMarks(), lum(), paragraphs(), r2(), underlinedWords(), joinParagraphs() (+3 more)

### Community 80 - "electron"
Cohesion: 0.40
Nodes (3): electron@^44.9.0, electron, { contextBridge, ipcRenderer, webUtils }

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
Nodes (6): itemBBox(), textBBox(), turnedBox(), unionBox(), strokeBBox(), strokeInLasso()

### Community 88 - "ref_path"
Cohesion: 0.12
Nodes (15): FILES, fs, path, CONDS, fs, N, os, path (+7 more)

### Community 89 - "drive-sync.test.js"
Cohesion: 0.20
Nodes (7): assert, bump(), fs, os, path, test, write()

### Community 91 - "editor.js"
Cohesion: 0.10
Nodes (26): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+18 more)

### Community 95 - "shared-guard.test.js"
Cohesion: 0.33
Nodes (5): assert, dir, fs, path, test

## Knowledge Gaps
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Editor` connect `Editor` to `Viewer`, `.setPageData`, `App`, `.constructor`, `editor.js`, `showMenu`, `Thumbs`, `editor-panels.js`, `.toast`, `editor.js`, `tools.js`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `DriveRemote` be split into smaller, more focused modules?**
  _Cohesion score 0.05708548479632817 - nodes in this community are weakly interconnected._
- **Why does `Tools` connect `Tools` to `.constructor`, `Thumbs`, `tools.js`, `.endStroke`, `.select`, `editor.js`, `.selectionToolbar`, `Laser`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06201550387596899 - nodes in this community are weakly interconnected._
- **Why does `Library` connect `Library` to `main/main.js`, `backup.test.js`, `library.js`, `library-pages.test.js`, `editor-panels.js`, `external.js`, `ref_fs`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.11153846153846154 - nodes in this community are weakly interconnected._
- **Should `Library` be split into smaller, more focused modules?**
  _Cohesion score 0.0975177304964539 - nodes in this community are weakly interconnected._