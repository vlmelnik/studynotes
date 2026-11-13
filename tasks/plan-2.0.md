# StudyNotes – road to 2.0 (plan, 2026-11-13)

Status: **approved by the user 2026-11-13; Phase 1 in progress.**
Written so that each task can be handed to the right model: every task names
the files, the change and the check that proves it.

Model labels (per task, the phase label is the default):
- `[Fable]` – Claude Fable 5.2: hardest judgement – image-processing
  heuristics without ground truth, native low-latency ink, sync data safety.
- `[Opus]` – Claude Opus 5.5: normal design + code work with tests.
- `[Sonnet]` – mechanical, well-specified work (moves, cleanup, CI yaml, docs).
- `[Haiku]` – trivial edits only (renames, deleting listed files).

Order: 0 baseline → 1 fix round (1.7.0 r7) → 2 tests → 3 cleanup → 4 GitHub page
→ 5 Android (2.0). Phases 2–4 do not change app behaviour.
Phase 4 is **deferred** by the user (reference pictures later).

Rules that still apply (from the handoff): plan/lessons in `tasks/`, verify
before "done", never commit `src/main/google-client.local.js`, run
`git grep -nE "GOCSPX|667644213046"` before every push, user photos are tested
locally only, repo examples neutral and in English, releases upload exe + zip only.

---

## Phase 0 – Baseline (done 2026-11-13, fresh clone of main @ 9917188)

- `npm test`: 119 tests, 118 pass, 1 skipped, ~18 s.
- e2e (Linux, xvfb): `run` 30/30 (32 s), `v17` 44/44 (79 s), `v17b` 22/22 (22 s).
  Not re-run today: v11–v16, v161, ocr-bench, real-pdfs, Windows build.
- Install pitfall: `npm ci` fails here because the `onnxruntime-node` install
  script downloads extra binaries; `ONNXRUNTIME_NODE_INSTALL=skip npm ci` works
  (the CPU binary is already in the package). Add to lessons.md.
- All green, yet the review below found real defects → the suites test the
  happy path of synthetic pages, not the failure cases (see Phase 2).

---

## Phase 1 – Fix round, re-publish as 1.7.0 (r7)   `[Opus]`

Source: independent code review of the OCR / text-replacement path. Finding 1
was reproduced by running `src/main/spell.js`; the others are confirmed by
reading the code but **not yet reproduced in the running app** – reproduce each
with a failing test first, then fix.

### P1 – wrong results for the user
- [ ] `[Opus]` **1.1 Dictionary correction rewrites formula symbols.** `src/main/spell.js`
      (`fix`, `single`, ~l.48/101/128). Reproduced: "die Zeit tf" → "ft",
      "der Wert lc" → "Ie", "поле B равно" → "В", "пусть a равно" → "а".
      It also changes the searchable-scan layer (`src/renderer/ocr.js:42`).
      Fix: never touch tokens of ≤ 2 letters; `single()` only for a
      sentence-initial or low-confidence letter; pass word confidence from
      Tesseract and correct only below a threshold.
      Test: extend `test/spell.test.js` with the cases above + a list of
      symbols/units (Ic, Uce, tf, fT, Rth, dt, eV, pn, SiC, GaN) that must stay,
      and the existing wins ("Tak" → "Так", "fhe" → "the") that must still work.
- [ ] `[Opus]` **1.2 Patch covers the whole bounding box of all lines.**
      `src/renderer/scan-edit.js:889-903`. A full page becomes one 300-dpi JPEG
      over the PDF/photo: figures and formulas that were never touched get
      re-encoded, exports grow. Fix: always use the alpha-masked patch that the
      tilted branch already builds (`:881-883`), PNG, transparent outside
      `looks.fill`. Test: e2e – a page with text + a figure; after "Make page
      editable" the pixels of the figure region are identical; exported PDF size
      stays within a limit.
