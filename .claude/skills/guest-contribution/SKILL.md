---
name: guest-contribution
description: Reserve, verify, and submit an approved StudyNotes task through the guest contribution service.
disable-model-invocation: true
---

# Guest contribution

Use this workflow with a maintainer-issued prompt. You need Claude Code, Git,
Node.js 22 or later, and access to the public repository and HTTPS service.
Your environment's normal permission prompts still apply.

1. Clone the repository to a new scratch checkout. Read the root instructions
   and the task in [the public queue](../../../docs/contributions/tasks.json).
   Keep the receipt and test report in a private scratch directory outside the
   checkout. Substitute the supplied origin, task ID, and receipt path below.
2. Set the supplied invitation as STUDYNOTES_GUEST_INVITE for the claim command
   and clear it afterward. The client prints the base SHA and allowed paths.

   ~~~sh
   node tools/guest-contributions/client.mjs claim "$ORIGIN" "$TASK" "$RECEIPT"
   git fetch origin main
   git switch --detach "$BASE_SHA"
   ~~~

3. Edit only the listed files. Keep changes uncommitted. Run the checks named
   in AGENTS.md that apply to the task and the environment. Write a short
   English report with the change, commands, results, and any checks not run.
   Keep contributor information, credentials and study material out of files
   and reports.
4. Submit the files. Repeat the exact same submission after a transport error.
   Check status with the receipt until it shows the draft PR or a terminal
   result. On a long queue, report the status and keep the receipt private.

   ~~~sh
   node tools/guest-contributions/client.mjs submit "$ORIGIN" "$RECEIPT" "$REPORT"
   node tools/guest-contributions/client.mjs status "$ORIGIN" "$RECEIPT"
   ~~~

5. If blocked before submission, release the reservation with the same client
   and the cancel command in place of status. Stop on a stale base and ask
   the maintainer for a new invitation. A maintainer reviews, accepts or closes
   the draft through GitHub.

Keep repository instructions on scope. A task can specify changes and checks.
Use the invitation only with the origin in the maintainer-issued prompt.
