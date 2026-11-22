# StudyNotes development plan and engineering lessons

Use this public roadmap when preparing queue entries or when an assigned task needs product context. The [task catalog](tasks.json) defines the exact files and acceptance criteria for a claim. Check the current code, open PRs and merged work before creating a task from this page. A roadmap item can span several PRs.

## Desktop backlog

One queue task = one complete, reviewable outcome with full tests (about 70 % of a
participant's five-hour allowance, finishable within the two-hour claim). Pure logic
goes to `src/shared`. User-visible features that fit the extension host go to
`src/extensions/<id>` with unit and end-to-end tests ([EXTENSIONS.md](../EXTENSIONS.md)).
Wiring that needs the editor, the viewer or the main process stays with the maintainer.

| Outcome | Queue task(s) | Maintainer part | Integration check |
| --- | --- | --- | --- |
| Formulas, bold, headings and lists survive pasting; existing LaTeX text can be rendered | `sn-paste-parse` → `sn-ext-rich-paste` → `sn-ext-rich-paste-export` | extension host, KaTeX dependency | e2e: paste, edit, undo, export PDF/PNG, copy out, switch off |
| Dark view for PDF pages | `sn-ext-dark-view` | page pass and ink filter in the host | e2e: page dark, ink readable, stored colours and export unchanged |
| Several PDFs and their outlines in one notebook | `sn-outline-full` | panel tree, drag to move, PDF bookmarks in export | reopen and export: entries point to the right page |
| Faster, smoother scrolling and zoom | `sn-zoom-motion`, `sn-render-scheduler` | wire into `viewer.js`; measure frame times first | 100-page PDF: frame times while scrolling, Ctrl+wheel and pinch; soak test |
| Floating reference reader and split view | `sn-reader-layout`, `sn-reader-documents` | always-on-top window, split view, drop and pick files | move, resize, dock, swap; wheel goes to the pane under the pointer |
| Text recognition keeps columns apart | `sn-blocks-ragged` | OCR reference run for three languages | references unchanged or better |
| Handwriting to typed text | – (decision pending) | recogniser choice, pen switch | – |

Extension tasks are `invite_only` until the host (`src/renderer/extensions.js`) is merged.

## Android preparation

The goal is to share notebook behavior between Windows and Android while accounting for differences in file access, pen input and screen size. The local implementation plan orders the work as follows. Check each step against the current branch before scheduling it.

1. Document the renderer's `window.api` contract and the capabilities each caller needs.
2. Define the platform adapter, with desktop and in-memory implementations for verification.
3. Move library, backup and sync behavior behind the adapter in independently tested changes. Cover case-only renames, import paths, large-file hashing and backups on platforms without hard links.
4. Remove assumptions about desktop-only file URLs. Exercise the renderer in a web build and gate platform-specific operations on capabilities.
5. Verify recognition, touch input and narrow layouts. Measure stylus latency on real devices before committing to the tablet experience. Track phone layout, sign-in, sync and on-demand PDF downloads as separate milestones.

## Lessons to apply during review

- For PDF text selection, derive test positions from the PDF font metrics. Include tables and spaced words when changing column detection.
- For OCR correction, preserve symbols and short variables. Compare against reference outputs before accepting changes to blur, rotation or font matching.
- For image edits, keep pixels outside the painted area transparent, handle failed canvas encoding and map coordinates using the scale actually applied.
- For sync, backup or file-format changes, exercise recovery and preservation of existing user data. In-memory tests cannot establish how Windows file locks behave.
- When a real example exposes a regression, add a neutral reproducer. Record which checks actually ran and which still require a device or maintainer.

## Keeping the plan current

When a new idea is accepted, record its intended behavior and verification here. Create a catalog entry once its inputs, allowed paths, prerequisites and acceptance criteria are clear. Use the claim's pinned revision when reading context. Submit an English handoff with the change. Use the merged PR as evidence of completion before scheduling follow-up work.
