# Graph Report - studynotes  (2026-10-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1083 nodes · 2850 edges · 53 communities (40 shown, 13 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 211 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Viewer
- DriveRemote
- main/main.js
- editor.js
- editor-panels.js
- App
- PageView
- Library
- showMenu
- Tools
- export.js
- bgremove.js
- sync.js
- ref_os
- ref_fs
- editor-objects.js
- toast
- Plan
- inkrender.js
- dependencies
- CloudSync
- localbackup.js
- FakeDriveApi
- Editor
- v13.test.js
- library.js
- sync.test.js
- v11.test.js
- FakeRemote
- FakeRemote
- build
- ink.js
- v13.js
- richtext.js
- package.json
- nsis
- paper.js
- stacked
- win
- scripts
- ref_path
- StudyNotes
- Thumbs
- backup.js
- v14.js
- run.js
- h
- StudyNotes – notes for Claude
- electron

## God Nodes (most connected - your core abstractions)
1. `Editor` - 83 edges
2. `h()` - 65 edges
3. `Tools` - 63 edges
4. `Library` - 41 edges
5. `App` - 39 edges
6. `Viewer` - 33 edges
7. `icon()` - 33 edges
8. `toast()` - 31 edges
9. `DriveRemote` - 28 edges
10. `showMenu()` - 26 edges

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

## Communities (53 total, 13 thin omitted)

### Community 1 - "DriveRemote"
Cohesion: 0.09
Nodes (16): AREAS, authError(), b64url(), buildAuthUrl(), createPkce(), decodePath(), DONE_PAGE(), DriveError (+8 more)

### Community 2 - "main/main.js"
Cohesion: 0.09
Nodes (28): exportNotebookArchive(), ASSETS, backupDir(), buildPdf(), config, configFile(), createWindow(), DIST (+20 more)

### Community 3 - "editor.js"
Cohesion: 0.13
Nodes (30): EMPTY, ERASER_SIZES, HL_PALETTE, HL_SIZES, NEON_PALETTE, PALETTE, PEN_SIZES, SHAPE_ICONS (+22 more)

### Community 4 - "editor-panels.js"
Cohesion: 0.10
Nodes (17): collapse(), fold(), indexFor(), MARKS, normalize(), richPlain(), searchLibrary(), searchNotebook() (+9 more)

### Community 6 - "PageView"
Cohesion: 0.10
Nodes (10): drawStrokes(), overlaps(), BitmapCache, contains(), dpr(), intersect(), MAX_ZOOM, MIN_ZOOM (+2 more)

### Community 7 - "Library"
Cohesion: 0.10
Nodes (10): exists(), Library, readJson(), sanitizeName(), uniqueChild(), openLibrary(), migrateNotebook(), migratePage() (+2 more)

### Community 8 - "showMenu"
Cohesion: 0.14
Nodes (10): ALIGN_ICON, ALIGN_NEXT, sizeControl(), swatch(), TEXT_SIZES, TextBar, closeMenu(), showMenu() (+2 more)

### Community 9 - "Tools"
Cohesion: 0.05
Nodes (37): Laser, itemBBox(), rotPt(), textBBox(), Tools, transformItem(), turnedBox(), uid() (+29 more)

### Community 10 - "export.js"
Cohesion: 0.18
Nodes (23): contentBBox(), drawContent(), drawImage(), drawObject(), drawPaper(), drawPolyline(), drawRich(), drawStroke() (+15 more)

### Community 11 - "bgremove.js"
Cohesion: 0.12
Nodes (25): bgraPremulToRGBA(), callWorker(), capSize(), chunk(), computeMask(), crc32(), CRC_TABLE, decodeImage() (+17 more)

### Community 12 - "sync.js"
Cohesion: 0.29
Nodes (13): absInside(), conflictName(), isIgnoredName(), isNotebookJson(), loadState(), md5Buffer(), pad(), pruneEmptyDirs() (+5 more)

### Community 13 - "ref_os"
Cohesion: 0.15
Nodes (10): playwright-core@^1.64.1, playwright-core, out, root, out, results, root, out (+2 more)

### Community 14 - "ref_fs"
Cohesion: 0.13
Nodes (6): pdf-lib, checkResult(), meanAlpha(), MODEL, pngInfo(), FONT

### Community 15 - "editor-objects.js"
Cohesion: 0.12
Nodes (13): blobToImage(), BLOCK, fontCss(), objectsMixin, prepareImage(), safeCache, safeHtml(), sanitizeHtml() (+5 more)

### Community 17 - "Plan"
Cohesion: 0.05
Nodes (40): A. Sync & data safety (most important), App, Architecture, B. Text box (GoodNotes style), Bugs found and fixed, C. Shapes, D. Laser, Decisions (from your answers) (+32 more)

### Community 18 - "inkrender.js"
Cohesion: 0.20
Nodes (17): drawLive(), fillCache, fillPath(), noiseTile(), paintFill(), paintStroke(), pathCache, patternCache (+9 more)

### Community 19 - "dependencies"
Cohesion: 0.17
Nodes (12): dependencies, onnxruntime-node@^1.30.0, pdf-lib@^1.17.1, @pdf-lib/fontkit@^1.1.1, perfect-freehand@^1.2.3, yauzl@^3.4.0, yazl@^3.3.1, onnxruntime-node (+4 more)

