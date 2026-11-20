import { botPrefix, submission } from '../policy.mjs';

export async function publish(queue, github, tasks, job) {
  const branch = botPrefix + job.task + '/' + job.id;
  const reject = reason => queue.finish(job.id, 'rejected', reason);
  const data = submission(tasks.get(job.task) || { paths: [] }, JSON.parse(job.payload));
  if (!data) return reject('Task scope changed.');
  const existing = await github.findPull(branch);
  if (existing) {
    if (existing.base.ref !== 'main' || existing.head.sha !== job.commit_sha) return reject('Draft revision mismatch.');
    return queue.published(job.id, existing.number, existing.html_url);
  }
  if (await github.head() !== job.base) return queue.finish(job.id, 'stale', 'Main changed. Request a new invitation.');
  if (job.state === 'queued') {
    const parent = await github.request('/git/commits/' + job.base);
    const tree = await github.request('/git/trees/' + parent.tree.sha + '?recursive=1');
    if (tree.truncated) return reject('Base tree exceeded the pilot size limit.');
    const entries = new Map(tree.tree.map(entry => [entry.path.toLowerCase(), entry]));
    for (const { path } of data.files) {
      const parts = path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join('/');
        const entry = entries.get(prefix.toLowerCase());
        if (entry && (entry.path !== prefix || entry.mode !== (i === parts.length ? '100644' : '040000'))) {
          return reject('The approved path conflicts with an existing entry.');
        }
      }
    }
    const post = (path, body) => github.request(path, { method: 'POST', body });
    const updated = await post('/git/trees', { base_tree: parent.tree.sha,
      tree: data.files.map(({ path, content }) => ({ path, content, type: 'blob', mode: '100644' })) });
    if (updated.sha === parent.tree.sha) return reject('Empty change.');
    const identity = { name: 'StudyNotes Contributions', email: 'guest-contributions@users.noreply.github.com',
      date: new Date(job.created).toISOString() };
    const commit = await post('/git/commits', { message: 'Guest contribution ' + job.task, tree: updated.sha,
      parents: [job.base], author: identity, committer: identity });
    // Persist the expected commit before creating any visible ref.
    queue.validated(job.id, commit.sha);
    return;
  }
  const sha = await github.branch(branch);
  if (sha && sha !== job.commit_sha) return reject('Reserved branch revision mismatch.');
  if (!sha) await github.request('/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + branch, sha: job.commit_sha } });
  const pr = await github.openPull(branch, job, data.report, false);
  queue.published(job.id, pr.number, pr.html_url);
}
