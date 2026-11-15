# Graph Report - studynotes  (2026-11-15)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1879 nodes · 4541 edges · 96 communities (78 shown, 18 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 312 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1cc99be6`
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
- round2
- editor-objects.js
- with
- ocr-golden.test.js
- library.js
- package.json
- .endStroke
- localbackup.js
- FakeDriveApi
- toast
- scan-edit.js
- PageView
- steps
- geometry.js
- forms.test.js
- FakeRemote
- i18n.js
- build
- Tools
- v13.js
- ref_fs
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
- ref_node_assert
- editor-panels.js
- Ocr
- PenFilter
- v15.js
- external.js
- scan-edit.js
- sync.test.js
- tools.js
- .onDown
- Laser
- run.js
- drawObject
- release-notes.md
- package.json
- screenshots.js
- richtext.js
- handwriting.js
- v17.js
- backup.test.js
- scan-clean.js
- v17b.js
- scan-layout.js
- FakeRemote
- electron
- ink-recognize.ps1
- BitmapCache
- send.js
- export.test.js
- library-pages.test.js
- build.js
- v16.js
- ref_path
- exportNotebookArchive
- ocr-profile.js
- editor.js
- library-assets.test.js
- library.test.js
- scan-bands.test.js
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

## Communities (96 total, 18 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.06
Nodes (23): CloudSync, AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), crypto, decodePath() (+15 more)

### Community 2 - "main/main.js"
Cohesion: 0.07
Nodes (28): { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, clipboard, nativeTheme, safeStorage, net, utilityProcess }, ASSETS, backupDir(), config, configFile(), createWindow(), DIST, endSession() (+20 more)

### Community 3 - "scan-geo.js"
Cohesion: 0.30
Nodes (10): lineLight(), lineWarp(), renderMask(), bandFit(), ownInk(), shearOf(), median(), medianOr0() (+2 more)

### Community 4 - "ocr-bench.js"
Cohesion: 0.15
Nodes (10): CONDS, FONTS, fs, goldenFile, os, out, path, RAW_CASES (+2 more)

### Community 5 - "App"
Cohesion: 0.11
Nodes (4): defaultToolState(), App, encodeRel(), shortcutKey()

### Community 6 - "inkrender.js"
Cohesion: 0.12
Nodes (27): drawPaper(), withCuts(), cutClipCache, cutClips(), drawLive(), drawPaperRegion(), drawStrokes(), fillCache (+19 more)

### Community 7 - "Library"
Cohesion: 0.11
Nodes (9): firstPageLook(), Library, newId(), readJson(), sanitizeName(), uniqueChild(), migratePage(), isDark() (+1 more)

### Community 8 - "showMenu"
Cohesion: 0.25
Nodes (8): ALIGN_ICON, ALIGN_NEXT, sizeControl(), swatch(), TextBar, closeMenu(), h(), showMenu()

### Community 9 - "ink.js"
Cohesion: 0.12
Nodes (31): livePath(), sizedPath(), angleBetween(), applyTapers(), bandPiece(), beadOutline(), beadPath(), catmull() (+23 more)

### Community 10 - "export.js"
Cohesion: 0.10
Nodes (31): contentBBox(), drawContent(), drawImage(), drawInkText(), drawPolyline(), drawRich(), drawStroke(), drawStrokeInk() (+23 more)

### Community 11 - "bgremove.js"
Cohesion: 0.08
Nodes (38): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+30 more)

### Community 12 - "with"
Cohesion: 0.07
Nodes (28): CSC_IDENTITY_AUTO_DISCOVERY, ID, SECRET, tag, jobs, windows, name, on (+20 more)

### Community 13 - "report.js"
Cohesion: 0.09
Nodes (28): { _electron: electron }, path, root, check(), errors, finish(), fs, results (+20 more)

### Community 14 - "round2"
Cohesion: 0.19
Nodes (7): penButton(), scaleLook(), transformItem(), uid(), mapCuts(), round2(), transformStroke()

### Community 15 - "editor-objects.js"
Cohesion: 0.09
Nodes (21): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), rangeOffsets(), safeCache, safeHtml() (+13 more)

### Community 16 - "with"
Cohesion: 0.08
Nodes (24): GH_TOKEN, jobs, publish, name, on, push, permissions, contents (+16 more)

### Community 17 - "ocr-golden.test.js"
Cohesion: 0.24
Nodes (9): fixUmlauts(), assert, dir, expectFile, fs, path, r2(), replay() (+1 more)

### Community 18 - "library.js"
Cohesion: 0.16
Nodes (12): atomicWrite(), crypto, exists(), fs, path, sleep(), makeSettingsExport(), migrateNotebook() (+4 more)

### Community 19 - "package.json"
Cohesion: 0.14
Nodes (14): dependencies, nspell@^2.1.5, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, yauzl@^3.4.0, yazl@^3.3.1 (+6 more)

