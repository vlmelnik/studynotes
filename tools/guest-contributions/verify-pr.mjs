import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { baseBranch, botPrefix, readTasks, shaPattern, submission } from './policy.mjs';
import { gitAt, sandbox } from './git.mjs';

const [base, head, branch, image] = process.argv.slice(2);
const match = new RegExp('^' + botPrefix + '(sn-[a-z0-9-]+)/(?:[0-9a-f-]{36})$').exec(branch);
if (!match || !shaPattern.test(base) || !shaPattern.test(head)) {
  throw new Error('Invalid guest contribution ref');
}
const git = gitAt('.');
const parent = (await git(['rev-list', '--parents', '-n', '1', head])).toString().trim();
if (parent !== head + ' ' + base) throw new Error('This submission must be recreated on the current ' + baseBranch);
const tasks = readTasks(JSON.parse(await readFile(new URL('../../docs/contributions/tasks.json', import.meta.url))));
const task = tasks.get(match[1]);
if (!task) throw new Error('Task is not in the trusted queue');

const delta = (await git(['diff-tree', '--no-commit-id', '--no-renames', '-rz', base, head]))
  .toString('utf8').split('\0');
delta.pop();
const files = [];
for (let i = 0; i < delta.length; i += 2) {
  const metadata = /^:(000000|100644) 100644 [0-9a-f]{40} ([0-9a-f]{40}) [AM]$/.exec(delta[i]);
  const path = delta[i + 1];
  if (!metadata || !task.paths.includes(path)) throw new Error('Change outside task scope');
  const blob = await git(['cat-file', 'blob', metadata[2]], { maxOutput: 96 * 1024 });
  const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blob);
  files.push({ path, content });
}
if (!submission(task, { base, files })) throw new Error('Submitted files violate the content policy');
if (!await sandbox(git, head, image, 'studynotes-guest-ci-' + randomUUID())) {
  throw new Error('Offline unit or build checks failed or timed out');
}
console.log('Guest file scope, unit tests and build passed.');
