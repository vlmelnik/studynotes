# StudyNotes development plan and engineering lessons

Use this public roadmap when preparing queue entries or when an assigned task needs product context. The [task catalog](tasks.json) defines the exact files and acceptance criteria for a claim. Check the current code, open PRs and merged work before creating a task from this page. A roadmap item can span several PRs.

## Desktop backlog

| Outcome | Work that can be assigned separately | Integration check |
| --- | --- | --- |
| Paste a copied selection into another app as a picture | Choose original image or rendered selection, preserve plain text and bound rendering size. See `sn-clip-plan`. | Paste into another app and back into StudyNotes. |
| Use the editor in a half-width window | Calculate which toolbar items fit and where floating controls can go. See `sn-toolbar-fit` and `sn-float-place`. | Resize the window with a selection active and verify the controls remain reachable. |
| Navigate multiple PDFs and outlines in one notebook | Map source pages, build and move outline nodes, then export an outline. See the `sn-outline-*` entries. | Reopen the notebook and verify that entries still point to the right document and page. |
| Read PDFs in dark mode | Separate page display colors from ink handling. See `sn-dark-colors` and `sn-dark-ink`. | Verify that switching the view preserves original document content. |
| Preserve formulas in pasted text | Handle plain text, HTML and Markdown input separately. See `sn-paste-*`. | Compare rendering and text round trips with representative equations. |
| Improve handwriting and text recognition | Evaluate block detection, conversion to typed text and font matching independently. | Run recognition references for all three languages and include tilted and blurred samples. |

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
