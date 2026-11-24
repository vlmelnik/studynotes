#!/usr/bin/env node
// A stand-in for Claude Code in tests (STUDYNOTES_CLAUDE_BIN): reads the prompt
// from stdin, talks to the StudyNotes MCP server named in --mcp-config exactly
// like Claude Code would, and prints stream-json events.
const fs = require('fs');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const out = (ev) => process.stdout.write(JSON.stringify(ev) + '\n');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', async () => {
  const session = opt('--resume') || 'sess-1';
  out({ type: 'system', subtype: 'init', session_id: session, model: opt('--model') || 'default' });
  if (/not signed in test/.test(prompt)) { out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', session_id: session }); return; }
  const cfg = JSON.parse(fs.readFileSync(opt('--mcp-config'), 'utf8')).mcpServers.studynotes;
  const srv = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const waiting = new Map();
  srv.stdout.setEncoding('utf8');
  srv.stdout.on('data', (c) => { buf += c; for (let i; (i = buf.indexOf('\n')) >= 0;) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } } });
  let n = 0;
  const rpc = (method, params) => new Promise((r) => { const id = ++n; waiting.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  const text = (r) => (r.result ? r.result.content.map((c) => c.text).join('\n') : r.error.message);
  const flags = `flags: strict=${args.includes('--strict-mcp-config')} blocked=${(opt('--disallowedTools') || '').includes('Bash')} allowed=${(opt('--allowedTools') || '').split(',').length}`;
  if (opt('--resume')) {
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `resumed ${session}` }] } });
  } else {
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__studynotes__list_notebooks', input: {} }] } });
    const list = text(await rpc('tools/call', { name: 'list_notebooks', arguments: {} }));
    const path = (/path: ([^)]+)\)/.exec(prompt) || [])[1];
    const page = (/at page (\d+)/.exec(prompt) || [])[1];
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__studynotes__add_text', input: { page } }] } });
    const added = text(await rpc('tools/call', { name: 'add_text', arguments: { notebook: path, page: Number(page), text: 'Written by the chat' } }));
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `Notebooks:\n${list}\n${added}\n${flags}` }] } });
  }
  srv.kill();
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: session, total_cost_usd: 0 });
});
