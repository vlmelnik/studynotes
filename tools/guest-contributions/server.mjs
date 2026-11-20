import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApi } from './api.mjs';
import { gitRepository, sandbox } from './git.mjs';
import { githubApp } from './github.mjs';
import { makeInvite, readTasks } from './policy.mjs';
import { openQueue } from './queue.mjs';
import { createWorker } from './worker.mjs';

function setting(name, pattern) {
  const value = process.env[name];
  if (!value || (pattern && !pattern.test(value))) throw new Error('Missing or invalid ' + name);
  return value;
}

const tasks = readTasks(JSON.parse(readFileSync(new URL('../../docs/contributions/tasks.json', import.meta.url))));
const hexKey = readFileSync(setting('GUEST_INVITE_KEY_FILE'), 'utf8').trim();
if (!/^[a-fA-F0-9]{64}$/.test(hexKey)) throw new Error('Invitation key must contain 32 hexadecimal bytes');
const inviteKey = Buffer.from(hexKey, 'hex');

if (['invite', 'cowork-invite'].includes(process.argv[2])) {
  const task = process.argv[3];
  if (!tasks.has(task)) throw new Error('Unknown public task');
  const url = new URL(process.argv[4]);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password ||
      url.search || url.hash) throw new Error('Use a dedicated HTTPS origin');
  const name = process.argv[2] === 'cowork-invite' ? 'COWORK-PROMPT.txt' : 'PROMPT.txt';
  const template = readFileSync(new URL('../../docs/contributions/' + name, import.meta.url), 'utf8');
  const values = { ORIGIN: url.origin, TASK: task, INVITATION: makeInvite(inviteKey, task) };
  console.log(template.replace(/\{(ORIGIN|TASK|INVITATION)\}/g, (_, key) => values[key]));
} else if (process.argv[2] === 'serve') {
  const github = githubApp({
    appId: setting('GUEST_APP_ID', /^[1-9]\d*$/),
    installationId: setting('GUEST_INSTALLATION_ID', /^[1-9]\d*$/),
    privateKey: readFileSync(setting('GUEST_APP_KEY_FILE')),
  });
  const repository = gitRepository(setting('GUEST_GIT_DIRECTORY'));
  const image = setting('GUEST_VALIDATOR_IMAGE', /^sha256:[0-9a-f]{64}$/);
  const runtime = process.env.GUEST_DOCKER_RUNTIME || '';
  if (!/^[a-z0-9_-]*$/.test(runtime)) throw new Error('Invalid GUEST_DOCKER_RUNTIME');
  const queue = openQueue(resolve(setting('GUEST_DATABASE')));
  const tick = createWorker({ queue, tasks, repository, github,
    validate: (commit, id) => sandbox(repository.git, commit, image, 'studynotes-guest-' + id, runtime) });
  const port = Number(process.env.GUEST_PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid GUEST_PORT');
  createApi({ queue, tasks, inviteKey, head: github.head }).listen(port, '127.0.0.1', () => {
    console.log('Guest contribution API listening on loopback port ' + port);
  });
  let retryAt = 0;
  setInterval(async () => {
    if (Date.now() < retryAt) return;
    try {
      await tick();
    } catch {
      retryAt = Date.now() + 30_000;
      console.error('Guest contribution worker could not advance. It will retry.');
    }
  }, 2500);
} else {
  throw new Error('Usage: node server.mjs serve | invite <task> <https-origin>');
}
