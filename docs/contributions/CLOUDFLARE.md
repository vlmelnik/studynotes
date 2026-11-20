# Deploy the mobile pilot on Cloudflare Workers Free

One Worker serves the Claude connector at its workers.dev address. A single
SQLite-backed Durable Object reserves tasks, stores submissions and wakes on
an alarm to publish a draft. GitHub Actions runs the trusted base validator
with a read-only token and an offline container. Review the required check on
the draft before merging. An open draft can still fail validation.

## Activate once

1. Review the implementation PR. Merge the reviewed code and enable the main
   protections in [GitHub setup](DEPLOYMENT.md#github-setup-repository-owner)
   before issuing invitations. Require the guest-sandbox check, up-to-date
   branches and maintainer approval. Restrict bypass and force pushes.
2. At [GitHub Apps](https://github.com/settings/apps/new), create a private App
   for this repository with Contents and Pull requests read/write and Metadata
   read-only. Disable webhooks. Install on StudyNotes alone. Save its generated
   PEM in a private directory outside the checkout. Record the numerical App ID
   and installation ID. Do not grant workflows, administration or bypass.
3. Sign into a Cloudflare Free account and select a workers.dev subdomain
   when prompted. From the checkout on the owner computer with Node 24,
   run the commands below. Use the displayed workers.dev URL. This creates
   the SQLite object automatically; it requires no VM, custom domain, external
   database or paid subscription. Keep the binding and migration on updates.

       cd tools/guest-contributions/cloudflare
       npx wrangler@4.166.0 login
       npx wrangler@4.166.0 deploy

4. Set GUEST_APP_ID, GUEST_INSTALLATION_ID, GUEST_APP_KEY (the entire PEM)
   and GUEST_INVITE_KEY (64 random hex characters) as encrypted Worker secrets
   in the Cloudflare dashboard under Workers & Pages, the Worker, Settings,
   Variables and Secrets. Keep an identical invitation key file in the owner's
   private directory. Generate it there with Node:

       node -e "require('node:fs').writeFileSync('studynotes-invite.key',require('node:crypto').randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'})"

   On Windows use a directory accessible only to the owner. Deploy the secret
   changes. Tool discovery works before setup; task calls require all secrets.
   Never put these values into a prompt, a repository or GitHub Actions.
5. Set GUEST_INVITE_KEY_FILE on the owner computer to the private key file
   path. From the repository root, replace the example origin with the HTTPS
   origin printed by Wrangler:

       node tools/guest-contributions/server.mjs cowork-invite sn-docs-test-guide https://studynotes-contributions.YOUR-SUBDOMAIN.workers.dev

   Send only the generated one-task prompt and the connector URL ending in /mcp
   to the participant. Follow the [iPhone pilot checklist](COWORK.md).
   Validate one real draft and its CI before inviting anyone else.

## Operations

The Worker accepts only POST /mcp and limits requests to 384 KiB and 60 per
minute per source IP per Cloudflare location. Claude clients may share an
egress address. A spent invitation cannot be used again. The client may
retry the same upload with its receipt. Durably recorded commit hashes and
branch/PR lookups let publication resume after a lost GitHub response.
Open drafts are reconciled about every 30 minutes. Merged tasks stay closed.
A stale submission needs a fresh invitation. Keep file scopes short and
within the runtime limits of the free plan. Disable intake by removing the
invitation secret; suspend the GitHub App installation to stop publication.
Rotate exposed secrets, and avoid logging prompt text, submissions or receipts.

Further reading: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).
