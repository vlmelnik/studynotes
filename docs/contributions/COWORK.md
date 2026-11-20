# Help StudyNotes from Claude on iPhone

The participant uses their own Claude account with Cowork access. The project
hosts intake, validation and GitHub publication. A participant supplies no
GitHub account, fork, local checkout, command line or API key.

## Codex and other MCP clients

Codex CLI and desktop can use the same remote connector and prompt. Register
the URL once in the participant's own Codex environment:

    codex mcp add studynotes --url https://studynotes-contributions.studynotes-vlmelnik.workers.dev/mcp
    codex mcp get studynotes

Start a new Codex session, then paste the prompt below. Use the connector for
submission so the participant does not need a GitHub identity or a local clone.
For an Ollama-backed agent, configure the same remote Streamable HTTP MCP URL
in the agent client and select a tool-capable model. A client using only the
Ollama inference API must implement the MCP tool-call loop itself.

## First use in Claude

Use the deployed connector at https://studynotes-contributions.studynotes-vlmelnik.workers.dev/mcp.
Add a custom connector named StudyNotes to your Claude account with that address
(ending in /mcp). Leave OAuth fields empty. If the mobile app does not offer
custom connector setup, add it using Claude settings in a browser with the same
account, then reopen the app. Enable the connector in the Cowork session.
Organization settings may require an administrator to enable custom connectors.

Paste this reusable prompt into Claude or Codex for each new contribution:

> Use the StudyNotes connector to take the next ready task with take_next_task. Read its instructions and pinned context, complete only that task, and submit the full changed files and an English handoff. Keep the receipt private. If no task is available, stop. If you cannot finish before submitting, call release_task. Return the draft PR link or the queued status. Leave merging to the maintainer.

Open claims follow the deployed task list in order and wait for merged prerequisites.
A reservation lasts two hours. At most one unfinished public claim and six reservations
per rolling day are allowed per network source, with a global cap of 24 reservations.
Clients can share an egress IP. These limits do not identify individuals. Closed drafts
release their tasks on reconciliation; merged tasks stay complete. A maintainer can
restrict a task with `invite_only: true`. Redeploy the Worker when updating the task list.

After submission the Worker prepares a draft. GitHub Actions runs the offline checks on it.
Ask Claude to check the receipt again later in the same conversation.
A queued receipt means publication is pending. A published receipt links to
the draft. The participant uses their own model allowance.

## Maintainer setup and acceptance test

Complete the [Cloudflare setup](CLOUDFLARE.md), including main protection and the project GitHub App.
The connector uses stateless MCP over HTTP with JSON responses. Tool discovery
is public. Private tasks require a signed invitation. After claiming, operations need the
private receipt, and file reads are restricted to approved paths at the claimed
public revision. The validator and GitHub credentials remain on the project side.

For the optional invited flow, generate a private prompt on the owner computer:

    node tools/guest-contributions/server.mjs cowork-invite sn-docs-test-guide https://contribute.example.org

Replace the example origin with the deployed origin. Share the prompt privately.
Use one invitation on an independent Claude account with no GitHub connection.
Verify discovery, setup on the phone, permission prompts, pinned context access,
scope rejection, submission, the actual draft URL, checks and manual approval.
Record provider/app version and the number of taps before inviting others.
The repository tests use local HTTP and a simulated publisher. Real Claude
interoperability and hosted GitHub publication require this acceptance test.

The public queue includes a documentation task and an independent shared-code
test. A maintainer checks the private development plan before issuing a task.
Review the exact diff and the validation results. The contributor's report
stays with the PR. Merged PRs are the accepted-work journal. Each PR links the
task, files changed and report. Keep pending drafts out of release notes.