- [ ] `[Fable]` **1.3 Cleaning erases everything dark near a line.**
      `src/shared/scan-clean.js:176-180` (`cleanLines`). Table borders, form
      rules and neighbouring-column ink within ~0.5 line height are painted out.
      Fix: mask = ink components that touch the line's word boxes, minus long
      thin runs (`ownInk` in `scan-geo.js:66` is a start). Test: unit test on a
      synthetic table cell and a ruled form line – borders survive.

### P2 – robustness
- [ ] `[Opus]` 1.4 No re-entrancy guard (`editor.js:730`, `scan-edit.js:621`): second
      click during a long run → duplicate boxes and two patches. Per-page set of
      running jobs + disabled button. e2e: double click → one result.
- [ ] `[Opus]` 1.5 Font matching reads only the red channel (`scan-edit.js:145`):
      red/orange text gets an arbitrary font. Use `lum()`.
- [ ] `[Opus]` 1.6 `toBlob` may return null on huge canvases (`scan-edit.js:362/657/902`)
      → toast "Cannot read properties of null". Null-check; cap rescaled area
      (~20 MP).
- [ ] `[Opus]` 1.7 Scale ignores the picture's native resolution (`scan-edit.js:641`):
      a 12 MP photo gets a softer patch. Derive scale from natural size.
- [ ] `[Opus]` 1.8 Paragraph boxes: first line's size used for all lines; export wraps at
      `w*1.04+2` (`export.js:420`) while the screen uses max-content → a last
      word can wrap only in the PDF. Median size; store measured width.
      (Suspected – reproduce first.)
- [ ] `[Opus]` 1.9 Old text stays under the patch: original PDF text / `ocr.json` words
      are still found by search, selection and in the exported PDF after
      "replacement". (Suspected.) Decide: suppress the text layer under
      `scan:1` items, or document it.
- [ ] `[Fable]` 1.10 Speed: ~30 fonts × 4 blur renders × `getImageData` per line on the UI
      thread; lines only 1.2× taller than the median are re-read. Measure first
      (timings were not taken), then: blur ladder for the top 5 fonts only,
      re-read at ≥ 1.6×, move scoring to a worker.

### P3 – small
- [ ] `[Opus]` 1.11 Ruled line at the crop edge counted as underline and erased
      (`scan-layout.js:107-114`).
- [ ] `[Opus]` 1.12 Underline erased from the scan even when it is not re-applied
      (`scan-edit.js:868` vs `:943`).
- [ ] `[Opus]` 1.13 Google OCR: cleanup at the start of a call deletes temp docs of a
      parallel call (`cloud.js:196`) → serialise.
- [ ] `[Opus]` 1.14 Spell process: no request timeout, no respawn (`main.js:621-631`).
- [ ] `[Opus]` 1.15 Tilted auto-width box rotates around a slightly different centre in
      export (`export.js:439`, < 1 pt).
- [ ] `[Opus]` 1.16 Code before the `try` in `makeTextEditable` (`scan-edit.js:622-641`)
      → unhandled rejection from the lasso pointer-up.

### Heuristics to pin down with real cases (add to the golden corpus, Phase 2)   `[Fable]`
- Paragraph merge joins form labels / table columns (`scan-layout.js:153-166`).
- Logo detection keeps short captions beside any solid blob as picture.
- Language narrowing re-reads a few Russian words on a German page as Latin.
- Lines of ≤ 3 characters need confidence 80 → "OK", "a)", page numbers stay picture.
- Bold thresholds tuned on six photos.

### Left over from 1.7.0 (handoff + unchecked boxes in todo.md)
- [ ] Verify on the user's Windows PC: "Read better with Google" (only tested
      against a fake), Windows handwriting recognizer (PowerShell/WinRT fix).
      Status 2026-11-13: **not tested by the user yet** – ask after r7.
- [ ] `[Fable]` Decorative / comic fonts are still recognised as text – no reliable method
      yet (font-fit score rejected). Keep open; try stroke-width variance +
      reading confidence on the corpus, no promise.
