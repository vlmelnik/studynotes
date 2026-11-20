import { createSign } from 'node:crypto';
import { baseBranch, repository } from './policy.mjs';

export function githubApp({ appId, installationId, privateKey }) {
  let installToken;
  let expires = 0;
  async function api(path, token, { method = 'GET', body, missing = false } = {}) {
    const response = await fetch('https://api.github.com' + path, {
      method, redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28', 'user-agent': 'studynotes-guest-contributions',
        ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) expires = 0;
      throw new Error('GitHub returned status ' + response.status);
    }
    return response.json();
  }

  async function token() {
    if (installToken && Date.now() < expires - 60_000) return installToken;
    const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({ alg: 'RS256', typ: 'JWT' }) + '.' +
      encode({ iat: now - 60, exp: now + 540, iss: appId });
    const jwt = payload + '.' + createSign('RSA-SHA256').update(payload).sign(privateKey, 'base64url');
    const result = await api('/app/installations/' + installationId + '/access_tokens', jwt, {
      method: 'POST',
      body: { repositories: [repository.split('/')[1]], permissions: { contents: 'write', pull_requests: 'write' } },
    });
    installToken = result.token;
    expires = Date.parse(result.expires_at);
    return installToken;
  }

  const prefix = '/repos/' + repository;
  async function get(path, options) {
    return api(prefix + path, await token(), options);
  }
  return {
    token,
    request: get,
    async head() {
      return (await get('/git/ref/heads/' + baseBranch)).object.sha;
    },
    async branch(branch) {
      return (await get('/git/ref/heads/' + branch.split('/').map(encodeURIComponent).join('/'),
        { missing: true }))?.object.sha;
    },
    async findPull(branch) {
      const filter = new URLSearchParams({ head: repository.split('/')[0] + ':' + branch, state: 'all' });
      const pulls = await get('/pulls?' + filter);
      return pulls.find(pr => pr.head.repo?.full_name === repository && pr.head.ref === branch);
    },
    pull: number => get('/pulls/' + number),
    openPull(branch, job, report, checked = true) {
      const body = 'Task: ' + job.task + '\nBase: ' + job.base + '\n' +
        (checked ? 'The intake service ran the offline unit and build checks.' : 'The guest-sandbox GitHub Actions check validates this draft.') + ' Review the changes and wait for CI before merging.\n' +
        (report ? '\nContributor report (self-reported):\n\n' +
          report.split(/\r?\n/).map(line => '    ' + line.replace(/\r/g, ' ')).join('\n') + '\n' : '');
      return get('/pulls', { method: 'POST', body: {
        title: 'Guest contribution ' + job.task, body, head: branch, base: baseBranch, draft: true,
      } });
    },
  };
}
