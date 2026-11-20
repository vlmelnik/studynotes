import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { openQueue } from './queue.mjs';
import { createApi } from './api.mjs';
import { makeInvite, readTasks } from './policy.mjs';

const key = Buffer.alloc(32, 7);
const base = '1'.repeat(40);
const path = 'docs/example.md';
const task = id => ({ id, title: 'Example', instructions: 'Update the example.', paths: [path] });

test('HTTP claims are single use, overlapping claims conflict, and upload is scoped and idempotent', async t => {
  let head = base;
  const tasks = readTasks([task('sn-1'), task('sn-2')]);
  const queue = openQueue(':memory:');
  const server = createApi({ queue, tasks, inviteKey: key, head: async () => head });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); queue.close(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const call = async (route, body, token) => {
    const response = await fetch(origin + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token && { authorization: 'Bearer ' + token }),
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return [response.status, await response.json()];
  };
  assert.equal((await call('/v1/tasks'))[1].tasks.length, 2);
  assert.equal((await call('/v1/claims', { task: 'sn-1' }, 'invalid'))[0], 401);
  const invite = makeInvite(key, 'sn-1');
  const claims = await Promise.all([
    call('/v1/claims', { task: 'sn-1' }, invite),
    call('/v1/claims', { task: 'sn-1' }, invite),
  ]);
  assert.deepEqual(claims.map(([status]) => status).sort(), [201, 409]);
  const [, claim] = claims.find(([status]) => status === 201);
  assert.equal((await call('/v1/claims', { task: 'sn-2' }, makeInvite(key, 'sn-2')))[0], 409);
  const route = '/v1/claims/' + claim.id;
  const upload = { base, files: [{ path, content: 'Hello\n' }] };
  assert.equal((await call(route, undefined, 'invalid'))[0], 404);
  assert.equal((await call(route, { ...upload, files: [{ path: '.github/workflows/ci.yml', content: 'x' }] }, claim.token))[0], 400);
  assert.equal((await call(route, { ...upload, files: [upload.files[0], upload.files[0]] }, claim.token))[0], 400);
  head = '2'.repeat(40);
  assert.equal((await call(route, upload, claim.token))[0], 409);
  head = base;
  assert.equal((await call(route, upload, claim.token))[0], 202);
  assert.equal((await call(route, upload, claim.token))[0], 202);
  assert.equal((await call(route, { ...upload, files: [{ path, content: 'different\n' }] }, claim.token))[0], 409);
  assert.equal((await call(route, undefined, claim.token))[1].status, 'queued');
  assert.equal(queue.next().id, claim.id);
  queue.validated(claim.id, '3'.repeat(40));
  queue.published(claim.id, 5, 'https://github.com/vlmelnik/studynotes/pull/5');
  assert.equal((await call('/v1/claims', { task: 'sn-2' }, makeInvite(key, 'sn-2')))[0], 409);
  queue.finish(claim.id, 'merged');
  assert.equal((await call('/v1/claims', { task: 'sn-1' }, makeInvite(key, 'sn-1')))[0], 409);
  assert.equal((await call('/v1/claims', { task: 'sn-2' }, makeInvite(key, 'sn-2')))[0], 201);
});

test('task policy rejects privileged paths, traversal, reserved names and ambiguous scopes', () => {
  for (const unsafe of [
    '.github/workflows/ci.yml', 'docs/../safe.md', 'docs/.git/config.md',
    'docs/CON.md', 'src/main/main.js', 'package-lock.json', 'docs/name.md/child.md',
  ]) {
    assert.throws(() => readTasks([{ ...task('sn-1'), paths: [unsafe] }]));
  }
  assert.throws(() => readTasks([task('sn-1'), task('sn-1')]));
});

test('expired reservations release the scope and keep the invite single-use', () => {
  const queue = openQueue(':memory:');
  const job = queue.claim({ task: task('sn-1'), base, nonce: 'invite-1', now: 0 });
  assert.equal(queue.status(job.id, job.token, 9_000_000).status, 'expired');
  assert.equal(queue.claim({ task: task('sn-1'), base, nonce: 'invite-1', now: 9_000_000 }), null);
  assert.ok(queue.claim({ task: task('sn-1'), base, nonce: 'invite-2', now: 9_000_000 }));
  queue.close();
});
