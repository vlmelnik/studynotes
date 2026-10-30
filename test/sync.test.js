'use strict';
// Sync engine tests with an in-memory fake Drive, plus GoogleAuth / DriveRemote
// tests with a fake fetch (no network, no browser).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { syncLibrary, validRemotePath, md5File } = require('../src/main/sync');
const { GoogleAuth, DriveRemote, createPkce, buildAuthUrl, encodePath, decodePath } = require('../src/main/drive');
const { FakeDriveApi } = require('./fake-drive-api');

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

// ------------------------------------------------------------ fake remote

class FakeRemote {
  constructor() {
    this.files = new Map(); // id -> { id, path, bytes, modifiedTime }
    this.calls = { upload: 0, update: 0, download: 0, remove: 0 };
    this.order = [];        // ['upload:<path>', 'download:<path>', ...]
    this.n = 0;
    this.rootId = 'root1';
  }
  _bytes(src) { return Buffer.isBuffer(src) ? Buffer.from(src) : fs.readFileSync(src); }
  _stamp() { return new Date(Date.UTC(2026, 0, 1) + ++this.n * 1000).toISOString(); }
  async list() {
    return [...this.files.values()].map((f) => ({ id: f.id, path: f.path, md5: md5(f.bytes), size: f.bytes.length, modifiedTime: f.modifiedTime }));
  }
  async upload(p, src) {
    this.calls.upload++; this.order.push('upload:' + p);
    const id = 'f' + ++this.n;
    this.files.set(id, { id, path: p, bytes: this._bytes(src), modifiedTime: this._stamp() });
    return { id, md5: md5(this.files.get(id).bytes) };
  }
  async update(id, p, src) {
    this.calls.update++; this.order.push('update:' + p);
    const f = this.files.get(id);
    f.bytes = this._bytes(src); f.modifiedTime = this._stamp();
    return { id, md5: md5(f.bytes) };
  }
  async download(id) {
    this.calls.download++; this.order.push('download:' + this.files.get(id).path);
    return Buffer.from(this.files.get(id).bytes);
  }
  async remove(id) { this.calls.remove++; this.files.delete(id); }
  // test helpers ("another device")
  put(p, content) { const id = 'x' + ++this.n; this.files.set(id, { id, path: p, bytes: Buffer.from(content), modifiedTime: this._stamp() }); return id; }
  byPath(p) { return [...this.files.values()].find((f) => f.path === p); }
  transfers() { return this.calls.upload + this.calls.update + this.calls.download + this.calls.remove; }
}

