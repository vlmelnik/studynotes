# Contributing without a GitHub account

**Claude on iPhone:** Use the [Cowork connector pilot](COWORK.md) to receive files and submit work in the app.

For the command-line client, a maintainer can issue one paste-ready prompt for a specific public task.
Paste it into Claude Code and let it work in a fresh checkout. The service
reserves the task and its files. It turns a submission that passes offline
checks into a draft PR with a link in the private receipt. GitHub account
and repository access are handled by the project's GitHub App.

The public queue lives in [tasks.json](tasks.json). It is a short list of
maintainer-approved work alongside the private development journal described
in [AGENTS.md](../../AGENTS.md). The pilot task adds a focused testing guide
and is intentionally scoped to one new Markdown file.

Queue rules for maintainers:

- Give each task a permanent sn- identifier, a clear English title, concrete
  acceptance criteria and exact paths. Approve small, independent work. Check
  that it has no active internal owner before issuing an invitation.
- The service accepts only listed regular text files in top-level docs,
  src/shared, and test/unit/shared. It permits additions and replacements.
  Changes to workflows, dependencies, release files, permissions, service
  code and Claude instructions follow the normal maintainer PR process.
- A claim holds its task and all listed paths for two hours. An uploaded job
  retains those locks through validation and review. Closed PRs release the
  locks. A merged task ID stays used and should be removed from the public
  queue during maintainer housekeeping. Keep the SQLite state across deploys.
- Treat a submission and its report as untrusted. Inspect the diff and
  confirm the acceptance criteria before approving. A human marks the draft
  ready and merges after review and required checks.

See the [Cloudflare setup](CLOUDFLARE.md) for the mobile pilot, [Linux deployment](DEPLOYMENT.md) for the CLI service and
[Claude's contributor instructions](../../.claude/skills/guest-contribution/SKILL.md)
for the participant commands.

## Task chains and handover notes

Tasks in [tasks.json](tasks.json) are small enough for one session and fit the
service's file scope (`docs/*.md`, `src/shared`, `test/unit/shared`). Two
optional fields, ignored by the service, keep the work moving between
sessions that do not know each other:

- `chain`: the feature a task belongs to (clipboard, layout, outline, dark,
  paste, handwriting, android, recognition). Every task of a chain appends a
  dated section to that chain's notes file (`docs/NOTES-<CHAIN>.md`, listed in
  its paths): what was done, decisions, what is open, what the next task needs.
  The next contributor reads it as part of the task's files.
- `after`: task IDs that must be merged first. Issue an invitation only when
  they are; a task started too early stops and reports "blocked".

Chains are independent, so several people can work at the same time, one
task per chain. The maintainer's part stays: review and merge the draft PR,
then invite for the next ready task (any task whose `after` tasks are merged
and that has no open PR). Wiring the pure modules into the app (renderer,
main process) is done by the maintainer afterwards; each notes file collects
what that wiring needs.
