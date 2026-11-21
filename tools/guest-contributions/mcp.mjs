import { isClaimToken, repository, shaPattern, validateSubmission, verifyInvite } from './policy.mjs';

const string = { type: 'string' };
const receipt = { id: string, token: string };
const schema = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const tool = (name, description, properties, readOnly = false) => ({
  name, description, inputSchema: schema(properties), annotations: { readOnlyHint: readOnly },
});
const tools = [
  tool('claim_task', 'Reserve the invited task. Keep the receipt private.', { task: string, invitation: string }),
  tool('read_context', 'Read an approved public file at the claimed revision.', { ...receipt, path: string }, true),
  tool('submit_work', 'Queue the listed complete files and a public report (maximum 1200 UTF-8 bytes) for offline checks and draft PR review.', {
    ...receipt, files: { type: 'array', items: schema({ path: string, content: string }) }, report: string,
  }),
  tool('check_status', 'Read validation status or the resulting draft PR URL. Do not poll continuously.', receipt, true),
];
const publicTools = [
  tool('take_next_task', 'Claim one ready StudyNotes task. No invitation required. Call once and keep the receipt private.', {}),
  tool('release_task', 'Release an unfinished claim using its private receipt.', receipt),
];
const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const context = ['AGENTS.md', 'package.json', '.github/workflows/ci.yml'];
async function publicFile(base, path) {
  const response = await fetch('https://raw.githubusercontent.com/' + repository + '/' + base + '/' + path, {
    redirect: 'manual', signal: AbortSignal.timeout(8000),
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

export async function mcp(message, { queue, tasks, inviteKey, head, readFile = publicFile, openQueue = false, source }) {
  const available = openQueue ? [...tools, ...publicTools] : tools;
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
    case 'tools/list': return reply({ tools: available });
    case 'tools/call': break;
    default: return error(-32601, 'Unknown method');
  }
  const spec = available.find(t => t.name === params?.name);
  const args = params?.arguments ?? {};
  if (!spec || !args || typeof args !== 'object' ||
      Object.keys(args).length !== spec.inputSchema.required.length ||
      !spec.inputSchema.required.every(key => Object.hasOwn(args, key) &&
        (key === 'files' ? Array.isArray(args[key]) : typeof args[key] === 'string'))) return error(-32602, 'Invalid tool arguments');
  const describe = (claim, task) => output({ ...claim, instructions: task.instructions, paths: task.paths,
    submissionGuide: 'Keep the receipt in this session and use its id and token only as tool arguments. Read pinned AGENTS.md. Submit the full changed files and a short English report under 1200 UTF-8 bytes. If validation rejects the submission, correct the reported issue and retry the real files yourself. After an uncertain network response, check_status before retrying. Stop on a draft link or queued status. If blocked, preserve the files for the participant.',
    readable: [...new Set([...context, ...(task.context || []), ...task.paths])] });
  if (spec.name === 'take_next_task') {
    if (!source) return output('Public intake unavailable.', true);
    const base = await head();
    if (!shaPattern.test(base)) throw new Error('Invalid revision');
    const claim = queue.takeNext(tasks, base, source);
    return claim.id ? describe(claim, tasks.get(claim.task)) : output(claim);
  }
  if (spec.name === 'claim_task') {
    const task = tasks.get(args.task);
    const invite = task && verifyInvite(inviteKey, args.invitation, task.id);
    if (!invite) return output('A valid task invitation is required.', true);
    const base = await head();
    if (!shaPattern.test(base)) throw new Error('Invalid revision');
    const claim = queue.claim({ task, base, nonce: invite.nonce });
    return claim ? describe(claim, task) : output('Task or invitation already used.', true);
  }
  const claim = isClaimToken(args.token) && queue.status(args.id, args.token);
  if (!claim) return output('Invalid receipt.', true);
  if (spec.name === 'release_task') {
    return queue.cancel(args.id, args.token) === 200 ? output({ status: 'cancelled' }) : output('Only unfinished claims can be released.', true);
  }
  if (spec.name === 'check_status') return output(claim);
  const task = tasks.get(claim.task);
  if (!task) return output('Task retired.', true);
  if (spec.name === 'read_context') {
    if (claim.status !== 'claimed' || ![...context, ...(task.context || []), ...task.paths].includes(args.path)) return output('Outside task scope.', true);
    return output(await readFile(claim.base, args.path));
  }
  const checked = validateSubmission(task, { base: claim.base, files: args.files, report: args.report });
  if (checked.error) return output(checked.error, true);
  const data = checked.data;
  if (JSON.stringify(data).includes(args.token) || /[\w-]{40,}\.[\w-]{43}\b/.test(JSON.stringify(data))) return output('Private receipt or invitation-like data in files or report.', true);
  const result = queue.submit(claim.id, args.token, data, claim.status === 'claimed' ? await head() : null);
  return result.code === 202 ? output(result.job) : output('Task changed, expired or was already submitted.', true);
}