function tmpdir(prefix = 'sn-sync-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function write(root, rel, content) {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const has = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));

// Bump mtime so the size/mtime cache can't hide an edit made within the same ms.
function edit(root, rel, content) {
  write(root, rel, content);
  const f = path.join(root, ...rel.split('/'));
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(f, t, t);
}

function smallLibrary(root) {
  write(root, 'Sem 1/Analysis/notebook.json', '{"title":"Analysis","pages":[{"id":"aaaaaa"}]}');
  write(root, 'Sem 1/Analysis/pages/aaaaaa.json', '{"strokes":[]}');
  write(root, 'Sem 1/Analysis/source.pdf', '%PDF-1.4 fake');
  write(root, 'Sem 1/Analysis/assets/0123456789abcdef0123.png', 'png');
  write(root, 'Physik/notebook.json', '{"title":"Physik","pages":[]}');
}

function setup() {
  const root = tmpdir();
  const statePath = path.join(tmpdir('sn-state-'), 'sync-state.json');
  const remote = new FakeRemote();
  const trashed = [];
  const run = (extra = {}) => syncLibrary({
    root, remote, statePath,
    trashLocal: async (abs) => { trashed.push(abs); fs.rmSync(abs); },
    ...extra,
  });
  return { root, statePath, remote, trashed, run };
}

// ------------------------------------------------------------ sync tests

test('first run uploads a small library, second run transfers nothing', async () => {
  const { root, remote, run, statePath } = setup();
  smallLibrary(root);
  const s1 = await run();
  assert.strictEqual(s1.uploaded, 5);
  assert.deepStrictEqual(s1.conflicts, []);
  assert.deepStrictEqual((await remote.list()).map((f) => f.path).sort(), [
    'Physik/notebook.json', 'Sem 1/Analysis/assets/0123456789abcdef0123.png', 'Sem 1/Analysis/notebook.json',
    'Sem 1/Analysis/pages/aaaaaa.json', 'Sem 1/Analysis/source.pdf']);
  assert.ok(fs.existsSync(statePath));

  const before = remote.transfers();
  const s2 = await run();
  assert.strictEqual(remote.transfers(), before);
  assert.deepStrictEqual([s2.uploaded, s2.downloaded, s2.deletedLocal, s2.deletedRemote], [0, 0, 0, 0]);
});

test('first run with identical content on both sides records state only', async () => {
  const { root, remote, run } = setup();
  write(root, 'A/notebook.json', '{"x":1}');
  remote.put('A/notebook.json', '{"x":1}');
  const s = await run();
  assert.strictEqual(remote.transfers(), 0);
  assert.strictEqual(s.uploaded + s.downloaded, 0);
});

test('local edit -> update, remote edit -> download', async () => {
  const { root, remote, run } = setup();
  smallLibrary(root);
  await run();

  edit(root, 'Sem 1/Analysis/pages/aaaaaa.json', '{"strokes":[1]}');
  const s1 = await run();
  assert.strictEqual(s1.uploaded, 1);
  assert.strictEqual(remote.calls.update, 1);
  assert.strictEqual(remote.byPath('Sem 1/Analysis/pages/aaaaaa.json').bytes.toString(), '{"strokes":[1]}');

  const f = remote.byPath('Physik/notebook.json');
  f.bytes = Buffer.from('{"title":"Physik 2"}');
  const s2 = await run();
  assert.strictEqual(s2.downloaded, 1);
  assert.strictEqual(read(root, 'Physik/notebook.json'), '{"title":"Physik 2"}');
  // no leftover temp files from atomicWrite
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'Physik')), ['notebook.json']);

  const s3 = await run();
  assert.strictEqual(s3.uploaded + s3.downloaded, 0);
});

test('remote-only file is downloaded into new folders', async () => {
  const { root, remote, run } = setup();
  remote.put('New/Deep/NB/pages/bbbbbb.json', '{}');
  const s = await run();
  assert.strictEqual(s.downloaded, 1);
  assert.strictEqual(read(root, 'New/Deep/NB/pages/bbbbbb.json'), '{}');
});

test('local delete -> remote remove; remote delete -> local trash', async () => {
  const { root, remote, run, trashed } = setup();
  smallLibrary(root);
  await run();

  fs.rmSync(path.join(root, 'Sem 1/Analysis/source.pdf'));
  const s1 = await run();
  assert.strictEqual(s1.deletedRemote, 1);
  assert.strictEqual(remote.byPath('Sem 1/Analysis/source.pdf'), undefined);

  remote.files.delete(remote.byPath('Physik/notebook.json').id);
  const s2 = await run();
  assert.strictEqual(s2.deletedLocal, 1);
  assert.deepStrictEqual(trashed, [path.join(root, 'Physik', 'notebook.json')]);
  assert.ok(!has(root, 'Physik'), 'empty notebook folder is pruned');

  const s3 = await run();
  assert.strictEqual(s3.deletedLocal + s3.deletedRemote + s3.uploaded + s3.downloaded, 0);
});

test('deleted on one side but changed on the other keeps the changed one', async () => {
  const { root, remote, run, trashed } = setup();
  smallLibrary(root);
  await run();

  // remote deleted, local edited -> re-upload
  remote.files.delete(remote.byPath('Physik/notebook.json').id);
  edit(root, 'Physik/notebook.json', '{"edited":true}');
  // local deleted, remote edited -> re-download
  fs.rmSync(path.join(root, 'Sem 1/Analysis/source.pdf'));
  remote.byPath('Sem 1/Analysis/source.pdf').bytes = Buffer.from('%PDF new');

  const s = await run();
  assert.strictEqual(s.uploaded, 1);
  assert.strictEqual(s.downloaded, 1);
  assert.strictEqual(trashed.length, 0);
  assert.strictEqual(remote.byPath('Physik/notebook.json').bytes.toString(), '{"edited":true}');
  assert.strictEqual(read(root, 'Sem 1/Analysis/source.pdf'), '%PDF new');
});

