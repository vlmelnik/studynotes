# Public contribution tasks

This queue publishes selected tasks for external contributors. The private
development journal stays in dev-notes. Pick one ready task, check open
pull requests for its ID, and use that ID in the branch, commit and PR title.
A draft PR shows that someone has already submitted the task. Check again
before publishing and stop if another contributor has an open PR for that
ID. Two contributors can start at the same time, so a maintainer resolves
any duplicates.

## Ready

### SN-001 — Document how to verify a StudyNotes change

- Scope: add docs/TESTING.md.
- Acceptance: explain when to use the unit suite, the build, and the
  Electron smoke test. List the Linux smoke prerequisites and show the
  exact invocation used by CI. Explain what an optional skipped test means.
- Verify: cross-check every command against package.json, AGENTS.md and
  .github/workflows/ci.yml. Run git diff --check before committing.

### SN-002 — Cover saved stacking order

- Scope: edit test/unit/shared/stacking.test.js.
- Acceptance: add a regression test that covers reloaded objects with an
  explicit z index. Verify that larger indices are drawn above smaller
  ones, ties preserve order, and another layer is excluded. Use synthetic
  fixtures and keep the application code untouched.
- Verify: run node --test test/unit/shared/stacking.test.js and
  git diff --check before committing.
