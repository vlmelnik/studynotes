'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createMcpHandler, lineReader } = require('../../../src/shared/mcp-protocol');

const tools = [{ name: 'echo', description: 'e', inputSchema: { type: 'object', required: ['s'], properties: { s: { type: 'string' } } } }];
const handle = createMcpHandler({ name: 'StudyNotes', version: '1.9.0', instructions: 'hi', tools, call: async (n, a) => {
  if (a.s === 'boom') throw new Error('broken');
  if (a.s === 'img') return { content: [{ type: 'image', data: 'AAA', mimeType: 'image/png' }] };
  return a.s.toUpperCase();
} });

test('initialize answers with the asked version when known, else the newest', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.strictEqual(r.result.protocolVersion, '2025-03-26');
  assert.deepStrictEqual(r.result.serverInfo, { name: 'StudyNotes', version: '1.9.0' });
  assert.ok(r.result.capabilities.tools);
  assert.strictEqual(r.result.instructions, 'hi');
  const r2 = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.strictEqual(r2.result.protocolVersion, '2025-06-18');
});

test('notifications get no answer; ping, tools/list work; unknown methods are errors', async () => {
  assert.strictEqual(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepStrictEqual((await handle({ jsonrpc: '2.0', id: 3, method: 'ping' })).result, {});
  assert.strictEqual((await handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).result.tools[0].name, 'echo');
  assert.strictEqual((await handle({ jsonrpc: '2.0', id: 5, method: 'nope' })).error.code, -32601);
  assert.strictEqual((await handle({ id: 6, method: 'ping' })).error.code, -32600);
});

test('tools/call: text, content, missing arguments and failures as readable results', async () => {
  const call = (args, name = 'echo') => handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });
  assert.deepStrictEqual((await call({ s: 'ab' })).result, { content: [{ type: 'text', text: 'AB' }] });
  assert.strictEqual((await call({ s: 'img' })).result.content[0].type, 'image');
  const missing = (await call({})).result;
  assert.ok(missing.isError && /Missing: s/.test(missing.content[0].text));
  const failed = (await call({ s: 'boom' })).result;
  assert.ok(failed.isError && failed.content[0].text === 'broken');
  assert.strictEqual((await call({ s: 'x' }, 'other')).error.code, -32602);
});

test('lineReader joins chunks and splits lines', () => {
  const feed = lineReader();
  assert.deepStrictEqual(feed('{"a":1}\n{"b"'), ['{"a":1}']);
  assert.deepStrictEqual(feed(':2}\r\n\n'), ['{"b":2}']);
});
