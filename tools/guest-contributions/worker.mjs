import { baseBranch, botPrefix, submission } from './policy.mjs';
import { InvalidChange, prepareCommit } from './git.mjs';

export function createWorker({ queue, tasks, github, repository, validate }) {
  let busy = false;
  let nextReview = 0;
  let reviewOffset = 0;
  async function reconcile() {
    const reviews = queue.publishedJobs();
    if (!reviews.length) return;
    // Check one at a time so a large backlog cannot starve queued submissions or API quotas.
    const job = reviews[reviewOffset++ % reviews.length];
    const pr = await github.pull(job.pr);
    if (pr.merged) queue.finish(job.id, 'merged');
    else if (pr.state === 'closed') queue.finish(job.id, 'closed');
  }

  async function process(job) {
    const branch = botPrefix + job.task + '/' + job.id;
    const recordPull = pr => {
      if (pr.head.sha !== job.commit_sha || pr.base.ref !== baseBranch) {
        throw new Error('GitHub returned a different candidate for the reserved pull request');
      }
      queue.published(job.id, pr.number, pr.html_url);
    };
    if (job.state === 'validated') {
      // Opening the PR may already have succeeded before a crash or a lost API response.
      const existing = await github.findPull(branch);
      if (existing) return recordPull(existing);
    }
    const submitted = submission(tasks.get(job.task) || { paths: [] }, JSON.parse(job.payload));
    if (!submitted) return queue.finish(job.id, 'rejected', 'Task scope changed or is no longer enabled.');
    const stale = () => queue.finish(job.id, 'stale', 'Main changed. Ask for a fresh invitation.');
    if (await github.head() !== job.base) return stale();
    if (job.state === 'queued') {
      if (await repository.fetchBase() !== job.base) return stale();
      let commit;
      try {
        commit = await prepareCommit(repository.git, job, submitted.files);
      } catch (error) {
        if (error instanceof InvalidChange) return queue.finish(job.id, 'rejected', error.message);
        throw error;
      }
      if (!await validate(commit, job.id)) {
        return queue.finish(job.id, 'rejected', 'Offline unit or build checks failed or timed out.');
      }
      if (await github.head() !== job.base) return stale();
      // Keep the validated object reachable across restarts, Git maintenance and publishing retries.
      await repository.git(['update-ref', 'refs/guest-validation/' + job.id, commit]);
      queue.validated(job.id, commit);
      return;
    }
    const existingBranch = await github.branch(branch);
    if (existingBranch && existingBranch !== job.commit_sha) {
      return queue.finish(job.id, 'rejected', 'The reserved GitHub branch points to a different commit.');
    }
    if (!existingBranch) await repository.pushNew(branch, job.commit_sha, await github.token());
    if (await github.head() !== job.base) return stale();
    const pr = await github.openPull(branch, job, submitted.report);
    queue.published(job.id, pr.number, pr.html_url);
  }

  return async function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      if (now >= nextReview) {
        nextReview = now + 60_000;
        try {
          await reconcile();
        } catch {
          console.error('Guest contribution PR status refresh failed. It will retry.');
        }
      }
      const job = queue.next();
      if (job) {
        try {
          await process(job);
        } finally {
          const status = queue.internalState(job.id);
          if (status !== 'queued' && status !== 'validated') {
            await repository.git(['update-ref', '-d', 'refs/guest-validation/' + job.id]);
          }
        }
      }
    } finally {
      busy = false;
    }
  };
}
