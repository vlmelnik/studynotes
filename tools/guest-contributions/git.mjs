import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { baseBranch, repository, shaPattern } from './policy.mjs';
import { run } from './process.mjs';

export class InvalidChange extends Error {}

export const remote = 'https://github.com/' + repository + '.git';

export function gitAt(directory) {
  return (args, options) => run('git', ['-C', directory, ...args], options);
}

const string = buffer => buffer.toString('utf8').trim();

export async function prepareCommit(git, job, files) {
  const index = await mkdtemp(join(tmpdir(), 'studynotes-index-'));
  try {
    const env = { GIT_INDEX_FILE: join(index, 'index') };
    const raw = await git(['ls-tree', '-rtz', job.base], { maxOutput: 8 * 1024 * 1024 });
    const tree = new Map(raw.toString('utf8').split('\0').filter(Boolean).map(line => {
      const separator = line.indexOf('\t');
      const path = line.slice(separator + 1);
      return [path.toLowerCase(), { path, mode: line.slice(0, 6) }];
    }));
    await git(['read-tree', job.base], { env });
    for (const { path, content } of files) {
      const entry = tree.get(path.toLowerCase());
      if (entry && (entry.path !== path || entry.mode !== '100644')) {
        throw new InvalidChange('A submitted file is not a regular file with the exact approved name.');
      }
      const parts = path.split('/');
      for (let length = 1; length < parts.length; length++) {
        const parent = parts.slice(0, length).join('/');
        const dir = tree.get(parent.toLowerCase());
        if (dir && (dir.path !== parent || dir.mode !== '040000')) {
          throw new InvalidChange('A submitted path crosses a non-directory or casing conflict.');
        }
      }
      const blob = string(await git(['hash-object', '-w', '--no-filters', '--stdin'], {
        input: Buffer.from(content),
      }));
      await git(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + path], { env });
    }
    const nextTree = string(await git(['write-tree'], { env }));
    const oldTree = string(await git(['rev-parse', job.base + '^{tree}']));
    if (nextTree === oldTree) throw new InvalidChange('The submitted files are identical to the base.');
    const date = new Date(job.created).toISOString();
    const identity = {
      GIT_AUTHOR_NAME: 'StudyNotes Guest Contributions', GIT_AUTHOR_EMAIL: 'guest-contributions@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'StudyNotes Guest Contributions', GIT_COMMITTER_EMAIL: 'guest-contributions@users.noreply.github.com',
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    };
    return string(await git(['commit-tree', nextTree, '-p', job.base, '-m', 'Guest contribution ' + job.task], {
      env: identity,
    }));
  } finally {
    await rm(index, { recursive: true, force: true });
  }
}

export async function sandbox(git, commit, image, name, runtime = '') {
  if (!shaPattern.test(commit) || !/^sha256:[0-9a-f]{64}$/.test(image) ||
      !/^studynotes-guest-[a-z0-9-]+$/.test(name) || !/^[a-z0-9_-]*$/.test(runtime)) {
    throw new Error('Invalid sandbox configuration');
  }
  const directory = await mkdtemp(join(tmpdir(), 'studynotes-validation-'));
  try {
    const archive = join(directory, 'snapshot.tar');
    // This contains the exact candidate tree, without its Git metadata or any runtime secrets.
    await git(['archive', '--format=tar', '--output=' + archive, commit], { timeout: 90_000 });
    await chmod(archive, 0o644);
    const args = [
      'run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=1000:1000',
      '--cpus=2', '--memory=3g', '--memory-swap=3g', '--pids-limit=256', '--log-driver=none',
      '--tmpfs', '/work:rw,exec,nosuid,nodev,size=768m,uid=1000,gid=1000',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,uid=1000,gid=1000',
      '--mount', 'type=bind,source=' + archive + ',destination=/snapshot.tar,readonly',
      ...(runtime ? ['--runtime', runtime] : []), image,
    ];
    try {
      await run('docker', args, { timeout: 180_000, maxOutput: 1024 * 1024 });
      return true;
    } catch (error) {
      if (/^docker exit (?:1|137)$/.test(error.message) || error.message === 'docker timed out' ||
          error.message === 'docker exceeded output limit') return false;
      throw error;
    } finally {
      await run('docker', ['rm', '-f', name], { timeout: 15_000 }).catch(() => {});
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function gitRepository(directory) {
  const git = gitAt(resolve(directory));
  return {
    git,
    async fetchBase() {
      await git(['-c', 'credential.helper=', 'fetch', '--no-tags', remote,
        'refs/heads/' + baseBranch + ':refs/heads/' + baseBranch], { timeout: 90_000 });
      return string(await git(['rev-parse', 'refs/heads/' + baseBranch]));
    },
    async pushNew(branch, commit, token) {
      const auth = Buffer.from('x-access-token:' + token).toString('base64');
      const ref = 'refs/heads/' + branch;
      await git(['-c', 'credential.helper=', 'push', '--force-with-lease=' + ref + ':', remote,
        commit + ':' + ref], {
        env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
          GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + auth },
        timeout: 90_000,
      });
    },
  };
}

export async function changedFiles(git, base, head, task) {
  const delta = (await git(['diff-tree', '--no-commit-id', '--no-renames', '-r', '-z', base, head]))
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
  return files;
}