test('conflict keeps both files and names the copy correctly', async () => {
  const { root, remote, run } = setup();
  smallLibrary(root);
  await run();

  edit(root, 'Sem 1/Analysis/pages/aaaaaa.json', '{"local":1}');
  remote.byPath('Sem 1/Analysis/pages/aaaaaa.json').bytes = Buffer.from('{"remote":1}');
  const now = () => new Date(2026, 9, 19, 14, 5, 30); // local time
  const s = await run({ now });
  const copy = 'Sem 1/Analysis/pages/aaaaaa (Drive conflict 2026-10-19 14-05).json';
  assert.deepStrictEqual(s.conflicts, ['Sem 1/Analysis/pages/aaaaaa.json']);
  assert.strictEqual(read(root, 'Sem 1/Analysis/pages/aaaaaa.json'), '{"local":1}');
  assert.strictEqual(read(root, copy), '{"remote":1}');
  assert.strictEqual(remote.byPath('Sem 1/Analysis/pages/aaaaaa.json').bytes.toString(), '{"local":1}');
  assert.strictEqual(remote.byPath(copy).bytes.toString(), '{"remote":1}');
  // the app ignores the copy (not a page id)
  assert.ok(!/^[a-z0-9]{6,40}$/.test(path.basename(copy, '.json')));

  const s2 = await run({ now });
  assert.strictEqual(s2.uploaded + s2.downloaded + s2.conflicts.length, 0);
});

test('first run where both sides differ is a conflict (keep both)', async () => {
  const { root, remote, run } = setup();
  write(root, 'cover.png', 'local');
  remote.put('cover.png', 'remote');
  const s = await run({ now: () => new Date(2026, 0, 2, 3, 4) });
  assert.deepStrictEqual(s.conflicts, ['cover.png']);
  assert.strictEqual(read(root, 'cover (Drive conflict 2026-01-02 03-04).png'), 'remote');
  assert.strictEqual(remote.byPath('cover.png').bytes.toString(), 'local');
});

test('malicious remote paths are rejected and nothing is written outside root', async () => {
  const { root, remote, run } = setup();
  const outside = path.join(path.dirname(root), 'pwned-' + path.basename(root) + '.txt');
  const bad = [
    `../pwned-${path.basename(root)}.txt`, 'a/../../x.txt', '/etc/passwd', 'C:/Windows/x.txt', 'C:x',
    'a\\..\\..\\x.txt', 'a//b.json', './a.json', '.hidden/x.json', 'nb/.git/config', 'x.json.123.abc.tmp', '',
  ];
  for (const p of bad) remote.put(p, 'evil');
  remote.put('ok/file.json', 'fine');
  const s = await run();
  assert.strictEqual(s.downloaded, 1);
  assert.strictEqual(s.skipped, bad.length);
  assert.ok(!fs.existsSync(outside));
  assert.strictEqual(read(root, 'ok/file.json'), 'fine');
  assert.ok(!has(root, '.hidden'));
  for (const p of bad) assert.strictEqual(validRemotePath(p), null, p);
  assert.strictEqual(validRemotePath('Sem 1/NB/pages/abc123.json'), 'Sem 1/NB/pages/abc123.json');
});

test('.tmp files, dotfiles and dot-folders are ignored', async () => {
  const { root, remote, run } = setup();
  write(root, 'NB/notebook.json', '{}');
  write(root, 'NB/notebook.json.1234.abcdef.tmp', 'partial');
  write(root, '.DS_Store', 'x');
  write(root, 'NB/.hidden.json', 'x');
  write(root, '.git/config', 'x');
  write(root, 'NB/.cache/a.json', 'x');
  const s = await run();
  assert.strictEqual(s.uploaded, 1);
  assert.deepStrictEqual((await remote.list()).map((f) => f.path), ['NB/notebook.json']);
});

