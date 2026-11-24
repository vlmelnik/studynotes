'use strict';
// The Model Context Protocol, as far as StudyNotes needs it: JSON-RPC 2.0
// messages for initialize, ping, tools/list and tools/call (one message per
// line on the transport). Claude Desktop (or any MCP client) talks to it
// through `StudyNotes.exe <mcp-bridge.js>`; the tools themselves are run by
// `call`. Pure: unit-tested.

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * createMcpHandler({ name, version, instructions, tools, call })
 *   tools: [{ name, description, inputSchema }]
 *   call(name, args) -> Promise<{ text } | { content } | string>
 * Returns handle(message) -> Promise<response object | null> (null for notifications).
 */
function createMcpHandler({ name, version, instructions = '', tools, call }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid request');
    }
    const { id, method, params = {} } = msg;
    const notification = id === undefined;
    if (notification) return null; // notifications/initialized, cancelled …: nothing to answer
    if (method === 'initialize') {
      const asked = params.protocolVersion;
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
          ...(instructions ? { instructions } : {}),
        },
      };
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } };
    if (method === 'tools/call') {
      const tool = byName.get(params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
      if (missing.length) return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `Missing: ${missing.join(', ')}` }] } };
      try {
        const r = await call(tool.name, args);
        const content = typeof r === 'string' ? [{ type: 'text', text: r }] : r && r.content ? r.content : [{ type: 'text', text: r && r.text !== undefined ? String(r.text) : JSON.stringify(r) }];
        return { jsonrpc: '2.0', id, result: { content } };
      } catch (err) {
        // a tool failure is a result the model can read, not a protocol error
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String((err && err.message) || err) }] } };
      }
    }
    return rpcError(id, -32601, `Method not found: ${method}`);
  };
}

/** Splits a byte stream into lines; feed(chunk) -> complete lines. */
function lineReader() {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    const parts = buf.split('\n');
    buf = parts.pop();
    return parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
  };
}

module.exports = { createMcpHandler, lineReader, PROTOCOL_VERSIONS };