### Community 20 - ".endStroke"
Cohesion: 0.13
Nodes (19): layoutFromOcr(), build(), layouts, peekLayout(), ready, textLayout(), TextSelection, underlineStrokes() (+11 more)

### Community 21 - "localbackup.js"
Cohesion: 0.12
Nodes (30): backupRootFor(), copyFile(), crypto, dayOf(), deleteMarked(), entryFor(), findNotebooks(), fs (+22 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.11
Nodes (14): compile(), crypto, FakeDriveApi, json(), md5(), parseMultipart(), unquote(), assert (+6 more)

### Community 24 - "toast"
Cohesion: 0.24
Nodes (3): LibraryView, promptDialog(), toast()

### Community 25 - "scan-edit.js"
Cohesion: 0.15
Nodes (24): editableRun(), bestOf(), boldLines(), boldWords(), chooseFonts(), CLASSIC, darkShare(), dilateMask() (+16 more)

### Community 26 - "PageView"
Cohesion: 0.17
Nodes (3): contains(), intersect(), PageView

### Community 27 - "steps"
Cohesion: 0.09
Nodes (23): ONNXRUNTIME_NODE_INSTALL, jobs, linux, windows, env, runs-on, steps, name (+15 more)

### Community 28 - "geometry.js"
Cohesion: 0.12
Nodes (27): arcPts(), arrowHead(), bboxCache, bboxesOverlap(), densify(), distPointSeg(), distSegRect(), distSegSeg() (+19 more)

### Community 29 - "forms.test.js"
Cohesion: 0.18
Nodes (11): fillForm(), fs, path, { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup }, readFormFields(), signatures(), assert, fs (+3 more)

### Community 31 - "i18n.js"
Cohesion: 0.19
Nodes (13): attrOriginals, ATTRS, connect(), DICTS, doAttrs(), doText(), originals, setLang() (+5 more)

### Community 32 - "build"
Cohesion: 0.08
Nodes (25): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+17 more)

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (10): driveDir, driveFile(), driveIndex(), fs, libDir, os, out, path (+2 more)

### Community 35 - "ref_fs"
Cohesion: 0.08
Nodes (26): fs, parts, path, root, crypto, path, local, crypto (+18 more)

### Community 36 - "sync.js"
Cohesion: 0.21
Nodes (16): absInside(), conflictName(), crypto, fs, isIgnoredName(), isNotebookJson(), loadState(), md5Buffer() (+8 more)

### Community 38 - "editor.js"
Cohesion: 0.15
Nodes (14): icon(), P, confirmDialog(), debounce(), describeKey(), iconButton(), keyed, keySignature() (+6 more)

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
Cohesion: 0.20
Nodes (13): entryStream(), exportLibrary(), fs, importLibrary(), openZip(), path, readEntries(), readManifest() (+5 more)

### Community 46 - "v14.js"
Cohesion: 0.17
Nodes (9): fs, libDir, os, out, path, { PDFDocument }, root, tmp (+1 more)

### Community 47 - "ref_node_assert"
Cohesion: 0.11
Nodes (14): fontFile(), FONTS, assert, { execFileSync }, fs, path, { PDFDocument, degrees }, ROOT (+6 more)

### Community 48 - "spell.js"
Cohesion: 0.16
Nodes (15): correctLines(), DIR, fs, known(), load(), path, SAME, TO_CYR (+7 more)

### Community 49 - "library-view.js"
Cohesion: 0.19
Nodes (15): drawPaper(), COVER_COLORS, fitTitle(), pageCanvas(), LABEL, templatePicker(), thumbCanvas(), formatDate() (+7 more)

### Community 51 - "StudyNotes – rules for coding agents"
Cohesion: 0.22
Nodes (7): Commands, Private development notes (not in this repository), Project, Rules, StudyNotes – rules for coding agents, Code map (graphify), StudyNotes – notes for Claude

### Community 52 - "ref_node_assert"
Cohesion: 0.15
Nodes (9): assert, remote, test, assert, test, assert, test, assert (+1 more)

### Community 53 - "editor-panels.js"
Cohesion: 0.10
Nodes (17): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+9 more)

### Community 54 - "Ocr"
Cohesion: 0.23
Nodes (4): tesseract.js@^7.0.0, tesseract.js, getOcr(), Ocr

### Community 55 - "PenFilter"
Cohesion: 0.33
Nodes (3): PenFilter, assert, test

### Community 56 - "v15.js"
Cohesion: 0.11
Nodes (14): at(), fs, os, out, path, { PDFDocument }, root, tmp (+6 more)

### Community 57 - "external.js"
Cohesion: 0.14
Nodes (22): cleanupExternal(), copyName(), crypto, externalPath(), fs, hasUnwrittenNotes(), idFor(), isExternal() (+14 more)