test('state file inside the root (as dotfile) is not synced', async () => {
  const root = tmpdir();
  const remote = new FakeRemote();
  write(root, 'a.json', '1');
  await syncLibrary({ root, remote, statePath: path.join(root, '.sync-state.json') });
  await syncLibrary({ root, remote, statePath: path.join(root, '.sync-state.json') });
  assert.deepStrictEqual((await remote.list()).map((f) => f.path), ['a.json']);
  assert.strictEqual(remote.calls.upload, 1);
});

test('skip() leaves open notebooks alone until a later run', async () => {
  const { root, remote, run } = setup();
  smallLibrary(root);
  const open = (rel) => rel.startsWith('Sem 1/Analysis/');
  const s1 = await run({ skip: open });
  assert.strictEqual(s1.uploaded, 1); // only Physik
  assert.strictEqual(s1.skipped, 4);
  const s2 = await run();
  assert.strictEqual(s2.uploaded, 4);
  // skipped files that are deleted locally are not removed remotely while skipped
  fs.rmSync(path.join(root, 'Sem 1/Analysis/source.pdf'));
  const s3 = await run({ skip: open });
  assert.strictEqual(s3.deletedRemote, 0);
  assert.ok(remote.byPath('Sem 1/Analysis/source.pdf'));
});

test('notebook.json is transferred last on upload and on download', async () => {
  const { root, remote, run } = setup();
  smallLibrary(root);
  await run();
  const ups = remote.order.filter((o) => o.startsWith('upload:'));
  const firstNb = ups.findIndex((o) => o.endsWith('notebook.json'));
  assert.ok(ups.slice(firstNb).every((o) => o.endsWith('notebook.json')), ups.join('\n'));

  const other = setup();
  other.remote.put('Z/notebook.json', '{}');
  other.remote.put('Z/pages/zzzzzz.json', '{}');
  other.remote.put('Z/assets/0123456789abcdef0123.png', 'p');
  await other.run();
  const downs = other.remote.order.filter((o) => o.startsWith('download:'));
  assert.strictEqual(downs[downs.length - 1], 'download:Z/notebook.json');
});

test('md5 cache avoids rehashing unchanged files', async () => {
  const { root, run } = setup();
  smallLibrary(root);
  const hashed = [];
  const hashFile = async (abs) => { hashed.push(abs); return md5File(abs); };
  await run({ hashFile });
  assert.strictEqual(hashed.length, 5); // first run: every file once
  hashed.length = 0;
  await run({ hashFile });
  assert.strictEqual(hashed.length, 0);
  edit(root, 'Physik/notebook.json', '{"changed":1}');
  await run({ hashFile });
  assert.deepStrictEqual(hashed, [path.join(root, 'Physik', 'notebook.json')]);
});

test('state is saved periodically during long runs', async () => {
  const { root, remote, statePath } = setup();
  for (let i = 0; i < 5; i++) write(root, `f${i}.json`, String(i));
  let calls = 0;
  const failing = Object.create(remote);
  failing.upload = async (...a) => { if (++calls === 4) throw Object.assign(new Error('boom'), { code: 'AUTH_REVOKED' }); return remote.upload(...a); };
  await assert.rejects(syncLibrary({ root, remote: failing, statePath, saveEveryMs: 0 }), /boom/);
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.strictEqual(Object.keys(saved.files).length, 3);
  // the rerun uploads only the remaining two
  const s = await syncLibrary({ root, remote, statePath });
  assert.strictEqual(s.uploaded, 2);
});

test('empty remote never mass-trashes the local library', async () => {
  const { root, remote, run, trashed } = setup();
  smallLibrary(root);
  await run();
  remote.files.clear();
  await assert.rejects(run(), (e) => e.code === 'MASS_DELETE');
  assert.strictEqual(trashed.length, 0);
});

