import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApi } from './api.mjs';
import { openQueue } from './queue.mjs';
import { makeInvite, readTasks } from './policy.mjs';

test('Cowork discovery, invited pinned read, scoped upload and receipt over HTTP', async t => {
  const key = Buffer.alloc(32, 1);
  const path = 'docs/TESTING.md';
  const task = { id: 'sn-docs', title: 'Guide', instructions: 'Write a guide.', paths: [path] };
  const base = '1'.repeat(40);
  const queue = openQueue(':memory:');
  const server = createApi({ queue, tasks: readTasks([task]), inviteKey: key, head: async () => base,
    readFile: async (ref, path) => { assert.equal(ref, base); return { path, content: 'Project instructions' }; } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); queue.close(); });
  const url = 'http://127.0.0.1:' + server.address().port + '/mcp';
  const post = (method, params, id, headers) => fetch(url, { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id }) });
  const call = async (name, args) => {
    const response = await post('tools/call', { name, arguments: args }, 3);
    const { result } = await response.json();
    return { error: result.isError, data: JSON.parse(result.content[0].text) };
  };
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await post('ping', {}, 1, { origin: 'https://example.org' })).status, 403);
  const init = await (await post('initialize', { protocolVersion: '2025-06-18' }, 1)).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal((await post('notifications/initialized', {})).status, 202);
  assert.equal((await (await post('tools/list', {}, 2)).json()).result.tools.length, 4);
  const args = { task: task.id, invitation: makeInvite(key, task.id) };
  assert.equal((await call('claim_task', { ...args, invitation: 'invalid' })).error, true);
  const claim = (await call('claim_task', args)).data;
  assert.equal((await call('claim_task', args)).error, true);
  const receipt = { id: claim.id, token: claim.token };
  assert.equal((await call('read_context', { ...receipt, path: 'AGENTS.md' })).data.content, 'Project instructions');
  assert.equal((await call('read_context', { ...receipt, path: '.git/config' })).error, true);
  const upload = { ...receipt, files: [{ path, content: '# Test guide' }], report: 'Requested offline tests.' };
  assert.equal((await call('submit_work', { ...upload, report: receipt.token })).error, true);
  assert.equal((await call('submit_work', upload)).data.status, 'queued');
  assert.equal((await call('submit_work', upload)).data.status, 'queued');
  assert.equal((await call('check_status', { ...receipt, token: 'bad' })).error, true);
  assert.equal((await call('check_status', receipt)).data.status, 'queued');
});