- [ ] Width / size / letter fit on photos – measure on the corpus first.
- [ ] Lines with perspective / tilt / handwriting are not merged into paragraphs.
- [ ] "Full e2e, review, Windows build, re-publish" boxes of redo #1–#5 → close
      with this round.
- [ ] PR #1 still open on GitHub (user closes it himself).

### Release
- [ ] All unit + all e2e suites, independent review, `npm run dist:win`,
      packaged e2e (`STUDYNOTES_EXE`), publish as `upload/v1.7.0-r7`.

---

## Phase 2 – Test architecture   `[Sonnet]` unless marked

Findings (audit, by reading the code):
- Suites are organised by release (`v11…v17b`), not by feature; `check()` is
  redefined in 11 files, `launch()` in 12 (with drifting env sets), `at()` in 8.
- ~25 Electron launches for a full run; 263 `waitForTimeout` calls = 95 s of
  fixed sleeping; ~97 raw-coordinate mouse lines; sections share one notebook
  and depend on order (`v14.js:59` has `|| true`).
- No test imports anything from `src/renderer` (~10.6k lines). The OCR
  heuristics (`mergeLines`, `joinParagraphs`, `chooseFonts`, `boldLines`,
  `narrowLangs`, `fixUmlauts`, `skewOf`, …) and PDF text logic (`linesOf`,
  `columnCuts`, `charAt`) are pure but live in renderer files → reachable only
  through slow e2e. That is why each bug round was slow.
- No golden corpus: `ocr-bench.js` asserts only "average CER < 3 %, none ≥ 12 %";
  font, angle and line count are printed, not asserted; manual only.
- CI: `release.yml` runs unit tests; `publish-prebuilt.yml` (the path actually
  used) publishes with **no tests**; no workflow on push/PR; no e2e in CI.

Target layout:
```
test/
  unit/shared/   pure, no fs/electron  (also valid on Android)
  unit/main/     node fs / pdf-lib
  unit/render/   renderer-pure logic
  golden/        ocr/{cases/*.png, expected.json, baseline.json}, raw/*.json
  e2e/harness/   app.js (launch, env presets), page.js (at, draw, waitIdle), report.js
  e2e/specs/     ink, text, pdf-select, scan-edit, library, sync, export (by feature)
  e2e/tools/     ocr-bench.js, real-pdfs.js
```
Runner stays `node:test` + `playwright-core` (no new dependencies).

Steps (each keeps everything green):
- [ ] 2.1 (S) `ci.yml` on push/PR: Linux + Windows, `npm test` + build.
- [ ] 2.2 (S) `test/e2e/harness/` with the one shared `check/launch/at/ocrUrl/footer`;
      switch suites to it one by one, no behaviour change.
- [ ] 2.3 (S) Move unit files to `unit/shared`, `unit/main`; split `vNN.test.js`
      by module; fix the glob in package.json.
- [ ] 2.4 (M) `npm run test:e2e:smoke` (boot, stroke, save/reopen, export,
      one OCR case; < 3 min) + `test:e2e`, `test:ocr`, `test:all`; smoke in CI.
- [ ] `[Opus]` 2.5 (M) Extract the pure functions from `scan-edit.js`, `scan-geo.js`,
      `pdf-text.js`, `ocr.js` into `src/shared/` (`scan-fonts.js`,
      `text-layout.js`); unit tests; guard test: `src/shared` must not require
      fs/electron/path.
- [ ] `[Opus]` 2.6 (M) OCR golden corpus, two levels: (a) PNG cases → CER, font family,
      angle, line count vs `baseline.json` with tolerances, `UPDATE_GOLDEN=1`;
      (b) stored raw Tesseract output as JSON → heuristics tested in
      milliseconds without Tesseract. Neutral English/German/Russian samples
      only; the user's own photos stay local (`SN_IMG`).
- [ ] 2.7 (L) Regroup e2e sections into feature specs under `node:test`
      (one launch per file, fresh notebook per test, `waitIdle()` instead of sleeps).
- [ ] 2.8 (S) Gate releases: `publish-prebuilt.yml` requires a green `ci.yml`
      for that commit; packaged smoke via `STUDYNOTES_EXE` in `release.yml`.