test('missing library folder stops the sync before anything is deleted on Drive', async () => {
  const { root, remote, run } = setup();
  smallLibrary(root);
  await run();
  const before = remote.files.size;
  fs.rmSync(root, { recursive: true }); // e.g. external drive unplugged
  await assert.rejects(run(), (e) => e.code === 'NO_LIBRARY');
  assert.strictEqual(remote.files.size, before);
  assert.strictEqual(remote.calls.remove, 0);
});

test('empty local library never mass-removes files on Drive', async () => {
  const { root, remote, run } = setup();
  smallLibrary(root);
  await run();
  for (const e of fs.readdirSync(root)) fs.rmSync(path.join(root, e), { recursive: true });
  await assert.rejects(run(), (e) => e.code === 'MASS_DELETE');
  assert.strictEqual(remote.calls.remove, 0);
});

test('notebook opened during a sync is skipped at execution time too', async () => {
  const { root, remote, run } = setup();
  smallLibrary(root);
  await run();
  remote.put('Physik/pages/bbbbbb.json', '{"strokes":[1]}');
  let open = [];
  // The notebook gets opened right after planning (first progress callback).
  const res = await run({ skip: (rel) => open.some((nb) => rel.startsWith(nb + '/')), onProgress: () => { open = ['Physik']; } });
  assert.ok(!has(root, 'Physik/pages/bbbbbb.json'));
  assert.ok(res.skipped >= 1);
  const res2 = await run();
  assert.ok(has(root, 'Physik/pages/bbbbbb.json'));
  assert.strictEqual(res2.downloaded, 1);
});

test('case-insensitive systems: two Drive files differing only in case never fight over one local file', async () => {
  const { root, remote, run, trashed } = setup();
  remote.put('Bio/notebook.json', '{"title":"Bio","pages":[]}');
  remote.put('bio/notebook.json', '{"title":"bio","pages":[]}');
  await run({ caseInsensitive: true });
  assert.strictEqual(remote.calls.download, 1);
  await run({ caseInsensitive: true });
  assert.strictEqual(remote.calls.remove, 0);
  assert.strictEqual(trashed.length, 0);
  assert.strictEqual(remote.files.size, 2);
});

test('a new remote root resets state instead of deleting', async () => {
  const { root, remote, run, trashed } = setup();
  smallLibrary(root);
  await run();
  const fresh = new FakeRemote();
  fresh.rootId = 'root2';
  fresh.put('Other/notebook.json', '{}');
  const s = await run({ remote: fresh });
  assert.strictEqual(trashed.length, 0);
  assert.strictEqual(s.uploaded, 5);
  assert.strictEqual(s.downloaded, 1);
});

// ------------------------------------------------------------ GoogleAuth

function memStore(initial = null) {
  return { data: initial, async load() { return this.data; }, async save(o) { this.data = JSON.parse(JSON.stringify(o)); }, async clear() { this.data = null; } };
}
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

test('PKCE challenge is base64url(sha256(verifier)) and auth URL has all params', () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const expected = crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(challenge, expected);
  const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555', challenge, state: 'st' }));
  assert.strictEqual(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const p = Object.fromEntries(u.searchParams);
  assert.deepStrictEqual(p, {
    client_id: 'cid', redirect_uri: 'http://127.0.0.1:5555', response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file', code_challenge: challenge,
    code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state: 'st',
  });
});

