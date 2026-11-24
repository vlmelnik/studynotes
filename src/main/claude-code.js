'use strict';
// Chat with Claude inside StudyNotes through the user's own Claude Code (the
// `claude` command, signed in with their Claude plan) – the way Obsidian
// plugins like Claudian do it. StudyNotes starts `claude -p` for every message
// (resuming the conversation by its session id) and reads its stream of JSON
// events. Claude reaches the notebooks only through StudyNotes' MCP tools
// (src/main/mcp-bridge.js); its own tools for commands and files are off.
//
// Whether Anthropic's terms allow a subscription to be used this way is not
// settled; the settings say so and the user decides.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { TOOLS, INSTRUCTIONS } = require('../shared/mcp-tools');

const MCP_TOOLS = TOOLS.map((t) => `mcp__studynotes__${t.name}`);
// Claude Code's own tools that could touch the computer: never in this chat
const BLOCKED = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebFetch', 'Task', 'KillShell', 'BashOutput'];

/** Where `claude` is: the configured path, PATH, or the usual install folders. */
function findClaude(configured) {
  const tries = [];
  if (configured) tries.push(configured);
  if (process.env.STUDYNOTES_CLAUDE_BIN) tries.push(process.env.STUDYNOTES_CLAUDE_BIN);
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) for (const n of names) tries.push(path.join(dir, n));
  const home = os.homedir();
  if (process.platform === 'win32') {
    tries.push(path.join(home, '.local', 'bin', 'claude.exe'));
    if (process.env.APPDATA) tries.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'));
  } else tries.push(path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude');
  return tries.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// .cmd files (npm installs) need the Windows shell; arguments here never come from the user
function launch(bin, args, opts) {
  if (process.platform === 'win32' && /\.cmd$/i.test(bin)) return spawn('cmd.exe', ['/d', '/s', '/c', `"${bin}" ${args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(' ')}`], { ...opts, windowsVerbatimArguments: true });
  return spawn(bin, args, opts);
}

class ClaudeCodeChat {
  /** dir: a folder of its own (no project files, no CLAUDE.md); bridge: the MCP server entry */
  constructor({ dir, bridge }) {
    this.dir = dir;
    this.bridge = bridge;
    this.runs = new Map();
  }

  info(configured) {
    const bin = findClaude(configured);
    if (!bin) return { found: false };
    let version = '';
    try { version = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/i.test(bin) }).trim(); } catch { /* still usable */ }
    return { found: true, path: bin, version };
  }

  async mcpConfig() {
    await fsp.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, 'studynotes-mcp.json');
    await fsp.writeFile(file, JSON.stringify({ mcpServers: { studynotes: this.bridge() } }, null, 2));
    await fsp.writeFile(path.join(this.dir, 'studynotes-prompt.md'), `You are working inside StudyNotes, the user's note-taking app. ${INSTRUCTIONS}\n`);
    return file;
  }

  /**
   * send(id, { prompt, sessionId, model, bin }, emit) runs one turn. emit(event):
   *   { kind: 'session', sessionId }, { kind: 'text', text }, { kind: 'tool', name, input },
   *   { kind: 'done', sessionId, cost, error }
   */
  async send(id, { prompt, sessionId, model, bin: configured, attachments }, emit) {
    const bin = findClaude(configured);
    if (!bin) { emit({ kind: 'done', error: 'Claude Code was not found. Install it (claude.com/claude-code), run "claude" once in a terminal and sign in, or set its path in Settings → AI assistant.' }); return; }
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--mcp-config', await this.mcpConfig(),
      '--append-system-prompt-file', path.join(this.dir, 'studynotes-prompt.md'),
      '--allowedTools', MCP_TOOLS.join(','), '--disallowedTools', BLOCKED.join(',')];
    if (sessionId && /^[\w-]+$/.test(sessionId)) args.push('--resume', sessionId);
    if (model && /^[\w.-]+$/.test(model)) args.push('--model', model);
    // pictures and PDFs go as content blocks of a stream-json message (Claude sees them)
    const files = (Array.isArray(attachments) ? attachments : []).filter((a) => a && typeof a.data === 'string' && ATTACH_TYPES.has(a.mime));
    if (files.length) args.push('--input-format', 'stream-json');
    const p = launch(bin, args, { cwd: this.dir, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.runs.set(id, p);
    let buf = '', err = '', finished = false, session = sessionId || null;
    const finish = (e) => {
      if (finished) return;
      finished = true;
      this.runs.delete(id);
      emit({ kind: 'done', sessionId: session, ...e });
    };
    p.on('error', (e) => finish({ error: 'Claude Code could not be started: ' + e.message }));
    p.stderr.on('data', (c) => { err = (err + c).slice(-2000); });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (c) => {
      buf += c;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) { session = ev.session_id; emit({ kind: 'session', sessionId: session, model: ev.model }); }
        else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const part of ev.message.content) {
            if (part.type === 'text' && part.text) emit({ kind: 'text', text: part.text });
            else if (part.type === 'tool_use') emit({ kind: 'tool', name: String(part.name || '').replace(/^mcp__studynotes__/, ''), input: part.input || {} });
          }
        } else if (ev.type === 'result') {
          if (ev.session_id) session = ev.session_id;
          const bad = ev.is_error || (ev.subtype && ev.subtype !== 'success');
          finish({ cost: ev.total_cost_usd, error: bad ? readable(String(ev.result || ev.subtype || 'failed')) : null });
        }
      }
    });
    p.on('close', (code) => finish(code ? { error: readable(err.trim() || `Claude Code stopped (exit code ${code}).`) } : {}));
    if (!files.length) p.stdin.end(prompt);
    else {
      const content = [{ type: 'text', text: prompt }, ...files.map((a) => (a.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: a.mime, data: a.data }, title: String(a.name || 'document').slice(0, 200) }
        : { type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } }))];
      p.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
    }
  }

  stop(id) {
    const p = this.runs.get(id);
    if (!p) return;
    this.runs.delete(id);
    if (process.platform === 'win32') { try { spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); } catch { /* gone */ } } else p.kill();
  }
}

const ATTACH_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

// ---------- chat history (all chats, on this computer) ----------
const MAX_CHATS = 300;
class ChatHistory {
  constructor(file) { this.file = file; }
  async all() { try { const j = JSON.parse(await fsp.readFile(this.file, 'utf8')); return Array.isArray(j.chats) ? j.chats : []; } catch { return []; } }
  async write(chats) {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify({ version: 1, chats }));
    await fsp.rename(tmp, this.file);
  }
  async list() { return (await this.all()).map(({ id, title, notebook, updated, sessionId }) => ({ id, title, notebook, updated, sessionId })); }
  async get(id) { return (await this.all()).find((c) => c.id === id) || null; }
  async save(chat) {
    if (!chat || typeof chat.id !== 'string' || !/^[\w-]{1,64}$/.test(chat.id)) throw new Error('bad chat');
    const chats = (await this.all()).filter((c) => c.id !== chat.id);
    chats.unshift({ ...chat, updated: Date.now() });
    await this.write(chats.slice(0, MAX_CHATS));
  }
  async remove(id) { await this.write((await this.all()).filter((c) => c.id !== id)); }
}

function readable(msg) {
  if (/login|log in|authenticat|api key|unauthor/i.test(msg)) return 'Claude Code is not signed in. Open a terminal, run "claude" and sign in with your Claude account, then try again.';
  return msg.slice(0, 600);
}

module.exports = { ClaudeCodeChat, ChatHistory, findClaude, MCP_TOOLS, BLOCKED };
