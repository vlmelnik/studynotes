'use strict';
// Google sign-in (OAuth 2.0 for installed apps, loopback redirect + PKCE) and a
// minimal Google Drive v3 REST client implementing the remote interface used
// by sync.js.
//
// Drive layout (all inside one app folder, appProperties.snRoot=1):
//   StudyNotes Library/
//     PDF/                       readable PDF of every notebook   (snRole=pdf)
//     Backups/                   daily .studynotes per notebook   (snRole=backups)
//     Sync data (do not edit)/   the library files, same folders as on disk (snRole=sync)
// The relative path of every file lives in appProperties (snPath, split over
// snPath1.. if long) and is the source of truth; folders are only for people
// looking at their Drive. Every file also carries snRole and snLib (= the root
// folder id), so one query lists a whole area. Scope is drive.file, so the app
// only ever sees files it created itself.
//
// Both `fetch` implementations are injected so the integrator can pass
// Electron's net.fetch (system proxy / certificates) and tests can pass fakes.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const MULTIPART_LIMIT = 5 * 1024 * 1024; // <= 5 MB: single multipart request
const CHUNK = 8 * 1024 * 1024;           // resumable chunk; must be a multiple of 256 KiB
const MAX_TRIES = 5;
const EXPIRY_MARGIN_MS = 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function authError(message, code) { return Object.assign(new Error(message), { code }); }

// ---------------------------------------------------------------- OAuth

// PKCE pair: verifier = 43 chars of base64url randomness, challenge = base64url(sha256(verifier)).
function createPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline', // we want a refresh_token
    prompt: 'consent',      // ...every time, even on re-sign-in
    state,
  }).toString();
  return u.toString();
}

const DONE_PAGE = (msg) => `<!doctype html><meta charset="utf-8"><title>StudyNotes</title>
<body style="font-family:system-ui,sans-serif;text-align:center;padding-top:15vh">
<h2>${msg}</h2><p>You can close this tab and return to StudyNotes.</p></body>`;

/**
 * tokenStore: { load(): Promise<obj|null>, save(obj): Promise<void>, clear(): Promise<void> }
 * Stored object: { access_token, refresh_token, expires_at (ms epoch), email, name }
 */
class GoogleAuth {
  constructor({ clientId, clientSecret, tokenStore, openExternal, fetch = globalThis.fetch, timeoutMs = 5 * 60 * 1000, now = Date.now }) {
    if (!clientId) throw new Error('GoogleAuth: clientId required');
    this.clientId = clientId;
    // Google issues a "secret" for desktop clients too; it is not really
    // secret (it ships in the app) but the token endpoint still wants it.
    this.clientSecret = clientSecret;
    this.store = tokenStore;
    this.openExternal = openExternal;
    this.fetch = fetch;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.tokens = undefined; // undefined = not loaded yet, null = signed out
    this._refreshing = null;
    this._pendingSignIn = null;
  }

  async _load() {
    if (this.tokens === undefined) this.tokens = (await this.store.load()) || null;
    return this.tokens;
  }

  async isSignedIn() {
    const t = await this._load();
    return !!(t && (t.refresh_token || t.access_token));
  }

  async getAccount() {
    const t = await this._load();
    return t ? { email: t.email || null, name: t.name || null } : null;
  }

  // Interactive sign-in. Resolves with { email, name }.
  async signIn() {
    if (this._pendingSignIn) return this._pendingSignIn; // second click: same flow
    this._pendingSignIn = this._signIn().finally(() => { this._pendingSignIn = null; });
    return this._pendingSignIn;
  }

