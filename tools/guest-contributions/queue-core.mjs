import { randomUUID } from 'node:crypto';
import { claimLifetime, hash, newToken } from './policy.mjs';

export function createQueue(db, transaction) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS jobs (' +
    'id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL, task TEXT NOT NULL,' +
    'base TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL,' +
    'digest TEXT, payload TEXT, commit_sha TEXT, pr INTEGER, url TEXT, reason TEXT);' +
    'CREATE TABLE IF NOT EXISTS locks (path TEXT PRIMARY KEY, job TEXT NOT NULL REFERENCES jobs(id));' +
    'CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, created);'
  );
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

  return {
    close: () => db.close(),
    internalState: id => get(id)?.state,
    claim({ task, base, nonce, now = Date.now() }) {
      return transaction(() => {
        expire(now);
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
