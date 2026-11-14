# StudyNotes – rules for coding agents

Shared instructions for every agent (Claude, Codex, others). Agent-specific
notes go in their own file (`CLAUDE.md`) and point here instead of repeating this.

## Project
GoodNotes-like note-taking and PDF-annotation app, Electron, Windows (Android
planned for 2.0). Main process `src/main`, renderer `src/renderer`, code shared
by both (and later by Android) `src/shared`. Data format and migrations:
`src/shared/format.js`.

## Private development notes (not in this repository)
The plan, the handoff between sessions, lessons and task history live in
`dev-notes/` in the developer's local checkout. The folder is git-ignored and
never pushed. If it exists:
1. At the start of a session read `dev-notes/HANDOFF.md`, then the plan it names.
2. Compare it with `git status` / `git log`: the code and Git history win when
   the notes are stale.
3. At the end of a session update `dev-notes/HANDOFF.md` (what changed, commits,
   checks run and their results, next steps). Never mark work done without a
   check that ran.

## Commands
- Install: `npm ci` (in a proxied sandbox: `ONNXRUNTIME_NODE_INSTALL=skip npm ci`)
- Unit tests: `npm test` (`test/unit/shared` = pure, `test/unit/main` = Node/fs)
- Build: `npm run build`
- End-to-end (real app, Playwright): `npm run test:e2e:smoke`, `npm run test:e2e`;
  on Linux prefix with `xvfb-run -a -s "-screen 0 1600x1000x24"`; needs poppler
  (`pdftotext`, `pdfinfo`). One suite: `node test/e2e/<suite>.js`, `ONLY=A,B`
  limits sections.
- Windows installer: `npm run dist:win` (on Linux needs `wine`).
- CI: `.github/workflows/ci.yml` (unit on Linux + Windows, smoke e2e on Linux).

## Rules
- **Secrets:** `src/main/google-client.local.js` holds the Google OAuth client.
  It is git-ignored: never print, copy into other files, or commit it. Before
  every push: `git grep -nE "GOCSPX-[A-Za-z0-9_-]{10}" HEAD` must find nothing.
- **Public repository:** everything committed is public. Examples, screenshots,
  test data and docs are neutral and in English: no personal names, no private
  photos or documents, no local paths with user names.
- **One writer at a time:** only one agent edits a working tree. Parallel work
  goes on its own branch; merge into `main` only after tests pass. Pull before
  starting; never force-push or rewrite `main`.
- **Tests first for bugs:** add a failing test, then fix. A green suite is not
  proof for code paths it does not reach.
- **Data compatibility:** notebooks written by a newer version must not be
  damaged by an older one; bump `NOTEBOOK_VERSION` with a migration.
- **Releases** are done by the maintainer's agent only: build exe + zip, push an
  `upload/v<version>-r<N>` branch (see `.github/workflows/publish-prebuilt.yml`).
  A fixed version is re-published under the same number.
