'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { codexArgs, codexEvent } = require('../../../src/main/codex-chat');

test('codex exec: read-only, StudyNotes MCP from -c, resume, images, prompt on stdin', () => {
  const a = codexArgs({ bridge: { command: 'C:\\SN\\StudyNotes.exe', args: ['C:\\SN\\mcp-bridge.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }, sessionId: 'th-1', model: 'gpt-5', images: ['x.png'] });
  assert.deepStrictEqual(a.slice(0, 3), ['exec', 'resume', 'th-1']);
  assert.ok(a.includes('--json') && a[a.indexOf('--sandbox') + 1] === 'read-only');
  assert.ok(a.includes('mcp_servers.studynotes.command="C:\\\\SN\\\\StudyNotes.exe"'));
  assert.ok(a.includes('mcp_servers.studynotes.args=["C:\\\\SN\\\\mcp-bridge.js"]'));
  assert.ok(a.includes('mcp_servers.studynotes.env={ELECTRON_RUN_AS_NODE="1"}'));
  assert.strictEqual(a[a.indexOf('--image') + 1], 'x.png');
  assert.strictEqual(a[a.length - 1], '-');
  assert.ok(!codexArgs({ bridge: { command: 'c' }, sessionId: 'bad id;rm' }).includes('resume'));
});

test('codex events → chat events', () => {
  assert.deepStrictEqual(codexEvent({ type: 'thread.started', thread_id: 't9' }), { kind: 'session', sessionId: 't9' });
  assert.deepStrictEqual(codexEvent({ type: 'item.started', item: { type: 'mcp_tool_call', tool: 'write_notes', arguments: { a: 1 } } }), { kind: 'tool', name: 'write_notes', input: { a: 1 } });
  assert.deepStrictEqual(codexEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }), { kind: 'text', text: 'hi' });
  assert.deepStrictEqual(codexEvent({ type: 'turn.failed', error: { message: 'limit' } }), { kind: 'end', error: 'limit' });
  assert.strictEqual(codexEvent({ type: 'item.completed', item: { type: 'reasoning', text: 'x' } }), null);
});
