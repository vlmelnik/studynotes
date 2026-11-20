import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { baseBranch, botPrefix, readTasks, shaPattern, submission } from './policy.mjs';
import { changedFiles, gitAt, sandbox } from './git.mjs';

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

const files = await changedFiles(git, base, head, task);
if (!submission(task, { base, files })) throw new Error('Submitted files violate the content policy');
if (!await sandbox(git, head, image, 'studynotes-guest-ci-' + randomUUID())) {
  throw new Error('Offline unit or build checks failed or timed out');
}
console.log('Guest file scope, unit tests and build passed.');
