'use strict';
// The same chat with ChatGPT instead of Claude: StudyNotes starts the user's
// own Codex CLI (`codex exec`, signed in with their ChatGPT plan), gives it
// the StudyNotes MCP tools and reads its JSON events. Same interface as
// ClaudeCodeChat (src/main/claude-code.js): send(id, req, emit), stop(id), info().
//
// Codex has no switch to turn its own shell off; it runs read-only in a folder
// of its own, and its instructions (AGENTS.md there) say to use only the
// StudyNotes tools.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { INSTRUCTIONS } = require('../shared/mcp-tools');

function findCodex(configured) {
  const tries = [];
  if (configured) tries.push(configured);
  if (process.env.STUDYNOTES_CODEX_BIN) tries.push(process.env.STUDYNOTES_CODEX_BIN);
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) for (const n of names) tries.push(path.join(dir, n));
  const home = os.homedir();
  if (process.platform === 'win32') {
    if (process.env.APPDATA) tries.push(path.join(process.env.APPDATA, 'npm', 'codex.cmd'));
    tries.push(path.join(home, '.local', 'bin', 'codex.exe'));
  } else tries.push(path.join(home, '.local', 'bin', 'codex'), '/usr/local/bin/codex', '/opt/homebrew/bin/codex');
  return tries.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

function launch(bin, args, opts) {
  if (process.platform === 'win32' && /\.cmd$/i.test(bin)) return spawn('cmd.exe', ['/d', '/s', '/c', `"${bin}" ${args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(' ')}`], { ...opts, windowsVerbatimArguments: true });
  return spawn(bin, args, opts);
}

const toml = (v) => JSON.stringify(String(v)); // a TOML basic string is a JSON string

/** The command line of one turn (pure, for tests). */
function codexArgs({ bridge, sessionId, model, images = [] }) {
  const args = ['exec'];
  if (sessionId && /^[\w-]+$/.test(sessionId)) args.push('resume', sessionId);
  args.push('--json', '--skip-git-repo-check', '--sandbox', 'read-only',
    '-c', 'approval_policy="never"',
    '-c', `mcp_servers.studynotes.command=${toml(bridge.command)}`,
    '-c', `mcp_servers.studynotes.args=[${(bridge.args || []).map(toml).join(',')}]`,
    '-c', `mcp_servers.studynotes.env={${Object.entries(bridge.env || {}).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`);
  if (model && /^[\w.-]+$/.test(model)) args.push('--model', model);
  for (const f of images) args.push('--image', f);
  args.push('-'); // the prompt comes on stdin
  return args;
}

/** One JSON line of `codex exec --json` → what the chat shows (pure, for tests). */
function codexEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (ev.type === 'thread.started' && ev.thread_id) return { kind: 'session', sessionId: ev.thread_id };
  const it = ev.item;
  if (ev.type === 'item.started' && it && it.type === 'mcp_tool_call') return { kind: 'tool', name: String(it.tool || ''), input: it.arguments || {} };
  if (ev.type === 'item.completed' && it && it.type === 'agent_message' && it.text) return { kind: 'text', text: it.text };
  if (ev.type === 'item.completed' && it && it.type === 'error' && it.message) return { kind: 'note', text: it.message };
  if (ev.type === 'turn.completed') return { kind: 'end' };
  if (ev.type === 'turn.failed') return { kind: 'end', error: (ev.error && ev.error.message) || 'Codex failed' };
  if (ev.type === 'error') return { kind: 'end', error: ev.message || 'Codex failed' };
  return null;
}

class CodexChat {
  /** dir: a folder of its own; bridge: () => the MCP server entry { command, args, env } */
  constructor({ dir, bridge }) { this.dir = dir; this.bridge = bridge; this.runs = new Map(); }

  info(configured) {
    const bin = findCodex(configured);
    if (!bin) return { found: false };
    let version = '';
    try { version = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/i.test(bin) }).trim(); } catch { /* still usable */ }
    return { found: true, path: bin, version };
  }

  async prepare(attachments) {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(path.join(this.dir, 'AGENTS.md'), `You are working inside StudyNotes, the user's note-taking app. ${INSTRUCTIONS}\nUse only the StudyNotes tools (MCP server "studynotes"). Never run shell commands and never read or change files on this computer.\n`);
    const att = path.join(this.dir, 'attachments');
    await fsp.rm(att, { recursive: true, force: true });
    const images = [];
    for (const a of attachments) {
      if (!a || typeof a.data !== 'string' || !/^image\/(png|jpeg|gif|webp)$/.test(a.mime)) continue;
      await fsp.mkdir(att, { recursive: true });
      const f = path.join(att, `${images.length + 1}.${a.mime.split('/')[1].replace('jpeg', 'jpg')}`);
      await fsp.writeFile(f, Buffer.from(a.data, 'base64'));
      images.push(f);
    }
    return images;
  }

  async send(id, { prompt, sessionId, model, bin: configured, attachments }, emit) {
    const bin = findCodex(configured);
    if (!bin) { emit({ kind: 'done', error: 'Codex was not found. Install it (npm install -g @openai/codex), run "codex" once in a terminal and sign in with your ChatGPT account, or set its path in Settings → AI assistant.' }); return; }
    const list = Array.isArray(attachments) ? attachments : [];
    const images = await this.prepare(list);
    const pdfs = list.filter((a) => a && a.mime === 'application/pdf').length;
    const p = launch(bin, codexArgs({ bridge: this.bridge(), sessionId, model, images }), { cwd: this.dir, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.runs.set(id, p);
    let buf = '', err = '', finished = false, session = sessionId || null;
    const finish = (e) => { if (finished) return; finished = true; this.runs.delete(id); emit({ kind: 'done', sessionId: session, ...e }); };
    p.on('error', (e) => finish({ error: 'Codex could not be started: ' + e.message }));
    p.stderr.on('data', (c) => { err = (err + c).slice(-2000); });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (c) => {
      buf += c;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let ev; try { ev = codexEvent(JSON.parse(line)); } catch { continue; }
        if (!ev) continue;
        if (ev.kind === 'session') { session = ev.sessionId; emit(ev); } else if (ev.kind === 'end') finish(ev.error ? { error: ev.error } : {});
        else if (ev.kind === 'note') emit({ kind: 'text', text: '⚠ ' + ev.text });
        else emit(ev);
      }
    });
    p.on('close', (code) => finish(code ? { error: (err.trim().split('\n').slice(-3).join('\n')) || `Codex stopped (exit code ${code}).` } : {}));
    p.stdin.on('error', () => {});
    p.stdin.end(prompt + (pdfs ? `\n\n(${pdfs} PDF attachment(s) cannot be passed to Codex – ask the user to paste the text.)` : ''));
  }

  stop(id) {
    const p = this.runs.get(id);
    if (!p) return;
    this.runs.delete(id);
    if (process.platform === 'win32') { try { spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); } catch { /* gone */ } } else p.kill();
  }
}

module.exports = { CodexChat, codexArgs, codexEvent, findCodex };