- [ ] `[Opus]` 2.9 (later, with Phase 5a) in-memory fake of `window.api` so renderer
      specs run in plain Chromium – the same specs then cover the Android build.

Budgets: unit < 30 s, smoke < 3 min, full e2e < 15 min.
Not measured yet: real run times of all suites, flakiness, Windows e2e.

---

## Phase 3 – Cleanup   `[Sonnet]` (3.1, 3.4, 3.7 `[Haiku]`)  (checklist; do after Phase 2.3 so moves don't collide)

One commit per bullet, `npm test` + smoke after each, no behaviour change.
- [ ] 3.1 `graphify-out/`: delete the dated snapshot folders `2026-10-31/`,
      `2026-11-08/`, `2026-11-09/` (~4 MB of old `graph.json`); keep
      `GRAPH_REPORT.md`, `graph.html`, `graph.json`, `manifest.json`; check
      whether `npm run graph` recreates dated folders and, if so, gitignore them.
- [ ] 3.2 Dead code named by the review: `void H` (`scan-clean.js:184`), unused
      `changed` counter in `spell.js`; then a pass with a dead-export finder
      (e.g. `knip`, run once with `npx`, not added as a dependency) – list
      findings first, delete only what tests prove unused.
- [ ] 3.3 Duplicates → one helper each in `src/shared`: `LINE_H` (4 files),
      `escHtml` (3), median helpers (6+), `dilateMask` vs `dilate`, the
      "Error invoking remote method" regex (4), word mapping in `handwriting.js`.
- [ ] 3.4 `ocr-bench.js`: remove the copied `v17.js` header and `v17-` prefix.
- [ ] 3.5 Old add-on download path: **user agreed to remove it** (2026-11-13),
      done in Phase 1 by `[Opus]` because it touches `src/main/ocr.js`.
- [ ] 3.6 `tasks/todo.md` (28 KB, v1.0–v1.7): move finished versions to
      `tasks/archive/`, keep open items + this plan. Tick or delete the stale
      unchecked v1.5 / v1.6 boxes that were in fact shipped.
- [ ] 3.7 README: e2e example still says `v15.js  # newest features`; code
      overview lacks the OCR modules (done properly in Phase 4).
- [ ] 3.8 GitHub: delete merged/old `upload/*` branches if any remain (only
      `main` exists today), close PR #1 (user), check that releases contain only
      v1.x app releases + `ocr-data-1`.
- [ ] 3.9 User's PC (needs the desktop link): refresh
      `C:\Users\Mmap\Documents\Projects\studynotes` from main, remove stray
      `studynotes-main` / `sn.tgz` in the home folder left by earlier updates,
      fix the locked `tasks/todo.md`; update the Obsidian notes.
- [ ] 3.10 `npm run graph` and commit the refreshed map at the end.

---

## Phase 4 – GitHub page redesign   `[Sonnet]`, design reviewed by user — **DEFERRED** (user, 2026-11-13)

The reference pictures the user mentioned did **not arrive in this chat** –
this section is based on the current README and must be adjusted to them.
What is outdated today:
- `whats-new.png` shows version 1.5.0; no screenshot shows 1.6/1.7 features
  (text selection, editable scans, eyedropper, Add-ons settings).
- Four full-width screenshots in a row with no text between them.
- Headline says "for Windows"; no platform table, no roadmap, no Android.
- No demo GIF, no dark-mode shot, no social-preview image, no repo topics.

Plan:
- [ ] 4.1 New hero: one composed image (light + dark) + a 10–15 s GIF/MP4 of
      writing on a PDF and "Make text editable".
- [ ] 4.2 Feature grid: 6 tiles, 2 per row (image + 2 lines): Write on PDFs ·
      Editable scans (before/after) · Library & templates · Fill & sign ·
      Search & select · Sync & backup.
