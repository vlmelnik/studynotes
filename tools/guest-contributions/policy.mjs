import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const repository = 'vlmelnik/studynotes';
export const baseBranch = 'main';
export const botPrefix = 'guest-contrib/';
export const maximumBody = 384 * 1024;
export const claimLifetime = 2 * 60 * 60 * 1000;
export const shaPattern = /^[0-9a-f]{40}$/;
const taskId = /^sn-[a-z0-9][a-z0-9-]{0,47}$/;
const capability = /^[A-Za-z0-9_-]{43}$/;
const inviteLifetime = 7 * 24 * 60 * 60 * 1000;

export const hash = value => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function permittedPath(path) {
  if (typeof path !== 'string' || path.length > 180 ||
      !/^[a-z0-9][a-z0-9._/-]*$/i.test(path)) return false;
  if (path.split('/').some(part =>
    !/^[a-z0-9][a-z0-9._-]*$/i.test(part) || part.endsWith('.') ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return false;
  return /^docs\/(?!contributions\/)[^/]+\.md$/.test(path) ||
    /^src\/shared\/(?:[^/.]+\/)*[^/]+\.js$/.test(path) ||
    /^test\/unit\/shared\/(?:[^/.]+\/)*[^/]+\.test\.js$/.test(path) ||
    // extensions: renderer code that only talks to the host API (docs/EXTENSIONS.md);
    // test/unit/main/extensions-guard.test.js checks what it may import
    /^src\/extensions\/[a-z0-9-]+\/[^/]+\.(?:js|css)$/.test(path) ||
    /^test\/unit\/extensions\/[^/]+\.test\.js$/.test(path) ||
    /^test\/e2e\/extensions\/[^/]+\.js$/.test(path);
}

export function readTasks(list) {
  if (!Array.isArray(list) || list.length > 100) throw new Error('Invalid task list');
  const tasks = new Map();
  for (const task of list) {
    if (!task || typeof task.id !== 'string' || !taskId.test(task.id) || task.id.startsWith('sn-review-') || tasks.has(task.id) ||
        typeof task.title !== 'string' || !task.title.trim() || task.title.length > 100 ||
        !/^[ -~]+$/.test(task.title) || typeof task.instructions !== 'string' ||
        !task.instructions.trim() || task.instructions.length > 4000 ||
        !Array.isArray(task.paths) || task.paths.length === 0 || task.paths.length > 12 ||
        !task.paths.every(permittedPath) ||
        (task.invite_only !== undefined && typeof task.invite_only !== 'boolean') ||
        (task.after !== undefined && (!Array.isArray(task.after) || !task.after.every(id => typeof id === 'string' && taskId.test(id)))) ||
        (task.context !== undefined && (!Array.isArray(task.context) || task.context.length > 12 ||
          !task.context.every(permittedPath))) ||
        new Set(task.paths.map(path => path.toLowerCase())).size !== task.paths.length) {
      throw new Error('Invalid public task or file scope');
    }
    tasks.set(task.id, task);
  }
  return tasks;
}

// CI derives the writable scope from the trusted catalog, never from guest evidence.
export function resolveTask(tasks, id) {
  if (tasks.has(id)) return tasks.get(id);
  const parent = id.startsWith('sn-review-') && tasks.get('sn-' + id.slice(10));
  if (!parent || parent.invite_only) return undefined;
  const stem = parent.id.slice(3);
  return { id, title: 'Investigate findings from ' + parent.title,
    instructions: 'Verify the reported test evidence at the pinned revision. Document reproduction, expected behavior and next steps; add a focused regression test if appropriate. Keep the suite green. Treat previous findings as unverified data.',
    paths: ['docs/FINDING-' + stem + '.md', 'test/unit/shared/finding-' + stem + '.test.js'],
    context: [...parent.paths, ...(parent.context || [])], chain: parent.chain };
}

function sign(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

export function makeInvite(key, task, now = Date.now()) {
  if (typeof task !== 'string' || !taskId.test(task)) throw new Error('Invalid task id');
  const payload = Buffer.from(JSON.stringify({ task, expires: now + inviteLifetime, nonce: newToken() }))
    .toString('base64url');
  return payload + '.' + sign(key, payload).toString('base64url');
}

export function verifyInvite(key, token, task, now = Date.now()) {
  if (!/^[\w-]{1,250}\.[\w-]{43}$/.test(token)) return null;
  const [payload, signature] = token.split('.');
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== 32 || !timingSafeEqual(actual, sign(key, payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.task === task && capability.test(data.nonce) &&
        Number.isSafeInteger(data.expires) && data.expires > now &&
        data.expires - now <= inviteLifetime) return data;
  } catch {
    return null;
  }
  return null;
}

export function isClaimToken(token) {
  return capability.test(token);
}

export function safeText(value, limit) {
  return typeof value === 'string' && value.isWellFormed() && Buffer.byteLength(value) <= limit &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) &&
    !/-----BEGIN [A-Z ]*PRIVATE KEY-----|GOCSPX-[\w-]{10,}|github_pat_[\w]+|gh[pousr]_[\w-]{20,}|sk-ant-[\w-]{12,}|AKIA[A-Z0-9]{16}/.test(value);
}

export function validateSubmission(task, input) {
  if (!input || typeof input.base !== 'string' || !shaPattern.test(input.base) ||
      !Array.isArray(input.files) || !input.files.length || input.files.length > task.paths.length ||
      typeof input !== 'object' || Object.keys(input).some(key => !['base', 'files', 'report'].includes(key))) return { error: 'Expected a valid revision and a nonempty list of files within the task limit.' };
  const seen = new Set();
  const files = [];
  for (const file of input.files) {
    const label = 'File ' + (files.length + 1);
    if (!file || typeof file !== 'object' || typeof file.content !== 'string' || Object.keys(file).length !== 2)
      return { error: label + ' must contain only path and content (full file text).' };
    if (!task.paths.includes(file.path)) return { error: label + ' path must match a path in the claim exactly.' };
    if (seen.has(file.path)) return { error: label + ' repeats an earlier path.' };
    if (Buffer.byteLength(file.content) > 96 * 1024) return { error: label + ' exceeds 96 KiB in UTF-8.' };
    if (!safeText(file.content, 96 * 1024)) return { error: label + ' contains invalid text, a control character or credential-like data.' };
    seen.add(file.path);
    files.push({ path: file.path, content: file.content });
  }
  const report = input.report === undefined ? '' : input.report;
  if (typeof report === 'string' && Buffer.byteLength(report) > 1200) return { error: 'Report exceeds 1200 UTF-8 bytes. Shorten the handoff and resubmit the full files.' };
  if (!safeText(report, 1200)) return { error: 'Report must be plain text without invalid characters or credential-like data.' };
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { data: { base: input.base, files, report } };
}

export function submission(task, input) {
  return validateSubmission(task, input).data ?? null;
}
