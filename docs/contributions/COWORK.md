# Help StudyNotes from Claude on iPhone

The participant uses their own Claude account with Cowork access. The project
hosts intake, validation and GitHub publication. A participant supplies no
GitHub account, fork, local checkout, command line or API key.

## First use

Get the actual HTTPS connector address and a private prompt from the maintainer.
Add a custom connector named StudyNotes to your Claude account with that address
(ending in /mcp). Leave OAuth fields empty. If the mobile app does not offer
custom connector setup, add it using Claude settings in a browser with the same
account, then reopen the app. Enable the connector in the Cowork session.
Organization settings may require an administrator to enable custom connectors.

Paste the private prompt into Cowork. Approve requested tool actions if Claude
asks. Each prompt contains a one-use invitation for a specific open task; use
a new invitation for the next contribution. Keep the conversation private.
After submission the Worker prepares a draft. GitHub Actions runs the offline checks on it.
Ask Claude to check the receipt again later in the same conversation.
A queued receipt means publication is pending. A published receipt links to
the draft. The provider account uses its own model allowance. The invitation
identifies an authorized submission; it does not verify the human's identity.

## Maintainer setup and acceptance test

Complete the [Cloudflare setup](CLOUDFLARE.md), including main protection and the project GitHub App.
The connector uses stateless MCP over HTTP with JSON responses. Tool discovery
is public. Claiming needs a signed invitation, subsequent operations need the
private receipt, and file reads are restricted to approved paths at the claimed
public revision. The validator and GitHub credentials remain on the project side.

Generate a participant prompt privately on the owner computer:

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
