import { randomUUID } from 'node:crypto';
import { claimLifetime, hash, newToken, resolveTask } from './policy.mjs';

export function createQueue(db, transaction) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS jobs (' +
    'id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL, task TEXT NOT NULL,' +
    'base TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL,' +
    'digest TEXT, payload TEXT, commit_sha TEXT, pr INTEGER, url TEXT, reason TEXT);' +
    'CREATE TABLE IF NOT EXISTS locks (path TEXT PRIMARY KEY, job TEXT NOT NULL REFERENCES jobs(id));' +
    'CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, created);'
  );
  db.exec('CREATE TABLE IF NOT EXISTS public_claims (job TEXT PRIMARY KEY REFERENCES jobs(id), source TEXT NOT NULL, created INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS checkpoints (task TEXT PRIMARY KEY, snapshot TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS findings (task TEXT PRIMARY KEY, evidence TEXT NOT NULL)');
  const get = id => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  const unlock = id => db.prepare('DELETE FROM locks WHERE job = ?').run(id);
  const expire = now => {
    db.prepare("UPDATE jobs SET state='expired' WHERE state='claimed' AND expires <= ?").run(now);
    db.exec("DELETE FROM locks WHERE job IN (SELECT id FROM jobs WHERE state='expired')");
  };
  const visible = row => ({
    id: row.id, task: row.task, base: row.base, status: row.state, expiresAt: row.expires,
    ...(row.url && { pullRequest: row.url }), ...(row.reason && { reason: row.reason }),
  });
  const authenticated = (id, token) =>
    db.prepare('SELECT * FROM jobs WHERE id = ? AND token_hash = ?').get(id, hash(token));

  function reserve(task, base, nonce, now) {
    if (db.prepare("SELECT 1 FROM jobs WHERE nonce = ? OR (task = ? AND state IN " +
      "('claimed','queued','validated','published','merged'))").get(nonce, task.id)) return null;
    for (const file of task.paths) {
      if (db.prepare('SELECT 1 FROM locks WHERE path = ?').get(file.toLowerCase())) return null;
    }
    const id = randomUUID();
    const token = newToken();
    db.prepare("INSERT INTO jobs (id,nonce,token_hash,task,base,created,expires,state) " +
      "VALUES (?,?,?,?,?,?,?,'claimed')").run(id, nonce, hash(token), task.id, base, now, now + claimLifetime);
    const lock = db.prepare('INSERT INTO locks (path,job) VALUES (?,?)');
    for (const file of task.paths) lock.run(file.toLowerCase(), id);
    return { ...visible(get(id)), token };
  }

  return {
    close: () => db.close(),
    internalState: id => get(id)?.state,
    claim({ task, base, nonce, now = Date.now() }) {
      return transaction(() => {
        expire(now);
        return reserve(task, base, nonce, now);
      });
    },
    takeNext(tasks, base, source, now = Date.now()) {
      return transaction(() => {
        expire(now);
        const since = now - 86400000;
        db.prepare('DELETE FROM public_claims WHERE created <= ?').run(since);
        if (db.prepare('SELECT COUNT(*) AS n FROM public_claims').get().n >= 24 ||
            db.prepare('SELECT COUNT(*) AS n FROM public_claims WHERE source=?').get(source).n >= 6) {
          return { status: 'limit_reached' };
        }
        const followups = db.prepare('SELECT task, evidence FROM findings ORDER BY rowid').all();
        const candidates = [...tasks.values(), ...followups.map(row => resolveTask(tasks, row.task)).filter(Boolean)];
        for (const task of candidates) {
          if (task.invite_only || task.after?.some(id =>
            !db.prepare("SELECT 1 FROM jobs WHERE task=? AND state='merged'").get(id))) continue;
          if (db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE task=? AND state='rejected'").get(task.id).n >= 3) continue;
          const claim = reserve(task, base, randomUUID(), now);
          if (!claim) continue;
          db.prepare('INSERT INTO public_claims(job,source,created) VALUES(?,?,?)').run(claim.id, source, now);
          const snapshot = db.prepare('SELECT snapshot FROM checkpoints WHERE task=?').get(task.id);
          const evidence = followups.find(row => row.task === task.id)?.evidence;
          const previousWork = snapshot && JSON.parse(snapshot.snapshot);
          if (previousWork) previousWork.files = previousWork.files.filter(file => task.paths.includes(file.path));
          const failure = db.prepare("SELECT reason FROM jobs WHERE task=? AND state IN ('rejected','stale') ORDER BY created DESC LIMIT 1").get(task.id);
          return { ...claim, ...(previousWork && { previousWork }), ...(failure?.reason && { previousFailure: failure.reason }),
            ...(evidence && { evidence }) };
        }
        return { status: 'no_ready_task' };
      });
    },
    saveProgress(id, token, data, followup = false, now = Date.now()) {
      return transaction(() => {
        expire(now);
        const row = authenticated(id, token);
        if (row?.state !== 'claimed') return false;
        if (followup) {
          const key = 'sn-review-' + row.task.slice(3);
          db.prepare('INSERT OR IGNORE INTO findings(task,evidence) VALUES(?,?)').run(key, data);
          return key;
        }
        db.prepare('INSERT OR REPLACE INTO checkpoints(task,snapshot) VALUES(?,?)').run(row.task, JSON.stringify(data));
        return true;
      });
    },
    status(id, token, now = Date.now()) {
      return transaction(() => {
        expire(now);
        const row = authenticated(id, token);
        return row ? visible(row) : null;
      });
    },
    submit(id, token, input, head, now = Date.now()) {
      return transaction(() => {
        expire(now);
        const row = authenticated(id, token);
        if (!row) return { code: 404 };
        const payload = JSON.stringify(input);
        const digest = hash(payload);
        if (row.digest === digest) return { code: 202, job: visible(row) };
        if (row.state !== 'claimed' || input.base !== row.base || input.base !== head) return { code: 409 };
        db.prepare("UPDATE jobs SET state='queued', digest=?, payload=? WHERE id=?").run(digest, payload, id);
        return { code: 202, job: visible(get(id)) };
      });
    },
    next: () => db.prepare("SELECT * FROM jobs WHERE state IN ('queued','validated') ORDER BY created LIMIT 1").get(),
    publishedJobs: () => db.prepare("SELECT * FROM jobs WHERE state='published' ORDER BY created").all(),
    validated(id, commit) {
      db.prepare("UPDATE jobs SET state='validated', commit_sha=? WHERE id=? AND state='queued'").run(commit, id);
    },
    published(id, number, url) {
      db.prepare("UPDATE jobs SET state='published', pr=?, url=?, payload=NULL WHERE id=? AND state='validated'")
        .run(number, url, id);
    },
    finish(id, state, reason = null) {
      transaction(() => {
        db.prepare("UPDATE jobs SET state=?, reason=?, payload=NULL WHERE id=?").run(state, reason, id);
        unlock(id);
      });
    },
    cancel(id, token) {
      return transaction(() => {
        const row = authenticated(id, token);
        if (!row) return 404;
        if (row.state !== 'claimed') return 409;
        db.prepare("UPDATE jobs SET state='cancelled' WHERE id=?").run(id);
        unlock(id);
        return 200;
      });
    },
  };
}
