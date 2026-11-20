import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openQueue } from './queue.mjs';
import { publish } from './cloudflare/publish.mjs';

const base = '1'.repeat(40);
const commit = '2'.repeat(40);
function fixture(t) {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  const task = { id: 'sn-docs', paths: ['docs/TESTING.md'] };
  const tasks = new Map([[task.id, task]]);
  const claim = queue.claim({ task, base, nonce: 'one' });
  queue.submit(claim.id, claim.token, { base, files: [{ path: task.paths[0], content: 'Example' }], report: '' }, base);
  return { queue, claim, tick: github => publish(queue, github, tasks, queue.next()) };
}

test('cloud publisher rejects a case collision before creating any Git objects', async t => {
  const { tick, queue, claim } = fixture(t);
  await tick({ findPull: async () => null, head: async () => base, request: async (path, options) => {
    assert.equal(options, undefined);
    return path.startsWith('/git/commits/') ? { tree: { sha: 'abcd' } }
      : { tree: [{ path: 'Docs', mode: '040000' }] };
  } });
  assert.equal(queue.status(claim.id, claim.token).status, 'rejected');
});

test('cloud publisher recovers an existing draft after the create response is lost', async t => {
  const { tick, queue, claim } = fixture(t);
  let pr, ref;
  let creates = 0;
  const github = {
    head: async () => base, findPull: async () => pr, branch: async () => ref,
    request: async (path, options) => {
      if (path.startsWith('/git/commits/')) return { tree: { sha: 'before' } };
      if (path.startsWith('/git/trees/')) return { tree: [] };
      if (path === '/git/trees') return { sha: 'after' };
      if (path === '/git/commits') return { sha: commit };
      assert.equal(path, '/git/refs');
      assert.match(options.body.ref, /^refs\/heads\/guest-contrib\/sn-docs\//);
      ref = options.body.sha;
    },
    openPull: async (branch, job, report, checked) => {
      creates++;
      assert.equal(checked, false);
      pr = { number: 10, html_url: 'https://example.invalid/pr/10', head: { sha: ref }, base: { ref: 'main' } };
      throw new Error('lost response');
    },
  };
  await tick(github);
  await assert.rejects(tick(github), /lost response/);
  await tick(github);
  assert.equal(creates, 1);
  assert.equal(queue.status(claim.id, claim.token).pullRequest, pr.html_url);
});