test('signIn: loopback redirect, state check, code exchange with verifier, account via Drive about', async () => {
  const store = memStore();
  const seen = [];
  const fakeFetch = async (url, opts = {}) => {
    seen.push({ url, opts });
    if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    if (url.startsWith('https://www.googleapis.com/drive/v3/about')) return json({ user: { emailAddress: 'me@example.com', displayName: 'Me' } });
    throw new Error('unexpected ' + url);
  };
  let browserPage = '';
  let browserDone;
  const openExternal = (url) => { browserDone = browser(url); };
  const browser = async (url) => {
    const p = new URL(url).searchParams;
    const redirect = p.get('redirect_uri');
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+$/);
    // A stray request with a wrong state must not break the flow.
    await get(`${redirect}/?code=evil&state=wrong`);
    browserPage = await get(`${redirect}/?code=THECODE&state=${encodeURIComponent(p.get('state'))}`);
    browser.challenge = p.get('code_challenge');
  };
  const auth = new GoogleAuth({ clientId: 'cid', clientSecret: 'sec', tokenStore: store, openExternal, fetch: fakeFetch });
  const acct = await auth.signIn();
  assert.deepStrictEqual(acct, { email: 'me@example.com', name: 'Me' });
  await browserDone; // the fake browser finishes reading the page after signIn resolved
  assert.match(browserPage, /You can close this tab and return to StudyNotes/);

  const tokenCall = seen.find((s) => s.url.endsWith('/token'));
  const body = Object.fromEntries(new URLSearchParams(tokenCall.opts.body));
  assert.strictEqual(body.grant_type, 'authorization_code');
  assert.strictEqual(body.code, 'THECODE');
  assert.strictEqual(body.client_secret, 'sec');
  assert.match(body.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+$/);
  const ch = crypto.createHash('sha256').update(body.code_verifier).digest('base64url');
  assert.strictEqual(ch, browser.challenge);
  assert.strictEqual(store.data.refresh_token, 'RT');
  assert.strictEqual(await auth.isSignedIn(), true);
});

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(d)); }).on('error', reject);
  });
}

test('getAccessToken refreshes 60 s before expiry and keeps the refresh token', async () => {
  let t = 1_000_000;
  const store = memStore({ access_token: 'old', refresh_token: 'RT', expires_at: t + 120_000 });
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push(Object.fromEntries(new URLSearchParams(opts.body)));
    return json({ access_token: 'new' + calls.length, expires_in: 3600 });
  };
  const auth = new GoogleAuth({ clientId: 'cid', clientSecret: 's', tokenStore: store, fetch: fakeFetch, now: () => t });
  assert.strictEqual(await auth.getAccessToken(), 'old');      // 120 s left: still fine
  t += 61_000;                                                // 59 s left: refresh
  const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
  assert.strictEqual(a, 'new1'); assert.strictEqual(b, 'new1');
  assert.strictEqual(calls.length, 1, 'concurrent callers share one refresh');
  assert.deepStrictEqual(calls[0], { client_id: 'cid', grant_type: 'refresh_token', refresh_token: 'RT', client_secret: 's' });
  assert.strictEqual(store.data.refresh_token, 'RT');
  assert.strictEqual(store.data.expires_at, t + 3600_000);
});

test('revoked refresh token clears the store; signOut revokes and clears', async () => {
  const store = memStore({ access_token: 'a', refresh_token: 'RT', expires_at: 0 });
  const auth = new GoogleAuth({ clientId: 'c', tokenStore: store, fetch: async () => json({ error: 'invalid_grant' }, 400) });
  await assert.rejects(auth.getAccessToken(), (e) => e.code === 'AUTH_REVOKED');
  assert.strictEqual(store.data, null);
  await assert.rejects(auth.getAccessToken(), (e) => e.code === 'NOT_SIGNED_IN');

  const store2 = memStore({ access_token: 'a', refresh_token: 'RT2', expires_at: 0 });
  let revoked;
  const auth2 = new GoogleAuth({ clientId: 'c', tokenStore: store2, fetch: async (url, o) => { revoked = { url, body: o.body }; return new Response('', { status: 200 }); } });
  await auth2.signOut();
  assert.strictEqual(revoked.url, 'https://oauth2.googleapis.com/revoke');
  assert.strictEqual(revoked.body, 'token=RT2');
  assert.strictEqual(store2.data, null);
  assert.strictEqual(await auth2.isSignedIn(), false);
});

// ------------------------------------------------------------ DriveRemote (fake fetch)

test('appProperties path encoding splits long paths within the 124-byte limit', () => {
  const long = 'Semester ' + 'Ä'.repeat(150) + '/Notebook/pages/abcdef.json';
  const props = encodePath(long);
  for (const [k, v] of Object.entries(props)) assert.ok(Buffer.byteLength(k + v) <= 124, k);
  assert.strictEqual(decodePath(props), long);
  assert.deepStrictEqual(encodePath('a/b.json'), { snPath: 'a/b.json' });
});

