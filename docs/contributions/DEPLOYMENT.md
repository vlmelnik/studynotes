# Deploy the StudyNotes guest contribution service

Use a dedicated Linux VM. Run the intake service and rootless Docker under a
dedicated operating system account. Put HTTPS and request limits in front of
the loopback listener. Use a hardened container runtime such as gVisor where
available. Keep production data and keys outside the Git checkout. The service
runs one worker on one host with a local SQLite database.

## GitHub setup (repository owner)

1. Register a private GitHub App and disable its webhook. Grant repository
   permissions for **Contents: read and write** and **Pull requests: read and
   write**, plus GitHub's required read-only Metadata. Install it on
   vlmelnik/studynotes only. Record the App ID and the installation ID. Save
   the App private key directly to the VM's private credentials directory.
2. On main, enable a ruleset that requires pull requests and at least one
   approving review. Dismiss stale approvals, require up-to-date branches
   and the GitHub Actions checks named linux, windows, guest-service and
   guest-sandbox. Select GitHub Actions as check source where offered.
   The normal jobs are skipped for same-repository guest branches.
   The sandbox job is required for guest PRs and reports success for regular PRs.
   Let the workflow run from main once before selecting its check names.
3. Block force pushes and branch deletion on main. Keep the App out of
   all bypass lists. Disable auto-merge. Keep release secrets in a separate
   GitHub Environment restricted to trusted refs and human approval where
   your plan supports it. Maintain the privileged release workflows on
   their existing dispatch or branch triggers. Use hosted runners for guest
   PR checks and avoid pull_request_target jobs that run candidate code.

GitHub App permissions apply to the repository. The service enforces the
guest-contrib/ branch prefix and never calls merge, release, or settings APIs.
The GitHub ruleset is the separate enforcement layer for main.

- [Installation access token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub ruleset options](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

## Prepare the host

Install Node.js 24, Git, flock, rootless Docker, and a reverse proxy. Create a
dedicated service account. Use a checkout of reviewed main at
/srv/studynotes/repo and a private service data directory at
/var/lib/studynotes-guest. Use these paths in the examples or adapt them to
your host. As the service account, with the data directory already owned by
that account:

~~~sh
umask 077
mkdir -p /var/lib/studynotes-guest/keys
openssl rand -hex 32 > /var/lib/studynotes-guest/keys/invite.hex
git init --bare /var/lib/studynotes-guest/mirror.git
cd /srv/studynotes/repo
node tools/guest-contributions/build-image.mjs .
~~~

Save the GitHub App PEM at /var/lib/studynotes-guest/keys/github.pem, readable
only to the service account. If updating an existing deployment, keep the
current invitation key unless explicitly rotating it. Set the following
environment variables in a private service configuration file:

~~~dotenv
GUEST_APP_ID=<numeric App ID>
GUEST_INSTALLATION_ID=<numeric installation ID>
GUEST_APP_KEY_FILE=/var/lib/studynotes-guest/keys/github.pem
GUEST_INVITE_KEY_FILE=/var/lib/studynotes-guest/keys/invite.hex
GUEST_GIT_DIRECTORY=/var/lib/studynotes-guest/mirror.git
GUEST_DATABASE=/var/lib/studynotes-guest/queue.sqlite
GUEST_VALIDATOR_IMAGE=<sha256 image ID printed by build-image.mjs>
GUEST_PORT=8787
DOCKER_HOST=unix:///run/user/<service user UID>/docker.sock
~~~

Set GUEST_DOCKER_RUNTIME=runsc if installed in the rootless daemon. For
systemd, set User to the dedicated account, WorkingDirectory to the reviewed
checkout, UMask=0077, EnvironmentFile to the private configuration, and
Restart=on-failure. Use one instance with:

~~~ini
ExecStart=/usr/bin/flock --nonblock /var/lib/studynotes-guest/service.lock /usr/bin/node tools/guest-contributions/server.mjs serve
~~~

Adjust the Node path to match the host. Enable the service user's rootless
Docker daemon at boot. The Node process can reach GitHub, while the
validation process receives a single read-only archive without Git metadata
or credentials and runs offline. Its root filesystem is read-only. Docker
limits CPU, memory, process count and writable storage. The worker enforces
a time limit and passes the exact tested commit to the publisher.
[Nginx request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
and [rootless Docker](https://docs.docker.com/engine/security/rootless/) can
be configured independently.

For an Nginx front end, add the shared limits to the http block and the
location to the TLS server for the dedicated origin:

~~~nginx
# http block
limit_req_zone $binary_remote_addr zone=studynotes_guest_ip:10m rate=30r/m;
limit_conn_zone $binary_remote_addr zone=studynotes_guest_conn:10m;

# TLS server block
location /v1/ {
    limit_req zone=studynotes_guest_ip burst=12 nodelay;
    limit_req_status 429;
    limit_conn studynotes_guest_conn 4;
    client_max_body_size 384k;
    client_body_timeout 10s;
    proxy_read_timeout 25s;
    proxy_pass http://127.0.0.1:8787;
    access_log off;
}
~~~

Keep port 8787 private. If you use a CDN or another proxy before Nginx,
configure the trusted client IP source for the rate limits. Avoid logging
authorization headers and bodies at each layer.

## First live submission and operations

1. After merging the implementation and activating the ruleset, verify that
   GET /v1/tasks works over your public HTTPS origin.
2. Run the following command on a private terminal with
   GUEST_INVITE_KEY_FILE set. Send its complete output privately to the
   participant. Each invitation is single-use and expires after seven days.
   A participant needs an already working Claude Code environment and
   ordinary Git and Node commands.

   ~~~sh
   node tools/guest-contributions/server.mjs invite sn-docs-test-guide https://contribute.example.org
   ~~~
3. Run the pasted prompt from a clean account-free Git checkout. Check that
   the receipt returns a draft PR at the exact intended head, that
   guest-sandbox runs, and that the bot's token cannot bypass main protection.
   Close the pilot PR or manually approve and merge it after inspecting the
   diff. Validate these steps with the actual app before issuing more invites.

Keep the queue, Git mirror and keys across restarts. Use SQLite-aware backups
of queue.sqlite. The queue stores hashed claim tokens and clears the
submission body after publication or terminal failure. Limit access to
backups and prune according to your retention policy. A published submission
and its report are public on GitHub. The built-in credential pattern checks
catch common token formats. The maintainer must inspect content for secrets
and private material.

A main change before publication makes the submission stale. If main moves
during or after the GitHub PR request, the strict ruleset blocks the old
candidate. Close the draft and reissue an invitation on current main. A
closed PR's reservation releases when the worker observes it. Leave enough
time for the worker to reconcile open drafts. If a stale job left a branch
without a PR, a maintainer can remove that guest-contrib/ ref after checking
GitHub. The service leaves remote branches intact.

Deploy a new reviewed checkout and rebuild the validator image if either
npm manifest or the validation tooling changes. Pause intake during an
upgrade. The worker will wait and retry if the image and candidate npm
manifests differ. Check the proxy, service and GitHub settings if published
links stop arriving. If compromise is suspected, stop intake and suspend the
App installation. Rotate the App key and invitation key as appropriate.
