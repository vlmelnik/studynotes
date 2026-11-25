import { createHmac } from 'node:crypto';
import { DurableObject } from 'cloudflare:workers';
import tasksJson from '../../../docs/contributions/tasks.json';
import { readTasks, maximumBody } from '../policy.mjs';
import { githubApp } from '../github.mjs';
import { createQueue } from '../queue-core.mjs';
import { mcp } from '../mcp.mjs';
import { publish } from './publish.mjs';
import { stickers } from './stickers.mjs';

const tasks = readTasks(tasksJson);
const json = (status, value) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
async function message(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body || []) {
    size += chunk.byteLength;
    if (size > maximumBody) throw new RangeError();
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/stickers/') && request.method === 'GET') {
      const quota = await env.LIMIT.limit({ key: 'st:' + (request.headers.get('cf-connecting-ip') || 'unknown') });
      if (!quota.success) return new Response(null, { status: 429, headers: { 'retry-after': '60' } });
      return stickers(url, env);
    }
    if (url.pathname !== '/mcp' || url.search) return new Response(null, { status: 404 });
    if (request.headers.has('Origin')) return new Response(null, { status: 403 });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (request.headers.has('content-encoding') || request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
      return new Response(null, { status: 415 });
    }
    if (Number(request.headers.get('content-length')) > maximumBody) return new Response(null, { status: 413 });
    const quota = await env.LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
    if (!quota.success) return new Response(null, { status: 429, headers: { 'retry-after': '60' } });
    let rpc;
    try { rpc = await message(request); } catch (e) {
      return json(e instanceof RangeError ? 413 : 400, { error: 'Invalid request body.' });
    }
    // Discovery and malformed requests do not allocate durable storage.
    if (rpc?.method !== 'tools/call') {
      const reply = await mcp(rpc, { openQueue: true });
      return reply === null ? new Response(null, { status: 202 }) : json(200, reply);
    }
    if (!/^[a-f0-9]{64}$/i.test(env.GUEST_INVITE_KEY || '') || !env.GUEST_APP_KEY ||
        !env.GUEST_APP_ID || !env.GUEST_INSTALLATION_ID) return json(503, { error: 'Intake is not configured.' });
    const stub = env.QUEUE.getByName('studynotes');
    try {
      const source = createHmac('sha256', env.GUEST_INVITE_KEY)
        .update(request.headers.get('cf-connecting-ip') || 'unknown').digest('hex');
      return json(200, await stub.call(rpc, source));
    } catch {
      return json(503, { error: 'Temporarily unavailable.' });
    }
  },
};

export class Intake extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const storage = ctx.storage;
    const sql = storage.sql;
    this.queue = createQueue({
      exec: sql.exec.bind(sql),
      prepare: query => ({
        get: (...args) => sql.exec(query, ...args).toArray()[0],
        all: (...args) => sql.exec(query, ...args).toArray(),
        run: (...args) => sql.exec(query, ...args),
      }),
    }, fn => storage.transactionSync(fn));
    this.github = githubApp({ appId: env.GUEST_APP_ID, installationId: env.GUEST_INSTALLATION_ID, privateKey: env.GUEST_APP_KEY });
  }

  async call(rpc, source) {
    const result = await mcp(rpc, { queue: this.queue, tasks, openQueue: true, source,
      inviteKey: Buffer.from(this.env.GUEST_INVITE_KEY, 'hex'), head: this.github.head });
    if (this.queue.next()) {
      const due = await this.ctx.storage.getAlarm();
      const soon = Date.now() + 1000;
      if (due === null || due > soon) await this.ctx.storage.setAlarm(soon);
    }
    return result;
  }

  async alarm() {
    const storage = this.ctx.storage;
    // Rearm before outbound calls, including for transient outages and lost responses.
    await storage.setAlarm(Date.now() + 5 * 60_000);
    const job = this.queue.next();
    if (job) await publish(this.queue, this.github, tasks, job);
    else {
      for (const row of this.queue.publishedJobs()) {
        const pr = await this.github.pull(row.pr);
        if (pr.merged || pr.state === 'closed') this.queue.finish(row.id, pr.merged ? 'merged' : 'closed');
      }
    }
    if (this.queue.next()) await storage.setAlarm(Date.now() + 1000);
    else if (this.queue.publishedJobs().length) await storage.setAlarm(Date.now() + 30 * 60_000);
    else await storage.deleteAlarm();
  }
}
