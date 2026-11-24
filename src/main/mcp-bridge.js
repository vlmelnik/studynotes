'use strict';
// Started by Claude Desktop (or another MCP client) as
//   StudyNotes.exe <this file>   with ELECTRON_RUN_AS_NODE=1
// It connects stdin/stdout to the running app's MCP pipe. If the app is not
// running it starts it and waits. Without the app (or with Claude access
// switched off) every request gets an error that says what to do.
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { pipePath } = require('./mcp-pipe');
const { lineReader } = require('../shared/mcp-protocol');

const WAIT_MS = Number(process.env.STUDYNOTES_MCP_WAIT || 30000);
const OFF = 'StudyNotes is not reachable. Open StudyNotes and switch on "Claude (MCP)" in Settings → Add-ons.';

function connect() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(pipePath());
    sock.once('connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

function startApp() {
  if (process.env.STUDYNOTES_MCP_NO_LAUNCH) return;
  // the app itself: the same executable without the run-as-node switch
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const appDir = path.join(__dirname, '..', '..');
  const args = process.defaultApp || !/app\.asar/.test(__dirname) ? [appDir] : [];
  try { spawn(process.execPath, args, { env, detached: true, stdio: 'ignore' }).unref(); } catch { /* reported as not reachable */ }
}

async function run() {
  let sock = await connect().catch(() => null);
  if (!sock) {
    startApp();
    const until = Date.now() + WAIT_MS;
    while (!sock && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 500));
      sock = await connect().catch(() => null);
    }
  }
  process.stdin.setEncoding('utf8');
  if (!sock) {
    // answer every request with the reason, so the client shows it
    const feed = lineReader();
    process.stdin.on('data', (chunk) => {
      for (const line of feed(chunk)) {
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === undefined) continue;
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: OFF } }) + '\n');
      }
    });
    process.stdin.on('end', () => process.exit(0));
    return;
  }
  process.stdin.pipe(sock);
  sock.pipe(process.stdout);
  sock.on('close', () => process.exit(0));
  sock.on('error', () => process.exit(1));
  process.stdin.on('end', () => sock.end());
}

if (require.main === module) run();
module.exports = { run };
