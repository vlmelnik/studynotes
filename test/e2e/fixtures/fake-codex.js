#!/usr/bin/env node
// A stand-in for the Codex CLI in tests (STUDYNOTES_CODEX_BIN): `codex exec
// [resume ID] --json … -c mcp_servers.studynotes.… - < prompt`. Talks to the
// StudyNotes MCP server from the -c overrides and prints Codex's JSON events.
const { spawn } = require('child_process');
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const conf = {};
for (let i = 0; i < args.length; i++) if (args[i] === '-c') { const [k, ...v] = args[i + 1].split('='); conf[k] = v.join('='); }
const toml = (v) => JSON.parse(v.replace(/^\{(.*)\}$/, (m, b) => '{' + b.replace(/(\w+)=/g, '"$1":') + '}'));
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', async () => {
  const thread = args[1] === 'resume' ? args[2] : 'thread-1';
  out({ type: 'thread.started', thread_id: thread });
  out({ type: 'turn.started' });
  const srv = spawn(toml(conf['mcp_servers.studynotes.command']), toml(conf['mcp_servers.studynotes.args']), { env: { ...process.env, ...toml(conf['mcp_servers.studynotes.env']) }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', n = 0;
  const waiting = new Map();
  srv.stdout.setEncoding('utf8');
  srv.stdout.on('data', (c) => { buf += c; for (let i; (i = buf.indexOf('\n')) >= 0;) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } } });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; waiting.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  out({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'studynotes', tool: 'list_notebooks', arguments: {}, status: 'in_progress' } });
  const r = await rpc('tools/call', { name: 'list_notebooks', arguments: {} });
  const text = r.result ? r.result.content.map((c) => c.text).join('\n') : r.error.message;
  out({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: `codex: images=${args.filter((a) => a === '--image').length} sandbox=${args[args.indexOf('--sandbox') + 1]} resumed=${args[1] === 'resume'} ${text.split('\n')[0]}` } });
  out({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
  srv.kill();
  process.exit(0);
});