- [ ] 4.3 Extend `scripts/screenshots.js`: new scenes (scan → editable text,
      PDF text selection + highlight, Add-ons settings, dark mode), What's-new
      taken from the current version, one consistent frame style; regenerate
      all images (neutral English content, no personal data).
- [ ] 4.4 README structure: hero → badges (version, downloads, CI, licence,
      platforms) → features → install (Windows now, Android "coming in 2.0") →
      roadmap → build from source → contributing → licence.
- [ ] 4.5 Repo polish: description, topics (`note-taking`, `pdf-annotation`,
      `electron`, `ocr`, `handwriting`, `android`), social preview 1280×640,
      `CONTRIBUTING.md`, issue templates (bug with version/OS/steps, feature),
      release-notes template listing highlights instead of only a changelog link.
- [ ] 4.6 GitHub Pages (`index.html`, `privacy.html`): same visual style,
      download buttons for Windows and (later) Android; privacy text extended
      for the Android app before 2.0.
- [ ] 4.7 For 2.0: phone + tablet screenshots in device frames.

---

## Phase 5 – Android (version 2.0: tablets and phones)   `[Opus]` unless marked

### Recommendation
**Capacitor 8 shell that reuses the existing renderer**, thin Kotlin plugins
for storage, Drive authorisation and background sync.
Why: the renderer (~11k lines) has no Node/Electron imports and talks to the
main process only through `window.api` (roughly 90 methods in `src/main/preload.js`);
`src/shared`, pdf.js, pdf-lib, tesseract.js and nspell are plain JS. A native
Kotlin rewrite would give the best pen feel but means two engines that must
draw the same page data identically forever – too much for a two-user project.
Flutter / React Native / KMP reuse nothing; a PWA lacks folder access and
background sync.

**Main risk: pen latency in Android WebView.** There are reports of visible
lag in WebView drawing apps on current tablets; it is not known how our canvas
behaves. So the first step is a measurement, not a port.

### 5a – Platform layer on desktop (no Android yet; ships inside a 1.x build)
- [ ] Define `window.api` as a documented interface (`src/shared/api.d.ts` or
      JSDoc): group the ~90 methods (library, assets, export, sync, ocr, spell,
      system).
- [ ] Split `src/main` logic from Node I/O: `library.js`, `sync.js`, `export.js`
      take a small file-system adapter (read/write/list/atomic rename) instead
      of `fs` directly. `sync.js`/`drive.js` already take an injected `fetch`.
- [ ] In-memory `api` fake → renderer runs in plain Chromium (Phase 2.9).
- [ ] Touch groundwork in the renderer (useful on Windows touch screens too):
      today `pointerType === 'touch'` only pans (`tools.js:189`), there is no
      pinch zoom and `styles.css` has no layout breakpoints at all.

### 5b – Latency spike (go / no-go, ~1–2 days, needs the user's real devices)   `[Fable]`
- [ ] Bare Capacitor app with only the ink canvas. Add `getPredictedEvents`
      and a `desynchronized` canvas context (neither is used today;
      `getCoalescedEvents` is). Film at 240 fps next to Samsung Notes.
      Log pressure, tilt, hover, pen button, palm touches.
- [ ] Same app: open a 600-page PDF with pdf.js – memory and page-turn time.
- [ ] Decision: (A) WebView is good enough → continue; (B) not good enough →
      hybrid: only the stroke in progress is drawn natively with `androidx.ink`
      (low-latency front buffer, needs Android 10+) above the WebView,
      everything else stays web; (C) both fail → reconsider native.

### 5c – Tablet version (first usable build)
- [ ] Capacitor project in `android/`; build renderer with the same esbuild.
- [ ] Kotlin plugin `storage`: library in app-private storage with the same
      folder format (`notebook.json`, `pages/<id>.json`, `source.pdf`,
      `ocr.json`); Android file picker only for import/export; share sheet for
      "send".
- [ ] `window.api` implementation for Android; features without an Android
      backend are hidden, not broken (list them in the UI spec).
- [ ] Input: pen draws, one finger pans, two fingers zoom, palm rejection,
      S Pen button = eraser (hover and button arrive as normal pointer events –
      verify in 5b), "draw with finger" switch.