### Community 58 - "scan-edit.js"
Cohesion: 0.13
Nodes (20): bandsOf(), BLURS, cssFont(), ensureEditable(), ensureOcr(), fontScores(), imageCanvas(), LANGS (+12 more)

### Community 60 - "sync.test.js"
Cohesion: 0.12
Nodes (13): md5File(), assert, crypto, edit(), fs, http, os, path (+5 more)

### Community 61 - "tools.js"
Cohesion: 0.15
Nodes (18): itemBBox(), rotPt(), segTouchesRect(), textBBox(), turnedBox(), unionBox(), releaseCanvas(), LINE_SHAPES (+10 more)

### Community 64 - "run.js"
Cohesion: 0.12
Nodes (16): launch(), { execFileSync }, fs, os, out, path, root, check() (+8 more)

### Community 65 - "drawObject"
Cohesion: 0.29
Nodes (11): drawObject(), pageWarps(), roundedRect(), applyH(), boxWarp(), colourAt(), cssMatrix3d(), homography() (+3 more)

### Community 69 - "package.json"
Cohesion: 0.11
Nodes (22): author, description, devDependencies, electron-builder@^26.15.3, esbuild@^0.28.2, pdfjs-dist@^6.4.299, playwright-core@^1.64.1, @tesseract.js-data/deu@^1.0.0 (+14 more)

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
Cohesion: 0.15
Nodes (9): pdf-lib, fs, { PDFDocument, StandardFonts, rgb, degrees }, fs, os, out, path, root (+1 more)

### Community 75 - "backup.test.js"
Cohesion: 0.20
Nodes (9): assert, { execFileSync }, fs, library(), os, path, test, tmp() (+1 more)

### Community 76 - "scan-clean.js"
Cohesion: 0.14
Nodes (20): clampBox(), cleanLines(), dilate(), inkColor(), inpaint(), letterInk(), lineInk(), longRuns() (+12 more)

### Community 77 - "v17b.js"
Cohesion: 0.18
Nodes (8): fs, LINES, os, out, path, { PDFDocument, StandardFonts }, root, tmp

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
Cohesion: 0.25
Nodes (7): dist, esbuild, { fontFaceCss }, fs, path, pdfjs, root

### Community 87 - "v16.js"
Cohesion: 0.20
Nodes (7): fs, os, out, path, { PDFDocument, StandardFonts }, root, tmp

### Community 88 - "ref_path"
Cohesion: 0.18
Nodes (10): FILES, fs, os, path, assert, fakePool(), fs, os (+2 more)

### Community 89 - "exportNotebookArchive"
Cohesion: 0.25
Nodes (9): exportNotebookArchive(), buildPdf(), exportTo(), extChanged(), extWrite(), extWriteAll(), openFileRequest(), send() (+1 more)

### Community 90 - "ocr-profile.js"
Cohesion: 0.25
Nodes (7): CONDS, fs, N, os, path, TEXT, tmp

### Community 91 - "editor.js"
Cohesion: 0.10
Nodes (25): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+17 more)

### Community 92 - "library-assets.test.js"
Cohesion: 0.25
Nodes (6): assert, fs, os, path, { PDFDocument }, test

### Community 93 - "library.test.js"
Cohesion: 0.29
Nodes (6): assert, fs, os, path, { PDFDocument }, test

### Community 94 - "scan-bands.test.js"
Cohesion: 0.33
Nodes (3): assert, { bandCuts }, test

### Community 95 - "shared-guard.test.js"
Cohesion: 0.33
Nodes (5): assert, dir, fs, path, test

## Knowledge Gaps
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Editor` connect `Editor` to `Viewer`, `.setPageData`, `App`, `.constructor`, `editor.js`, `showMenu`, `editor.js`, `BitmapCache`, `editor-panels.js`, `.toast`, `.onKey`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Should `Viewer` be split into smaller, more focused modules?**
  _Cohesion score 0.1465149359886202 - nodes in this community are weakly interconnected._
- **Why does `Tools` connect `Tools` to `.constructor`, `round2`, `BitmapCache`, `editor.js`, `geometry.js`, `tools.js`, `.onDown`, `Laser`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `DriveRemote` be split into smaller, more focused modules?**
  _Cohesion score 0.05708548479632817 - nodes in this community are weakly interconnected._
- **Why does `pdf-lib` connect `v17.js` to `package.json`, `screenshots.js`, `export.js`, `v17b.js`, `v14.js`, `ref_node_assert`, `package.json`, `export.test.js`, `library.test.js`, `v16.js`, `v15.js`, `external.js`, `library-assets.test.js`, `forms.test.js`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06756756756756757 - nodes in this community are weakly interconnected._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.1073170731707317 - nodes in this community are weakly interconnected._