  async _signIn() {
    const { verifier, challenge } = createPkce();
    const state = b64url(crypto.randomBytes(16));
    const { code, redirectUri } = await this._waitForCode(state, (redirectUri) =>
      buildAuthUrl({ clientId: this.clientId, redirectUri, challenge, state }));

    const tok = await this._tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    if (!tok.refresh_token) throw authError('Google did not return a refresh token', 'AUTH_FAILED');
    this.tokens = this._fromResponse(tok, null);

    // drive.file gives no access to the userinfo endpoint; Drive's "about" works.
    try {
      const res = await this.fetch(`${API}/about?fields=${encodeURIComponent('user(emailAddress,displayName)')}`, {
        headers: { Authorization: `Bearer ${this.tokens.access_token}` },
      });
      if (res.ok) {
        const { user = {} } = await res.json();
        this.tokens.email = user.emailAddress || null;
        this.tokens.name = user.displayName || null;
      }
    } catch { /* the account label is cosmetic */ }

    await this.store.save(this.tokens);
    return { email: this.tokens.email || null, name: this.tokens.name || null };
  }

  // Start a loopback server on 127.0.0.1:<random port>, open the browser and
  // wait for Google's redirect. Resolves { code, redirectUri }.
  _waitForCode(state, makeUrl) {
    return new Promise((resolve, reject) => {
      let finished = false;
      let timer;
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') { res.writeHead(404); res.end(); return; } // e.g. /favicon.ico
        const p = url.searchParams;
        let err = null;
        if (p.get('state') !== state) err = authError('Sign-in failed (state mismatch)', 'AUTH_FAILED');
        else if (p.get('error')) err = authError(`Sign-in cancelled (${p.get('error')})`, 'AUTH_CANCELLED');
        else if (!p.get('code')) err = authError('Sign-in failed (no code)', 'AUTH_FAILED');
        res.writeHead(err ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
        // A wrong-state request (stray tab) must not abort a valid pending flow.
        const stray = err && err.message.includes('state mismatch');
        // Shut the server down only once the page has been flushed to the browser.
        res.end(DONE_PAGE(err ? 'Sign-in did not complete.' : 'Signed in to StudyNotes.'), () => {
          if (!stray) finish(err, err ? null : { code: p.get('code'), redirectUri });
        });
      });
      let redirectUri;
      const finish = (err, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        server.close();
        server.closeAllConnections?.();
        err ? reject(err) : resolve(value);
      };
      server.on('error', (e) => finish(e));
      server.listen(0, '127.0.0.1', async () => {
        redirectUri = `http://127.0.0.1:${server.address().port}`;
        timer = setTimeout(() => finish(authError('Sign-in timed out', 'AUTH_TIMEOUT')), this.timeoutMs);
        try { await this.openExternal(makeUrl(redirectUri)); } catch (e) { finish(e); }
      });
    });
  }

  async _tokenRequest(params) {
    const body = new URLSearchParams({ client_id: this.clientId, ...params });
    if (this.clientSecret) body.set('client_secret', this.clientSecret);
    const res = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // invalid_grant = refresh token revoked/expired: the user must sign in again.
      const code = json.error === 'invalid_grant' ? 'AUTH_REVOKED' : 'AUTH_FAILED';
      throw authError(`Token request failed: ${json.error_description || json.error || res.status}`, code);
    }
    return json;
  }

  _fromResponse(tok, prev) {
    return {
      ...(prev || {}),
      access_token: tok.access_token,
      // Refresh responses usually omit refresh_token: keep the old one.
      refresh_token: tok.refresh_token || (prev && prev.refresh_token),
      expires_at: this.now() + (Number(tok.expires_in) || 3600) * 1000,
    };
  }

  // Valid access token, refreshed when it expires within 60 s (or when force=true,
  // used after a 401). Concurrent callers share one refresh request.
  async getAccessToken({ force = false } = {}) {
    const t = await this._load();
    if (!t || !(t.access_token || t.refresh_token)) throw authError('Not signed in to Google', 'NOT_SIGNED_IN');
    if (!force && t.access_token && t.expires_at - EXPIRY_MARGIN_MS > this.now()) return t.access_token;
    if (!t.refresh_token) throw authError('Not signed in to Google', 'NOT_SIGNED_IN');
    if (!this._refreshing) {
      this._refreshing = (async () => {
        try {
          const tok = await this._tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
          this.tokens = this._fromResponse(tok, t);
          await this.store.save(this.tokens);
          return this.tokens.access_token;
        } catch (err) {
          if (err.code === 'AUTH_REVOKED') { this.tokens = null; await this.store.clear(); }
          throw err;
        } finally {
          this._refreshing = null;
        }
      })();
    }
    return this._refreshing;
  }

  async signOut() {
    const t = await this._load();
    const token = t && (t.refresh_token || t.access_token);
    if (token) {
      // Revoking the refresh token also revokes its access tokens. Best effort:
      // signing out locally must work offline too.
      try {
        await this.fetch(REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
        });
      } catch { /* ignore */ }
    }
    this.tokens = null;
    await this.store.clear();
  }
}