### Community 21 - "localbackup.js"
Cohesion: 0.25
Nodes (17): copyFile(), dayOf(), deleteMarked(), entryFor(), findNotebooks(), listSnapshots(), loadIndex(), notebookFiles() (+9 more)

### Community 22 - "FakeDriveApi"
Cohesion: 0.20
Nodes (6): compile(), FakeDriveApi, json(), md5(), parseMultipart(), unquote()

### Community 26 - "v13.test.js"
Cohesion: 0.23
Nodes (8): dayOf(), notebookSignatures(), pad(), publish(), bump(), library(), tmp(), write()

### Community 27 - "library.js"
Cohesion: 0.21
Nodes (16): cleanupExternal(), copyName(), externalPath(), hasUnwrittenNotes(), idFor(), isExternal(), openExternal(), readEmbedded() (+8 more)

### Community 28 - "sync.test.js"
Cohesion: 0.19
Nodes (6): md5File(), edit(), setup(), smallLibrary(), tmpdir(), write()

### Community 29 - "v11.test.js"
Cohesion: 0.24
Nodes (11): findThunderbird(), outlookScript(), powershell(), psQuote(), run(), sendMail(), sendTelegram(), thunderbirdArgs() (+3 more)

### Community 32 - "build"
Cohesion: 0.17
Nodes (12): build, appId, asarUnpack, copyright, directories, fileAssociations, files, linux (+4 more)

### Community 33 - "ink.js"
Cohesion: 0.33
Nodes (12): ccw(), disc(), getLiveOutline(), getOutline(), getSizedOutline(), outlineCache, PEN_STYLES, shapeOutline() (+4 more)

### Community 34 - "v13.js"
Cohesion: 0.18
Nodes (9): driveDir, driveFile(), driveIndex(), errors, libDir, out, results, root (+1 more)

### Community 35 - "richtext.js"
Cohesion: 0.36
Nodes (9): wrapText(), decode(), ENTITIES, layoutRich(), parseRich(), plainFromParas(), plainToHtml(), richToPlain() (+1 more)

### Community 36 - "package.json"
Cohesion: 0.16
Nodes (14): author, description, devDependencies, electron-builder@^26.15.3, esbuild@^0.28.2, pdfjs-dist@^6.4.299, license, main (+6 more)

### Community 37 - "nsis"
Cohesion: 0.25
Nodes (8): nsis, allowToChangeInstallationDirectory, artifactName, createDesktopShortcut, createStartMenuShortcut, oneClick, perMachine, shortcutName

### Community 38 - "paper.js"
Cohesion: 0.19
Nodes (11): drawPaper(), drawPaperRegion(), strokePaperLines(), COVERS, DARK, isDark(), LIGHT, pageBackground() (+3 more)

### Community 39 - "stacked"
Cohesion: 0.73
Nodes (4): layerOf(), restack(), stacked(), ids()

### Community 40 - "win"
Cohesion: 0.40
Nodes (5): win, artifactName, files, icon, target

### Community 41 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dist:win, graph, start, test

### Community 42 - "ref_path"
Cohesion: 0.20
Nodes (4): dist, pdfjs, root, FakeAuth

### Community 43 - "StudyNotes"
Cohesion: 0.17
Nodes (11): Development, Features, Graphics tablet (Wacom, XP-Pen, Huion), Install, New in 1.1, New in 1.2, New in 1.3, New in 1.4 (+3 more)

### Community 45 - "backup.js"
Cohesion: 0.31
Nodes (9): entryStream(), exportLibrary(), importLibrary(), openZip(), readEntries(), readManifest(), walk(), zipFolder() (+1 more)

### Community 46 - "v14.js"
Cohesion: 0.18
Nodes (7): errors, libDir, out, results, root, tmp, userData

### Community 48 - "run.js"
Cohesion: 0.28
Nodes (6): check(), main(), mem(), out, results, root

### Community 49 - "h"
Cohesion: 0.25
Nodes (3): h(), 2026-10-26 (v1.4), Lessons

### Community 51 - "StudyNotes – notes for Claude"
Cohesion: 0.50
Nodes (3): Checks, Code map (graphify), StudyNotes – notes for Claude

## Knowledge Gaps
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Editor` connect `Editor` to `Viewer`, `editor.js`, `editor-panels.js`, `App`, `showMenu`, `Thumbs`, `.pageData`, `h`, `.constructor`, `.onKey`, `.pageMenu`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Should `DriveRemote` be split into smaller, more focused modules?**
  _Cohesion score 0.08735150244584207 - nodes in this community are weakly interconnected._
- **Why does `h()` connect `h` to `Viewer`, `editor.js`, `editor-panels.js`, `App`, `PageView`, `paper.js`, `showMenu`, `Tools`, `Thumbs`, `editor-objects.js`, `toast`, `.constructor`, `.onKey`, `Editor`, `.pageMenu`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Should `main/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Why does `Tools` connect `Tools` to `Editor`, `.constructor`, `editor.js`, `.onKey`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Should `editor.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12685560053981107 - nodes in this community are weakly interconnected._
- **Should `editor-panels.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10384068278805121 - nodes in this community are weakly interconnected._