test('DriveRemote: root + area folders, folder tree, paginated list, retry on 429/503 and 401 refresh', async () => {
  const api = new FakeDriveApi();
  const auth = { refreshed: 0, async getAccessToken({ force } = {}) { if (force) this.refreshed++; return this.refreshed ? 'T2' : 'T1'; } };
  const state = {};
  const remote = new DriveRemote({ auth, fetch: api.fetch, state, sleep: async () => {} });
  await remote.init();
  const root = api.files.get(state.rootId);
  assert.strictEqual(root.name, 'StudyNotes Library');
  const areaNames = api.live().filter((f) => f.parents.includes(root.id)).map((f) => f.name).sort();
  assert.deepStrictEqual(areaNames, ['Backups', 'PDF', 'Sync data (do not edit)']);

  // upload lands in real sub folders; 401 once -> refresh and retry
  api.fail.push({ match: (m, u) => u.pathname.startsWith('/upload/'), status: 401 });
  const up = await remote.upload('Sem 1/Analysis/pages/a.json', Buffer.from('HELLO'));
  assert.strictEqual(up.md5, md5('HELLO'));
  assert.strictEqual(auth.refreshed, 1);
  assert.strictEqual(api.folderPath(api.files.get(up.id).parents[0]), 'StudyNotes Library/Sync data (do not edit)/Sem 1/Analysis/pages');
  await remote.upload('Sem 1/Analysis/notebook.json', Buffer.from('{}'));
  // folders are reused, not duplicated
  assert.strictEqual(api.live().filter((f) => f.name === 'Analysis').length, 1);

  // list: transient 429 / 503 are retried, pagination works, other areas are not included
  for (let i = 0; i < 1100; i++) api._create({ name: 'x' + i, parents: [remote.areas.sync], appProperties: { snPath: 'many/x' + i, snRole: 'sync', snLib: state.rootId } }, Buffer.from('x'));
  await remote.putOutput('pdf', 'Sem 1/Analysis.pdf', Buffer.from('%PDF'));
  api.fail.push({ match: (m, u) => m === 'GET' && (u.searchParams.get('q') || '').includes("value='sync'"), status: 429 });
  api.fail.push({ match: (m, u) => m === 'GET' && (u.searchParams.get('q') || '').includes("value='sync'"), status: 503 });
  const files = await remote.list();
  assert.strictEqual(files.length, 1102);
  assert.ok(files.some((f) => f.path === 'Sem 1/Analysis/pages/a.json' && f.size === 5));
  assert.ok(!files.some((f) => f.path.endsWith('.pdf')));

  // a second remote (other PC) finds the same root and areas
  const other = new DriveRemote({ auth, fetch: api.fetch, state: {}, sleep: async () => {} });
  await other.init();
  assert.strictEqual(other.rootId, state.rootId);
  assert.deepStrictEqual(other.areas, remote.areas);
});

test('DriveRemote: 1.2 flat layout is moved into the sync folder, ids kept', async () => {
  const api = new FakeDriveApi();
  const auth = { async getAccessToken() { return 'T'; } };
  const root = api._create({ name: 'StudyNotes Library', mimeType: 'application/vnd.google-apps.folder', appProperties: { snRoot: '1' } });
  const old = api._create({ name: 'notebook.json', parents: [root.id], appProperties: { snPath: 'NB/notebook.json' } }, Buffer.from('{}'));
  const foreign = api._create({ name: 'mine.txt', parents: [root.id] }, Buffer.from('user file'));
  const remote = new DriveRemote({ auth, fetch: api.fetch, state: {}, sleep: async () => {} });
  const files = await remote.list();
  assert.deepStrictEqual(files.map((f) => [f.id, f.path]), [[old.id, 'NB/notebook.json']]);
  assert.strictEqual(api.folderPath(old.parents[0]), 'StudyNotes Library/Sync data (do not edit)/NB');
  assert.deepStrictEqual(foreign.parents, [root.id]); // not ours: untouched
});

