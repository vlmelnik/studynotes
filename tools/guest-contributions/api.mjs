import { createServer } from 'node:http';
import { resolveTask, isClaimToken, maximumBody, repository, shaPattern, submission, verifyInvite } from './policy.mjs';

import { mcp } from './mcp.mjs';

class RequestError extends Error {
  constructor(code) {
    super('Invalid request');
    this.code = code;
  }
}

async function jsonBody(req, allowChunked = false) {
  if (req.headers['content-type']?.split(';')[0].toLowerCase() !== 'application/json' ||
      req.headers['content-encoding']) throw new RequestError(415);
  const expected = req.headers['content-length'];
  if ((!expected && !allowChunked) || (expected && !/^\d+$/.test(expected))) throw new RequestError(411);
  if (Number(expected) > maximumBody) throw new RequestError(413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximumBody) throw new RequestError(413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new RequestError(400);
  }
}

const errors = {
  400: 'Invalid request or files outside task scope.',
  401: 'Invitation required.',
  404: 'Claim or task not found.',
  409: 'Task unavailable, base changed, or claim already used.',
  411: 'Content-Length required.',
  413: 'Submission too large.',
  415: 'Send uncompressed application/json.',
  503: 'Temporarily unavailable. Retry the same request.',
};

export function createApi(options) {
  const { queue, tasks, inviteKey, head } = options;
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000,
    connectionsCheckingInterval: 1_000, maxHeaderSize: 4096, keepAliveTimeout: 1000 },
  async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    const send = (status, data = { error: errors[status] }) => {
      res.writeHead(status, { connection: 'close' });
      res.end(JSON.stringify(data));
    };
    const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization || '')?.[1] || '';
    const id = /^\/v1\/claims\/([0-9a-f-]{36})$/.exec(req.url)?.[1];

    try {
      if (req.url === '/mcp') {
        if (req.headers.origin) return send(403, { error: 'Browser origins are disabled.' });
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          return send(405, { error: 'Use a JSON-RPC POST.' });
        }
        const reply = await mcp(await jsonBody(req, true), options);
        if (reply === null) { res.writeHead(202); return res.end(); }
        return send(200, reply);
      }
      if (req.method === 'GET' && req.url === '/v1/tasks') {
        return send(200, { repository, tasks: [...tasks.values()] });
      }
      if (req.method === 'POST' && req.url === '/v1/claims') {
        const body = await jsonBody(req);
        const task = tasks.get(body?.task);
        if (!task) return send(404);
        const invitation = verifyInvite(inviteKey, token, task.id);
        if (!invitation) return send(401);
        const base = await head();
        if (!shaPattern.test(base)) return send(503);
        const claim = queue.claim({ task, base, nonce: invitation.nonce });
        return claim ? send(201, { ...claim, repository, paths: task.paths }) : send(409);
      }
      if (!id || !isClaimToken(token)) return send(404);
      const claim = queue.status(id, token);
      if (!claim) return send(404);
      if (req.method === 'GET') return send(200, claim);
      if (req.method === 'DELETE') {
        const code = queue.cancel(id, token);
        return code === 200 ? send(200, { status: 'cancelled' }) : send(code);
      }
      if (req.method !== 'POST') return send(404);
      const task = resolveTask(tasks, claim.task);
      if (!task) return send(409);
      const data = submission(task, await jsonBody(req));
      if (!data) return send(400);
      const result = queue.submit(id, token, data, claim.status === 'claimed' ? await head() : null);
      return send(result.code, result.job);
    } catch (error) {
      return send(error instanceof RequestError ? error.code : 503);
    }
  });
  server.maxConnections = 32;
  return server;
}
