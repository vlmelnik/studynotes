'use strict';
// Where the running app listens for Claude (MCP): a named pipe on Windows, a
// socket file elsewhere, one per user. STUDYNOTES_MCP_PIPE overrides it (tests).
const os = require('os');
const path = require('path');

function pipePath() {
  if (process.env.STUDYNOTES_MCP_PIPE) return process.env.STUDYNOTES_MCP_PIPE;
  const user = String(os.userInfo().username || 'user').replace(/[^\w.-]/g, '_');
  return process.platform === 'win32' ? `\\\\.\\pipe\\studynotes-mcp-${user}` : path.join(os.tmpdir(), `studynotes-mcp-${user}.sock`);
}

module.exports = { pipePath };
