# Connect to StudyNotes and take a task

The participant uses their own model account. The project
hosts intake, validation and GitHub publication. A participant supplies no
GitHub account, fork, local checkout, command line or API key.

Copy this address into the client's **MCP server URL** field:

    https://studynotes-contributions.studynotes-vlmelnik.workers.dev/mcp

Opening that address in a browser can return HTTP 405. Share this guide with participants.

## ChatGPT and Gemini

- **ChatGPT web:** Open Plugins, select **+**, then **Add custom MCP server**. Enter the address above, select no authentication and enable StudyNotes in the conversation. Full MCP access depends on plan and workspace permissions. [OpenAI setup and availability](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta)
- **Gemini web and mobile:** Eligible accounts can add a custom app in Gemini web under **Settings → Connected Apps**, then select it in a supported conversation on mobile. Google lists US, age, language and account restrictions. [Google setup and availability](https://support.google.com/gemini/answer/17209137)
- **Gemini CLI:** Run `gemini mcp add --transport http studynotes https://studynotes-contributions.studynotes-vlmelnik.workers.dev/mcp`, then check discovery with `gemini mcp list`. [Gemini CLI reference](https://geminicli.com/docs/tools/mcp-server/)

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

Prefer a strong coding model available in your account. Once connected, paste this prompt for each contribution:

> Use StudyNotes to claim the next task, read its pinned AGENTS.md, finish the task, and submit it with test results and a brief English handoff. Return the draft PR link or queue status.

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
