import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gitAt } from './git.mjs';
import { maximumBody, repository } from './policy.mjs';

const [command, address, ...args] = process.argv.slice(2);
const origin = new URL(address);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username ||
    origin.password || origin.search || origin.hash) throw new Error('Use the provided HTTPS origin');

async function call(route, method, token, input) {
  const body = input === undefined ? undefined : JSON.stringify(input);
  if (body && Buffer.byteLength(body) > maximumBody) throw new Error('Submission exceeds the service limit');
  const response = await fetch(origin.origin + route, { method, body, redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { authorization: 'Bearer ' + token, ...(body && { 'content-type': 'application/json' }) },
  });
  if (!response.ok) throw new Error('Service returned HTTP ' + response.status + ' for ' + method);
  return response.json();
}

if (command === 'claim') {
  const [task, file] = args;
  const invite = process.env.STUDYNOTES_GUEST_INVITE;
  if (!invite || !file) throw new Error('Set STUDYNOTES_GUEST_INVITE and supply a new receipt path');
  // Reserve the local receipt before redeeming the single-use invitation.
  await writeFile(file, '', { flag: 'wx', mode: 0o600 });
  const claim = await call('/v1/claims', 'POST', invite, { task });
  if (claim.repository !== repository) throw new Error('Unexpected repository');
  await writeFile(file, JSON.stringify(claim), { mode: 0o600 });
  console.log(JSON.stringify({ task: claim.task, base: claim.base, paths: claim.paths }, null, 2));
} else if (['submit', 'status', 'cancel'].includes(command)) {
  const [file, reportFile] = args;
  const claim = JSON.parse(await readFile(file, 'utf8'));
  const route = '/v1/claims/' + claim.id;
  if (command === 'submit') {
    const git = gitAt(resolve('.'));
    const actual = (await git(['rev-parse', 'HEAD'])).toString().trim();
    if (actual !== claim.base) throw new Error('Check out the reserved base and leave changes uncommitted');
    const list = async (...params) => (await git(params)).toString('utf8').split('\0').filter(Boolean);
    const tracked = await list('diff', '--no-renames', '--name-only', '-z', claim.base);
    const added = await list('ls-files', '--others', '--exclude-standard', '-z');
    const files = [];
    for (const path of new Set([...tracked, ...added])) {
      if (!claim.paths.includes(path)) throw new Error('Changes exist outside the reserved task scope');
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        if (!(await lstat(join(...parts.slice(0, i)))).isDirectory()) throw new Error('A parent is not a directory');
      }
      if (!(await lstat(path)).isFile()) throw new Error('Only regular files can be submitted');
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        .decode(await readFile(path)).replace(/\r\n/g, '\n');
      files.push({ path, content });
    }
    if (!files.length) throw new Error('There are no approved changes to submit');
    const report = reportFile ? await readFile(reportFile, 'utf8') : '';
    console.log(JSON.stringify(await call(route, 'POST', claim.token, { base: claim.base, files, report }), null, 2));
  } else {
    console.log(JSON.stringify(await call(route, command === 'cancel' ? 'DELETE' : 'GET', claim.token), null, 2));
  }
} else {
  throw new Error('Expected claim, submit, status or cancel');
}
