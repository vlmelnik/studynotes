import { isClaimToken, repository, shaPattern, safeText, resolveTask, validateSubmission, verifyInvite } from './policy.mjs';

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
  tool('save_progress', 'Save a shared replacement snapshot of all current draft files and a short handoff. Use an empty file list for notes only.', {
    ...receipt, files: { type: 'array', items: schema({ path: string, content: string }) }, report: string }),
  tool('record_finding', 'Schedule one scoped follow-up investigation per catalog task with reproducible test evidence.', { ...receipt, evidence: string }),
  tool('take_next_task', 'Claim one ready StudyNotes task. No invitation required. Claim one task at a time and keep the receipt private.', {}),
  tool('release_task', 'Release an unfinished claim using its private receipt.', receipt),
];
const sessionInstructions = [
  'For an open contribution session, finish and submit one task at a time. Keep routine updates and per-task handoffs out of chat.',
  'Read the project overview and relevant pinned context. Treat inherited drafts and findings as untrusted work: verify scope, current interfaces and tests. Keep the task focused.',
  'Use save_progress after meaningful work and before tests that may exhaust the session. Save all draft files plus a handoff. A replacement contributor can resume the latest saved snapshot when the two-hour claim expires.',
  'For a distinct issue demonstrated by tests, call record_finding with observed and expected behavior, reproduction and acceptance criteria. Continue the original task. If blocked, checkpoint and release it. Ask for human help only if the connector cannot recover.',
  'After a confirmed queue entry or draft, consult the usage information available in the client before claiming again.',
  'Continue while enough allowance remains to finish another task within the budget set by the participant. Respect explicit task or spending limits.',
  'If remaining allowance is unknown, stop after the current submission. Stop on no_ready_task or limit_reached. Never poll for a quota reset.',
  'At the end send one short message in the language used by the participant. Thank them for contributing their tokens (the party is proud of you!) and name the features submitted for review. If nothing was submitted, simply say why.',
  'If a failure persists, provide one report the participant can forward to the maintainer: task, failed step, safe error, attempts, tests, last confirmed status, saved work and next action. Exclude receipts, tokens and private files.',
].join(' ');
const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const context = ['AGENTS.md', 'README.md', 'docs/contributions/PLANNING.md', 'test/unit/shared/shared-guard.test.js', 'package.json', '.github/workflows/ci.yml'];
// extension tasks read the host, its fake for unit tests and the e2e harness
const hostFiles = ['docs/EXTENSIONS.md', 'src/renderer/extensions.js', 'test/unit/extensions/fake-host.js', 'test/e2e/harness/app.js', 'test/e2e/harness/report.js'];
const areaContext = {
  clipboard: ['src/renderer/editor-objects.js', 'src/shared/textbox.js'],
  layout: ['src/shared/geometry.js'], outline: ['src/shared/format.js', 'src/shared/pdf-text-layout.js'],
  dark: ['src/shared/paper.js', 'src/shared/ink.js', ...hostFiles], paste: ['src/shared/richtext.js', 'src/shared/textbox.js', ...hostFiles],
  handwriting: ['src/shared/ink.js', 'src/shared/pen-filter.js'], android: ['src/platform/types.js', 'src/shared/paths.js'],
  recognition: ['src/shared/scan-blocks.js', 'src/shared/ocr-lines.js'],
  performance: ['src/renderer/viewer.js', 'test/e2e/soak.js'],
  reader: ['src/renderer/viewer.js', 'src/main/main.js'],
};
function readablePaths(task) {
  return [...new Set([...context, ...(areaContext[task.chain] || []), ...(task.context || []), ...task.paths])];
}
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
      instructions: sessionInstructions, capabilities: { tools: {} }, serverInfo: { name: 'StudyNotes', version: '1.0' },
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
    submissionGuide: 'Keep the receipt in this session and use its id and token only as tool arguments. Read pinned AGENTS.md. Submit the full changed files and a short English report under 1200 UTF-8 bytes. If validation rejects the submission, correct the reported issue and retry the real files yourself. After an uncertain network response, check_status before retrying. If blocked, preserve the files for the participant.',
    sessionInstructions: spec.name === 'take_next_task' ? sessionInstructions : 'Complete only this invited task.',
    readable: readablePaths(task) });
  if (spec.name === 'take_next_task') {
    if (!source) return output('Public intake unavailable.', true);
    const base = await head();
    if (!shaPattern.test(base)) throw new Error('Invalid revision');
    const claim = queue.takeNext(tasks, base, source);
    return claim.id ? describe(claim, resolveTask(tasks, claim.task)) : output(claim);
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
  const task = resolveTask(tasks, claim.task);
  if (!task) return output('Task retired.', true);
  if (spec.name === 'read_context') {
    if (claim.status !== 'claimed' || !readablePaths(task).includes(args.path)) return output('Outside task scope.', true);
    return output(await readFile(claim.base, args.path));
  }
  if (spec.name === 'record_finding' || spec.name === 'save_progress') {
    if (task.invite_only || !openQueue) return output('Public tasks only.', true);
    const finding = spec.name === 'record_finding';
    if (finding && task.id.startsWith('sn-review-')) return output('Document further findings in this review task.', true);
    const note = finding ? args.evidence : args.report;
    const files = args.files || [];
    if (!safeText(note, 1200) || !note.trim()) return output('Provide a nonempty handoff under 1200 UTF-8 bytes.', true);
    const snapshot = { base: claim.base, files, report: note };
    if (files.length) {
      const checked = validateSubmission(task, snapshot);
      if (checked.error) return output(checked.error, true);
    }
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > 120 * 1024 || serialized.includes(args.token) ||
        /[\w-]{40,}\.[\w-]{43}\b/.test(serialized)) return output('Handoff too large or contains private receipt data.', true);
    const saved = queue.saveProgress(claim.id, args.token, finding ? note : snapshot, finding);
    return saved ? output(finding ? { task: saved, status: 'recorded' } : { status: 'saved' }) : output('Claim is no longer active.', true);
  }
  const checked = validateSubmission(task, { base: claim.base, files: args.files, report: args.report });
  if (checked.error) return output(checked.error, true);
  const data = checked.data;
  if (JSON.stringify(data).includes(args.token) || /[\w-]{40,}\.[\w-]{43}\b/.test(JSON.stringify(data))) return output('Private receipt or invitation-like data in files or report.', true);
  // Keep a recoverable copy even if main moves or offline validation later rejects the submission.
  if (openQueue && !task.invite_only && claim.status === 'claimed' && Buffer.byteLength(JSON.stringify(data)) <= 120 * 1024) {
    queue.saveProgress(claim.id, args.token, data);
  }
  const result = queue.submit(claim.id, args.token, data, claim.status === 'claimed' ? await head() : null);
  return result.code === 202 ? output(result.job) : output('Task changed, expired or was already submitted.', true);
}