- [ ] PDF export through pdf-lib in the WebView (already JS).

### Target devices (user, 2026-11-13): mainly Samsung with S Pen
Test classes (most common S Pen devices; exact models to confirm with the user):
- Tablets: Galaxy Tab S9 / S10 / S11 series incl. FE (S Pen in the box).
- Phones: Galaxy S Ultra (S23–S25 Ultra); the S25 Ultra pen has no Bluetooth,
  so only hover, pressure, tilt and the side button are used (no Air actions).
- One non-Samsung device without pen (finger only) in the emulator.

### 5d – Phone layout and adaptive UI
Principles taken from current apps (Samsung Notes: reorderable toolbar;
Noteshelf 3: floating mini toolbar that docks to an edge; Material 3 floating
/ docked toolbars) and Android's window size classes (compact < 600 dp,
medium 600–840 dp, expanded ≥ 840 dp; touch targets ≥ 48 dp):
- **Compact (phones):** one slim top bar (back, title, undo/redo, ⋯) that
  hides while a stroke is in progress; one floating pill at the bottom with
  5 tools (pen, highlighter, eraser, lasso, colour) that collapses to a single
  button and can be dragged to a side edge; tool options and page thumbnails
  as bottom sheets; library as one list. Nothing permanent covers the page.
- **Compact height (phone landscape):** vertical pill on a side edge, no top bar.
- **Medium (small tablets, foldables):** docked top toolbar with all tools,
  thumbnails as a dismissible side sheet, library as grid with navigation rail.
- **Expanded (tablets):** today's desktop layout.
- [ ] CSS breakpoints + container queries in `styles.css`; toolbar component
      with three modes; safe-area insets (`env()`) – edge-to-edge is mandatory
      at target SDK 36; system back: close panel → leave notebook → library;
      keep the open page on rotation / fold / split-screen (orientation locks
      are ignored on large screens from Android 16/17).
- [ ] Clickable HTML mock-up of the three layouts for the user **before** coding.

### 5e – Google sign-in and sync   `[Fable]` (data safety)
- [ ] Android OAuth client (package name + signing SHA-1) in the **same**
      Google Cloud project as the desktop client; scope stays `drive.file`
      (non-sensitive). Android authorisation API instead of the desktop
      loopback flow. To verify in a prototype: that the Android client sees the
      files the desktop client created (expected with one project; not confirmed).
- [ ] Port the sync logic unchanged (three-way by MD5, "keep both" copies);
      `src/shared/format.js` is the single source of the notebook version –
      an older app must refuse newer notebooks.
- [ ] Mobile rules: page JSON on any network; `source.pdf` on demand, Wi-Fi
      only by default, resumable; skip the desktop-only `PDF/` and `Backups/`
      Drive folders; background sync with WorkManager.

### 5f – Recognition on Android
- [ ] Printed text: keep tesseract.js (WASM) with the existing eng/deu/rus
      data. Google's on-device ML Kit text recognition lists Latin, Chinese,
      Devanagari, Japanese, Korean – **no Cyrillic**, so it cannot replace it.
- [ ] Handwriting → text: ML Kit Digital Ink Recognition (has en, de, ru)
      replaces the Windows recognizer. Needs Google Play services.
- [ ] Background removal: onnxruntime-web (WASM) first; native ONNX only if
      too slow (native libs must be 16 KB-page aligned for target SDK 35+).

### 5g – Versions, build, publishing   `[Sonnet]`
- **minSdk 29 (Android 10), target/compile SDK 36.** Capacitor 8 itself needs
  min 24 / target 36; Android 10 is the floor for the native low-latency ink
  fallback and covers roughly 90 % of devices (figures from late 2025/2026
  press reports, not an official dashboard).
- **Publishing (decided by the user): signed APK on GitHub Releases**; Google Play later.
  Updates through Obtainium, built by GitHub Actions with one release key kept in repo secrets
  + an offline backup (a lost key cannot be replaced).