// ---------------------------------------------------------------- Drive

class DriveError extends Error {
  constructor(message, status, reason) { super(message); this.status = status; this.reason = reason; }
}

// appProperties: key + value must fit in 124 bytes (UTF-8). Long paths are
// split over snPath, snPath1, snPath2, ... (at most ~3 KB of path).
const PROP_BYTES = 110;
function encodePath(p) {
  const parts = [];
  let cur = '';
  for (const ch of p) { // iterate code points: never split a UTF-8 sequence
    if (Buffer.byteLength(cur + ch) > PROP_BYTES) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  parts.push(cur);
  if (parts.length > 26) throw new Error('Path too long for Drive: ' + p);
  const props = {};
  parts.forEach((v, i) => { props[i ? `snPath${i}` : 'snPath'] = v; });
  return props;
}
function decodePath(props) {
  if (!props || typeof props.snPath !== 'string') return null;
  let p = props.snPath;
  for (let i = 1; typeof props[`snPath${i}`] === 'string'; i++) p += props[`snPath${i}`];
  return p;
}

const MIME = { '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; // Drive query string literal

class DriveRemote {
  /**
   * @param {object} o
   * @param {GoogleAuth} o.auth
   * @param {Function} [o.fetch]
   * @param {string} [o.rootName]
   * @param {object} [o.state]  plain object the integrator may persist; DriveRemote keeps state.rootId in it
   * @param {Function} [o.sleep] injectable for tests
   */
  constructor({ auth, fetch = globalThis.fetch, rootName = 'StudyNotes Library', state = {}, sleep: sleepFn = sleep }) {
    this.auth = auth;
    this.fetch = fetch;
    this.rootName = rootName;
    this.state = state;
    this.sleep = sleepFn;
    this.rootId = null;
    this.areas = null;
    this.folderCache = new Map();
  }

  // One HTTP request with auth, 401 refresh-once and retry/backoff on 429/5xx,
  // 403 rate limits and network errors. `body` may be a function returning a
  // fresh body per attempt. Returns the Response (status < 400 or 308).
  async _request(url, { method = 'GET', headers = {}, body, okStatuses = [], tries = MAX_TRIES } = {}) {
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      const token = await this.auth.getAccessToken();
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...headers },
          body: typeof body === 'function' ? await body() : body,
          redirect: 'manual', // resumable uploads answer 308 "Resume Incomplete" without Location
        });
      } catch (err) {
        if (attempt >= tries) throw err;
        await this.sleep(this._backoff(attempt));
        continue;
      }
      if (res.ok || okStatuses.includes(res.status)) return res;

      let info = {};
      try { info = (await res.json()).error || {}; } catch { /* non-JSON error body */ }
      const reason = info.errors && info.errors[0] && info.errors[0].reason;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.auth.getAccessToken({ force: true });
        attempt--; // the refresh retry doesn't count against the backoff budget
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500 ||
        (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(reason || ''));
      if (retryable && attempt < tries) {
        const ra = Number(res.headers.get('retry-after'));
        await this.sleep(ra > 0 ? Math.min(ra * 1000, 60000) : this._backoff(attempt));
        continue;
      }
      const err = new DriveError(`Drive ${method} failed: ${res.status} ${info.message || res.statusText || ''}`.trim(), res.status, reason);
      if (res.status === 401) err.code = 'AUTH_REVOKED';
      throw err;
    }
  }

  _backoff(attempt) { return Math.min(32000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250); }

  async _json(url, opts) { return (await this._request(url, opts)).json(); }

  // Find (or create) the app's root folder and its three area folders.
  async init() {
    let root = null;
    if (this.state.rootId) {
      try {
        const f = await this._json(`${API}/files/${encodeURIComponent(this.state.rootId)}?fields=id,trashed`);
        if (!f.trashed) root = f.id;
      } catch (err) { if (err.status !== 404) throw err; }
    }
    if (!root) {
      const query = `mimeType = '${FOLDER_MIME}' and appProperties has { key='snRoot' and value='1' } and trashed = false`;
      const found = await this._json(`${API}/files?${new URLSearchParams({ q: query, orderBy: 'createdTime', pageSize: '10', fields: 'files(id,name)', spaces: 'drive' })}`);
      root = found.files && found.files.length
        ? found.files[0].id // oldest wins if two devices raced
        : (await this._createFolder(this.rootName, null, { snRoot: '1' })).id;
    }
    // Folders are looked up again on every sync: the user (or the other PC)
    // may have deleted or trashed some, and new files must never go there.
    this.folderCache = new Map();
    this.areas = null;
    this.rootId = root;
    this.state.rootId = root;
    if (!this.areas) {
      this.areas = {};
      for (const [role, name] of Object.entries(AREAS)) {
        const query = `${q(root)} in parents and mimeType = '${FOLDER_MIME}' and appProperties has { key='snRole' and value=${q(role)} } and trashed = false`;
        const found = await this._json(`${API}/files?${new URLSearchParams({ q: query, orderBy: 'createdTime', pageSize: '10', fields: 'files(id)', spaces: 'drive' })}`);
        this.areas[role] = found.files && found.files.length ? found.files[0].id : (await this._createFolder(name, root, { snRole: role, snLib: root })).id;
      }
    }
    return this.rootId;
  }

  async _createFolder(name, parent, appProperties) {
    return this._json(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}), ...(appProperties ? { appProperties } : {}) }),
    });
  }

  // Folder for a '/'-separated directory inside an area, created on demand.
  async folderFor(role, relDir) {
    if (!this.areas) await this.init();
    if (!relDir || relDir === '.') return this.areas[role];
    const key = role + '|' + relDir;
    if (!this.folderCache.has(key)) {
      this.folderCache.set(key, (async () => {
        const parentDir = relDir.includes('/') ? relDir.slice(0, relDir.lastIndexOf('/')) : '';
        const parent = await this.folderFor(role, parentDir);
        const name = relDir.slice(relDir.lastIndexOf('/') + 1);
        const query = `${q(parent)} in parents and name = ${q(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`;
        const found = await this._json(`${API}/files?${new URLSearchParams({ q: query, pageSize: '10', fields: 'files(id)', spaces: 'drive' })}`);
        return found.files && found.files.length ? found.files[0].id : (await this._createFolder(name, parent, { snLib: this.rootId })).id;
      })().catch((err) => { this.folderCache.delete(key); throw err; }));
    }
    return this.folderCache.get(key);
  }

  // All files of one area: [{ id, path, md5, size, modifiedTime, props }].
  async _listArea(role) {
    const out = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: `appProperties has { key='snLib' and value=${q(this.rootId)} } and appProperties has { key='snRole' and value=${q(role)} } and mimeType != '${FOLDER_MIME}' and trashed = false`,
        pageSize: '1000',
        fields: 'nextPageToken, files(id,name,md5Checksum,size,modifiedTime,appProperties)',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this._json(`${API}/files?${params}`);
      for (const f of page.files || []) {
        const p = decodePath(f.appProperties);
        if (!p) continue;
        out.push({ id: f.id, path: p, md5: f.md5Checksum || null, size: Number(f.size) || 0, modifiedTime: f.modifiedTime, props: f.appProperties || {} });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async list() {
    if (!this.areas) await this.init();
    await this._migrateFlat();
    return (await this._listArea('sync')).map(({ props, ...f }) => f);
  }

  // Version 1.2 kept every file flat in the root folder: move those into
  // "Sync data/<folders>" once (same file ids, so the sync state stays valid).
  async _migrateFlat() {
    if (this.migrated) return;
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: `${q(this.rootId)} in parents and mimeType != '${FOLDER_MIME}' and trashed = false`,
        pageSize: '1000', fields: 'nextPageToken, files(id,appProperties)', spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this._json(`${API}/files?${params}`);
      for (const f of page.files || []) {
        const p = decodePath(f.appProperties);
        if (!p || (f.appProperties && f.appProperties.snRole)) continue;
        const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
        const folder = await this.folderFor('sync', dir);
        await this._json(`${API}/files/${encodeURIComponent(f.id)}?${new URLSearchParams({ addParents: folder, removeParents: this.rootId, fields: 'id' })}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ appProperties: { snRole: 'sync', snLib: this.rootId } }),
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    this.migrated = true;
  }

  // ---- PDF / Backups areas (files that only go up, never down)
  listOutputs(role) { return this._listArea(role); }

  // Create or replace one file in an area. `id` = existing file to replace.
  async putOutput(role, relPath, src, { id = null, props = {} } = {}) {
    return this._send(id, relPath, src, role, props);
  }

  upload(relPath, src) { return this._send(null, relPath, src); }
  update(id, relPath, src) { return this._send(id, relPath, src); }

  // src: Buffer or absolute file path. Create (id=null) or replace content.
  async _send(id, relPath, src, role = 'sync', props = {}) {
    if (!this.areas) await this.init();
    const size = Buffer.isBuffer(src) ? src.length : (await fsp.stat(src)).size;
    const meta = {
      name: path.posix.basename(relPath),
      appProperties: { ...encodePath(relPath), snRole: role, snLib: this.rootId, ...props },
      mimeType: mimeOf(relPath),
    };
    if (!id) meta.parents = [await this.folderFor(role, relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '')];
    const base = id ? `${UPLOAD_API}/files/${encodeURIComponent(id)}` : `${UPLOAD_API}/files`;
    const method = id ? 'PATCH' : 'POST';
    const f = size <= MULTIPART_LIMIT
      ? await this._multipart(base, method, meta, Buffer.isBuffer(src) ? src : await fsp.readFile(src))
      : await this._resumable(base, method, meta, src, size);
    return { id: f.id, md5: f.md5Checksum || null };
  }

  async _multipart(base, method, meta, bytes) {
    const boundary = 'sn' + crypto.randomBytes(12).toString('hex');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
        `--${boundary}\r\nContent-Type: ${meta.mimeType}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this._json(`${base}?uploadType=multipart&fields=id,md5Checksum`, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  // Resumable upload: open a session, then PUT 8 MB chunks read from disk
  // (never the whole file in memory). After a failed chunk we ask the server
  // how much it has (Content-Range: bytes */total) and continue from there.
  async _resumable(base, method, meta, src, size) {
    const start = await this._request(`${base}?uploadType=resumable&fields=id,md5Checksum`, {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': meta.mimeType, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify(meta),
    });
    const session = start.headers.get('location');
    if (!session) throw new DriveError('Drive did not return an upload session', start.status);

    const fh = Buffer.isBuffer(src) ? null : await fsp.open(src, 'r');
    try {
      let offset = 0;
      let failures = 0;
      while (true) {
        const len = Math.min(CHUNK, size - offset);
        let chunk;
        if (fh) {
          chunk = Buffer.alloc(len);
          const { bytesRead } = await fh.read(chunk, 0, len, offset);
          if (bytesRead !== len) throw new Error('File changed while uploading');
        } else {
          chunk = src.subarray(offset, offset + len);
        }
        let res;
        try {
          // The session URI carries its own auth; a token header is harmless.
          res = await this._request(session, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}`, 'Content-Type': meta.mimeType },
            body: chunk,
            okStatuses: [308],
            tries: 1, // don't blindly resend a chunk: ask the server what it has instead
          });
        } catch (err) {
          if (err.status === 404 || err.status === 410 || ++failures >= MAX_TRIES) throw err; // session expired
          await this.sleep(this._backoff(failures));
          offset = await this._resumeOffset(session, size);
          if (offset === size) return this._finalize(session, size);
          continue;
        }
        if (res.status !== 308) return res.json(); // 200/201: upload complete
        offset = rangeEnd(res.headers.get('range'));
      }
    } finally {
      if (fh) await fh.close();
    }
  }

  async _resumeOffset(session, size) {
    const res = await this._request(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` }, okStatuses: [308] });
    return res.status === 308 ? rangeEnd(res.headers.get('range')) : size;
  }

  async _finalize(session, size) {
    const res = await this._request(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` }, okStatuses: [308] });
    if (res.status === 308) throw new DriveError('Upload incomplete', 308);
    return res.json();
  }

  async download(id) {
    const res = await this._request(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Stream to disk (for big PDFs). The caller (sync.js) passes a temp path and renames.
  async downloadToFile(id, file) {
    for (let attempt = 1; ; attempt++) {
      const res = await this._request(`${API}/files/${encodeURIComponent(id)}?alt=media`);
      try {
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
        return;
      } catch (err) {
        if (attempt >= MAX_TRIES) throw err; // connection dropped mid-body
        await this.sleep(this._backoff(attempt));
      }
    }
  }

  // Move to Drive's trash (recoverable for 30 days), never a permanent delete.
  // `relPath` (optional) lets cleanup() remove folders that became empty.
  async remove(id, relPath, role = 'sync') {
    if (relPath && relPath.includes('/')) (this.emptied ||= new Set()).add(role + '|' + relPath.slice(0, relPath.lastIndexOf('/')));
    try {
      await this._request(`${API}/files/${encodeURIComponent(id)}?fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ trashed: true }),
      });
    } catch (err) {
      if (err.status !== 404) throw err; // already gone: fine
    }
  }

  // Trash folders that became empty after removals (deepest first; never an area folder).
  async cleanup() {
    const keys = [...(this.emptied || [])].sort((a, b) => b.split('/').length - a.split('/').length);
    this.emptied = new Set();
    const seen = new Set();
    for (let key of keys) {
      while (key && !seen.has(key)) {
        seen.add(key);
        const [role, dir] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
        if (!dir) break;
        const id = await this.folderFor(role, dir);
        const kids = await this._json(`${API}/files?${new URLSearchParams({ q: `${q(id)} in parents and trashed = false`, pageSize: '1', fields: 'files(id)', spaces: 'drive' })}`);
        if (kids.files && kids.files.length) break;
        await this.remove(id);
        this.folderCache.delete(key);
        key = dir.includes('/') ? role + '|' + dir.slice(0, dir.lastIndexOf('/')) : null;
      }
    }
  }
}

// Folder names shown in Drive for the three areas.
const AREAS = { sync: 'Sync data (do not edit)', pdf: 'PDF', backups: 'Backups' };

// "Range: bytes=0-8388607" -> next offset 8388608 (no header = nothing received).
function rangeEnd(range) {
  const m = /bytes=\d+-(\d+)/.exec(range || '');
  return m ? Number(m[1]) + 1 : 0;
}

module.exports = { GoogleAuth, DriveRemote, DriveError, createPkce, buildAuthUrl, encodePath, decodePath, SCOPE, AREAS };