test('DriveRemote: removing the last file trashes empty folders up to the area', async () => {
  const api = new FakeDriveApi();
  const remote = new DriveRemote({ auth: { async getAccessToken() { return 'T'; } }, fetch: api.fetch, state: {}, sleep: async () => {} });
  const a = await remote.upload('F/NB/pages/a.json', Buffer.from('a'));
  const b = await remote.upload('F/other.json', Buffer.from('b'));
  await remote.remove(a.id, 'F/NB/pages/a.json');
  await remote.cleanup();
  const names = api.live().map((f) => f.name);
  assert.ok(!names.includes('NB') && !names.includes('pages'));
  assert.ok(names.includes('F') && names.includes('other.json') && names.includes('Sync data (do not edit)'));
  assert.ok(b.id);
});

test('syncLibrary against DriveRemote + fake Drive API: two devices converge', async () => {
  const api = new FakeDriveApi();
  const auth = { async getAccessToken() { return 'T'; } };
  const mk = () => { const root = tmpdir(); return { root, statePath: path.join(tmpdir('sn-state-'), 's.json'), remote: new DriveRemote({ auth, fetch: api.fetch, state: {}, sleep: async () => {} }) }; };
  const A = mk(), B = mk();
  smallLibrary(A.root);
  const trash = async (abs) => fs.rmSync(abs);
  await syncLibrary({ ...A, trashLocal: trash });
  await syncLibrary({ ...B, trashLocal: trash });
  assert.strictEqual(read(B.root, 'Sem 1/Analysis/source.pdf'), '%PDF-1.4 fake');
  edit(B.root, 'Sem 1/Analysis/pages/aaaaaa.json', '{"strokes":[1]}');
  fs.rmSync(path.join(B.root, 'Physik'), { recursive: true });
  await syncLibrary({ ...B, trashLocal: trash });
  await syncLibrary({ ...A, trashLocal: trash });
  assert.strictEqual(read(A.root, 'Sem 1/Analysis/pages/aaaaaa.json'), '{"strokes":[1]}');
  assert.ok(!has(A.root, 'Physik/notebook.json'));
  await B.remote.cleanup();
  assert.ok(!api.live().some((f) => f.name === 'Physik'));
});

test('DriveRemote: large file goes through resumable upload in 8 MB chunks from disk', async () => {
  const file = path.join(tmpdir(), 'big.pdf');
  const size = 8 * 1024 * 1024 * 2 + 1234; // 3 chunks
  fs.writeFileSync(file, Buffer.alloc(size, 7));
  const auth = { async getAccessToken() { return 'T'; } };
  const ranges = [];
  let received = 0;
  let failedOnce = false;
  const fakeFetch = async (url, opts) => {
    const u = new URL(url);
    if (u.searchParams.get('uploadType') === 'resumable') {
      assert.strictEqual(opts.method, 'PATCH');
      assert.strictEqual(opts.headers['X-Upload-Content-Length'], String(size));
      return new Response(null, { status: 200, headers: { location: 'https://upload.example/session1' } });
    }
    assert.strictEqual(url, 'https://upload.example/session1');
    const cr = opts.headers['Content-Range'];
    ranges.push(cr);
    if (cr.startsWith('bytes */')) return new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
    // Simulate a dropped second chunk: server answers 503 once.
    if (received > 0 && !failedOnce) { failedOnce = true; return json({ error: { message: 'oops' } }, 503); }
    received += opts.body.length;
    if (received < size) return new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
    return json({ id: 'FILE', md5Checksum: 'abc' });
  };
  const remote = new DriveRemote({ auth, fetch: fakeFetch, sleep: async () => {} });
  remote.rootId = 'ROOT';
  remote.areas = { sync: 'S', pdf: 'P', backups: 'B' };
  const res = await remote.update('FILE', 'NB/source.pdf', file);
  assert.deepStrictEqual(res, { id: 'FILE', md5: 'abc' });
  assert.deepStrictEqual(ranges, [
    `bytes 0-8388607/${size}`, `bytes 8388608-16777215/${size}`, `bytes */${size}`,
    `bytes 8388608-16777215/${size}`, `bytes 16777216-${size - 1}/${size}`,
  ]);
});