- Google Play: $25 once, but a new personal account must run a closed test
  with 12 testers for 14 days before production – out of proportion for two
  users. Possible later.
- F-Droid: would need a build without Google Play services (no Drive sign-in,
  no ML Kit) – not now.
- **Android developer verification:** since 30 Sep 2026 only for certain
  stores in a few countries; global rollout announced for 2027. After that,
  APKs from unregistered developers install only via ADB or a one-time
  "advanced flow" with a 24 h wait. A free limited-distribution account
  (no ID, up to 20 devices) avoids this for the user and his friend →
  register it before 2.0 ships.
- [ ] `release-android.yml`; version code scheme; README + Pages download.

### Test plan for 2.0
Shared unit tests (Phase 2) run unchanged; renderer specs run in Chromium
against the fake `api`; Android emulator smoke (boot, stroke, save/reopen,
sync against the fake Drive) in CI; pen feel only on real devices (user).

### Milestones
2.0-alpha1 = 5a + 5b decision · alpha2 = tablet (5c) · beta1 = phone UI (5d) ·
beta2 = sync + recognition (5e, 5f) · 2.0 = publishing (5g) + Phase 4.7.

### Not verified / open
- WebView pen latency, `desynchronized` canvas support in WebView – unknown until 5b.
- Android 10 share today; exact month of the 2027 verification rollout.
- UI details of GoodNotes / Notability on Android phones in 2026 (GoodNotes
  Android was tablet-only when announced; Notability Android was in beta).
- iOS is out of scope (needs a Mac and a paid account).

### Sources (Android research)
- Capacitor 8: https://capacitorjs.com/docs/updating/8-0
- androidx.ink: https://developer.android.com/jetpack/androidx/releases/ink
- Stylus low latency: https://developer.android.com/develop/ui/compose/touch-input/stylus-input/advanced-stylus-features
- WebView lag report: https://github.com/personalizedrefrigerator/js-draw/issues/133
- ML Kit text recognition: https://developers.google.com/ml-kit/vision/text-recognition/v2
- ML Kit digital ink languages: https://developers.google.com/ml-kit/vision/digital-ink-recognition/base-models
- Android authorisation (Drive): https://developer.android.com/identity/authorization
- Drive scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Target SDK rules: https://developer.android.com/google/play/requirements/target-sdk
- Android 16 changes: https://developer.android.com/about/versions/16/behavior-changes-16
- Android 17 large screens: https://developer.android.com/blog/posts/prepare-your-app-for-the-resizability-and-orientation-changes-in-android-17
- 16 KB pages: https://developer.android.com/guide/practices/page-sizes
- Window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- Developer verification FAQ: https://developer.android.com/developer-verification/guides/faq
- Play testing rule: https://support.google.com/googleplay/android-developer/answer/14151465?hl=en
- Noteshelf floating toolbar: https://noteshelf-support.fluidtouch.biz/hc/en-us/articles/21887313617305-The-All-New-Floating-Mini-Toolbar
- Samsung Notes toolbar: https://www.androidauthority.com/samsung-notes-one-ui-8-changes-3564222/
- Distribution figures: https://gadgets.beebom.com/news/google-android-17-adoption-figures-october-2026

---

## Future ideas (optional, not scheduled)
- **Ink → neat text:** write by hand, then the handwriting is converted into
  clean typed text in place (same position, size and colour), optionally
  automatically after a pause (like Samsung Notes / Nebo). Builds on the
  existing "To text" (Windows recognizer) and on ML Kit Digital Ink for
  Android (Phase 5f). Off by default, a setting.

## Answers from the user (2026-11-13)
1. Phase 4 pictures: postponed.
2. Google OCR / Windows handwriting: not tested yet.
3. Android devices: mainly Samsung with S Pen, the popular models.
4. Publishing: GitHub APK; Google Play later.
5. Old OCR add-on download path: remove if that is the better design.
6. Start with the `[Opus]` tasks; label `[Fable]` where Fable 5.2 is needed.
