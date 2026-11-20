import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gitAt, InvalidChange, prepareCommit } from './git.mjs';
import { readTasks } from './policy.mjs';
import { openQueue } from './queue.mjs';
import { createWorker } from './worker.mjs';

const task = { id: 'sn-docs', title: 'Docs', instructions: 'Add the guide.', paths: ['docs/TESTING.md'] };
const submittedFile = { path: task.paths[0], content: '# Testing\n' };
const date = new Date('2026-01-01T00:00:00Z').getTime();
const fixture = async t => {
  const directory = await mkdtemp(join(tmpdir(), 'guest-test-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  const git = gitAt(directory);
  await git(['init', '--bare']);
  const tree = (await git(['mktree'], { input: '' })).toString().trim();
  const base = (await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit-tree', tree, '-m', 'Base'])).toString().trim();
  return { directory, git, base };
};

test('the worker resumes after a lost GitHub response without opening a second draft', async t => {
  const { directory, git, base } = await fixture(t);
  const database = join(directory, 'queue.sqlite');
  let queue = openQueue(database);
  const claim = queue.claim({ task, base, nonce: 'invite-1', now: date });
  assert.equal(queue.submit(claim.id, claim.token, { base, files: [submittedFile], report: 'Verified' },
    base, date).code, 202);
  const tasks = readTasks([task]);
  let branch;
  let validated;
  let pull;
  let opens = 0;
  const repository = { git, fetchBase: async () => base,
    pushNew: async (name, commit) => {
      assert.equal(name, 'guest-contrib/' + task.id + '/' + claim.id);
      branch = commit;
    } };
  const github = {
    token: async () => 'temporary credential',
    head: async () => base,
    branch: async () => branch,
    findPull: async () => pull,
    openPull: async () => {
      opens++;
      pull = { number: 4, html_url: 'https://github.com/vlmelnik/studynotes/pull/4',
        head: { sha: branch }, base: { ref: 'main' } };
      throw new Error('Expected simulated loss of response');
    },
  };
  const validate = async commit => {
    validated = commit;
    assert.equal((await git(['show', commit + ':' + task.paths[0]])).toString(), submittedFile.content);
    assert.equal((await git(['rev-parse', commit + '^'])).toString().trim(), base);
    return true;
  };
  const tick = createWorker({ queue, tasks, github, repository, validate });
  await tick();
  assert.equal(queue.internalState(claim.id), 'validated');
  await assert.rejects(tick(), /loss of response/);
  assert.equal(branch, validated);
  queue.close();
  queue = openQueue(database);
  try {
    await createWorker({ queue, tasks, github, repository, validate })();
    assert.equal(queue.status(claim.id, claim.token).pullRequest, pull.html_url);
    assert.equal(opens, 1);
  } finally {
    queue.close();
  }
});

test('snapshot creation rejects casing collisions, non-regular files and empty diffs', async t => {
  const { git, base } = await fixture(t);
  const job = { base, task: task.id, created: date };
  const commit = await prepareCommit(git, job, [submittedFile]);
  await assert.rejects(prepareCommit(git, { ...job, base: commit }, [submittedFile]), InvalidChange);
  await assert.rejects(prepareCommit(git, { ...job, base: commit },
    [{ ...submittedFile, path: 'docs/testing.md' }]), InvalidChange);
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: 'different.md' })).toString().trim();
  const tree = (await git(['mktree'], { input: '120000 blob ' + blob + '\tlink.md\n' })).toString().trim();
  const linkBase = (await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit-tree', tree, '-m', 'Symlink fixture'])).toString().trim();
  await assert.rejects(prepareCommit(git, { ...job, base: linkBase },
    [{ path: 'link.md', content: 'replacement' }]), InvalidChange);
});
