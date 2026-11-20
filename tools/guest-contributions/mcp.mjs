import { isClaimToken, repository, shaPattern, submission, verifyInvite } from './policy.mjs';

const string = { type: 'string' };
const receipt = { id: string, token: string };
const schema = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const tool = (name, description, properties) => ({ name, description, inputSchema: schema(properties) });
const tools = [
  tool('claim_task', 'Reserve the invited task. Keep the receipt private.', { task: string, invitation: string }),
  tool('read_context', 'Read an approved public file at the claimed revision.', { ...receipt, path: string }),
  tool('submit_work', 'Queue the listed complete files and a brief public report for offline checks and draft PR review.', {
    ...receipt, files: { type: 'array', items: schema({ path: string, content: string }) }, report: string,
  }),
  tool('check_status', 'Read validation status or the resulting draft PR URL. Do not poll continuously.', receipt),
];
const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const context = ['AGENTS.md', 'package.json', '.github/workflows/ci.yml'];
async function publicFile(base, path) {
  const response = await fetch('https://raw.githubusercontent.com/' + repository + '/' + base + '/' + path, {
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return { path, exists: false };
  if (!response.ok) throw new Error('Public file unavailable');
  const parts = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 96 * 1024) throw new Error('Public file too large');
    parts.push(chunk);
  }
  return { path, exists: true, content: Buffer.concat(parts).toString('utf8') };
}

export async function mcp(message, { queue, tasks, inviteKey, head, readFile = publicFile }) {
  const id = message?.id;
  const reply = result => ({ jsonrpc: '2.0', id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  const output = (value, isError = false) => reply({ content: [{ type: 'text', text: JSON.stringify(value) }], isError });
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
      (id !== undefined && typeof id !== 'string' && !Number.isSafeInteger(id))) return error(-32600, 'Invalid request');
  if (id === undefined) return null;
  const params = message.params;
  switch (message.method) {
    case 'initialize': return reply({
      protocolVersion: versions.includes(params?.protocolVersion) ? params.protocolVersion : versions[0],
      capabilities: { tools: {} }, serverInfo: { name: 'StudyNotes', version: '1.0' },
    });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools });
    case 'tools/call': break;
    default: return error(-32601, 'Unknown method');
  }
  const spec = tools.find(t => t.name === params?.name);
  const args = params?.arguments;
  if (!spec || !args || typeof args !== 'object' ||
      Object.keys(args).length !== spec.inputSchema.required.length ||
      !spec.inputSchema.required.every(key => Object.hasOwn(args, key) &&
        (key === 'files' ? Array.isArray(args[key]) : typeof args[key] === 'string'))) return error(-32602, 'Invalid tool arguments');
  if (spec.name === 'claim_task') {
    const task = tasks.get(args.task);
    const invite = task && verifyInvite(inviteKey, args.invitation, task.id);
    if (!invite) return output('A valid task invitation is required.', true);
    const base = await head();
    if (!shaPattern.test(base)) throw new Error('Invalid revision');
    const claim = queue.claim({ task, base, nonce: invite.nonce });
    return claim ? output({ ...claim, instructions: task.instructions, paths: task.paths,
      readable: [...new Set([...context, ...(task.context || []), ...task.paths])] }) : output('Task or invitation already used.', true);
  }
  const claim = isClaimToken(args.token) && queue.status(args.id, args.token);
  if (!claim) return output('Invalid receipt.', true);
  if (spec.name === 'check_status') return output(claim);
  const task = tasks.get(claim.task);
  if (!task) return output('Task retired.', true);
  if (spec.name === 'read_context') {
    if (claim.status !== 'claimed' || ![...context, ...(task.context || []), ...task.paths].includes(args.path)) return output('Outside task scope.', true);
    return output(await readFile(claim.base, args.path));
  }
  const data = submission(task, { base: claim.base, files: args.files, report: args.report });
  if (!data || JSON.stringify(data).includes(args.token) || /[\w-]{40,}\.[\w-]{43}\b/.test(JSON.stringify(data))) return output('Invalid submission or private receipt in files/report.', true);
  const result = queue.submit(claim.id, args.token, data, claim.status === 'claimed' ? await head() : null);
  return result.code === 202 ? output(result.job) : output('Task changed, expired or was already submitted.', true);
}
