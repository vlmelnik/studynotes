'use strict';
// The app's side of the Claude connection (MCP). Listens on a local pipe that
// only the bridge (mcp-bridge.js, started by Claude Desktop) connects to.
// Speaks MCP (src/shared/mcp-protocol.js) and hands tool calls to the
// renderer, which runs them on the open notebooks.
const net = require('net');
const fs = require('fs');
const { createMcpHandler, lineReader } = require('../shared/mcp-protocol');
const { TOOLS, INSTRUCTIONS } = require('../shared/mcp-tools');
const { pipePath } = require('./mcp-pipe');

/** startMcp({ version, call(name, args) }) -> Promise<{ stop() }> */
function startMcp({ version, call }) {
  const handle = createMcpHandler({ name: 'StudyNotes', version, instructions: INSTRUCTIONS, tools: TOOLS, call });
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.setEncoding('utf8');
    const feed = lineReader();
    sock.on('data', async (chunk) => {
      for (const line of feed(chunk)) {
        let msg;
        try { msg = JSON.parse(line); } catch { sock.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
        const res = await handle(msg).catch((err) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: String(err.message || err) } }));
        if (res && !sock.destroyed) sock.write(JSON.stringify(res) + '\n');
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => sockets.delete(sock));
  });
  const where = pipePath();
  // a socket file left over from a crash blocks listen() (not on Windows)
  if (process.platform !== 'win32') { try { fs.unlinkSync(where); } catch { /* none */ } }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(where, () => {
      server.off('error', reject);
      resolve({
        where,
        stop: () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }),
      });
    });
  });
}

module.exports = { startMcp };
