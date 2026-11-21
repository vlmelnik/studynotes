import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openQueue } from './queue.mjs';
import { mcp } from './mcp.mjs';
import { readTasks } from './policy.mjs';

const base = '1'.repeat(40);
const task = (id, extra) => ({ id: 'sn-' + id, title: id, paths: ['docs/' + id + '.md'], instructions: 'Write it.', ...extra });

test('public claims respect private tasks, overlapping paths, quotas, dependencies and manual merge', async t => {
  const tasks = readTasks([task('private', { invite_only: true }), task('first'),
    task('overlap', { paths: ['docs/first.md'] }), task('later', { after: ['sn-first'] }), task('other')]);
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  const options = { queue, tasks, head: async () => base, openQueue: true, source: 'A' };
  const take = async source => {
    const r = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'take_next_task' } }, { ...options, source });
    return JSON.parse(r.result.content[0].text);
  };
  const first = await take('A');
  assert.equal(first.task, 'sn-first');
  assert.equal((await take('A')).status, 'limit_reached');
  assert.equal((await take('B')).task, 'sn-other');
  assert.equal((await take('C')).status, 'no_ready_task');
  queue.finish(first.id, 'merged');
  const overlap = await take('C');
  assert.equal(overlap.task, 'sn-overlap');
  assert.equal((await take('D')).task, 'sn-later');
  const release = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'release_task', arguments: { id: overlap.id, token: overlap.token },
  } }, options);
  assert.equal(JSON.parse(release.result.content[0].text).status, 'cancelled');
  assert.equal((await take('C')).task, 'sn-overlap');
});

test('released claims count towards rolling quotas and expired claims free the task', t => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  const tasks = readTasks([task('first')]);
  const start = 1000;
  for (let actor = 0; actor < 4; actor++) {
    for (let i = 0; i < 6; i++) {
      const c = queue.takeNext(tasks, base, String(actor), start);
      assert.equal(queue.cancel(c.id, c.token), 200);
    }
    assert.equal(queue.takeNext(tasks, base, String(actor), start).status, 'limit_reached');
  }
  assert.equal(queue.takeNext(tasks, base, 'fresh', start).status, 'limit_reached');
  const nextDay = start + 86400001;
  const c = queue.takeNext(tasks, base, 'fresh', nextDay);
  assert.equal(c.status, 'claimed');
  assert.equal(queue.takeNext(tasks, base, 'another', c.expiresAt + 1).status, 'claimed');
});
test('one source can continue after a confirmed submission without waiting for merge', async t => {
  const queue = openQueue(':memory:');
  t.after(() => queue.close());
  const tasks = readTasks([task('one'), task('two')]);
  const options = { queue, tasks, head: async () => base, openQueue: true, source: 'one contributor' };
  const call = async (name, args = {}) => {
    const response = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, options);
    assert.equal(response.result.isError, false);
    return JSON.parse(response.result.content[0].text);
  };
  for (const id of ['one', 'two']) {
    const claim = await call('take_next_task');
    assert.equal(claim.task, 'sn-' + id);
    assert.match(claim.sessionInstructions, /allowance is unknown/);
    const result = await call('submit_work', { id: claim.id, token: claim.token,
      files: [{ path: claim.paths[0], content: 'Completed task.' }], report: 'Verified.' });
    assert.equal(result.status, 'queued');
  }
  assert.equal((await call('take_next_task')).status, 'no_ready_task');
});
