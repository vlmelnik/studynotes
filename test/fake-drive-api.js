'use strict';
// In-memory fake of the parts of the Google Drive v3 REST API that
// DriveRemote uses, as a `fetch` function. Understands the query grammar we
// send (terms joined by " and "), folders/parents, appProperties, multipart
// and resumable uploads, trash and pagination. Test-only.

const crypto = require('crypto');

const FOLDER = 'application/vnd.google-apps.folder';
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

function unquote(s) { return s.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\'); }

// "a and b and appProperties has { key='k' and value='v' }" -> predicate
function compile(qs) {
  const terms = [];
  const re = /appProperties has \{ key=('(?:[^'\\]|\\.)*') and value=('(?:[^'\\]|\\.)*') \}|('(?:[^'\\]|\\.)*') in parents|(name|mimeType) (=|!=) ('(?:[^'\\]|\\.)*')|trashed = (true|false)/g;
  let m;
  while ((m = re.exec(qs))) {
    if (m[1]) { const k = unquote(m[1]), v = unquote(m[2]); terms.push((f) => (f.appProperties || {})[k] === v); }
    else if (m[3]) { const p = unquote(m[3]); terms.push((f) => (f.parents || []).includes(p)); }
    else if (m[4]) { const field = m[4], neg = m[5] === '!=', v = unquote(m[6]); terms.push((f) => (f[field] === v) !== neg); }
    else if (m[7]) { const t = m[7] === 'true'; terms.push((f) => !!f.trashed === t); }
  }
  // Every " and "-separated top-level term must have been understood.
  const count = qs.replace(/\{[^}]*\}/g, '{}').split(' and ').length;
  if (count !== terms.length) throw new Error('fake drive: unsupported query ' + qs);
  return (f) => terms.every((t) => t(f));
}

function parseMultipart(body, contentType) {
  const boundary = /boundary=([^;]+)/.exec(contentType)[1];
  const buf = Buffer.from(body);
  const sep = Buffer.from(`--${boundary}\r\n`);
  const i1 = buf.indexOf(sep), i2 = buf.indexOf(sep, i1 + sep.length);
  const part1 = buf.subarray(i1 + sep.length, i2);
  const meta = JSON.parse(part1.subarray(part1.indexOf('\r\n\r\n') + 4).toString().replace(/\r\n$/, ''));
  const rest = buf.subarray(i2 + sep.length);
  const start = rest.indexOf('\r\n\r\n') + 4;
  const end = rest.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
  return { meta, bytes: Buffer.from(rest.subarray(start, end)) };
}

class FakeDriveApi {
  constructor() {
    this.files = new Map(); // id -> { id, name, mimeType, parents, appProperties, trashed, bytes, modifiedTime, createdTime }
    this.n = 0;
    this.sessions = new Map();
    this.calls = [];
    this.fail = []; // [{ match: (method, url) => bool, status }] consumed once
    this.fetch = this.fetch.bind(this);
  }

  _id() { return 'id' + ++this.n; }
  _stamp() { return new Date(Date.UTC(2026, 0, 1) + this.n * 1000).toISOString(); }
  _create(meta, bytes) {
    const id = this._id();
    const f = { id, name: meta.name, mimeType: meta.mimeType || 'application/octet-stream', parents: meta.parents || ['MYDRIVE'], appProperties: { ...(meta.appProperties || {}) }, trashed: false, bytes: bytes || null, createdTime: this._stamp(), modifiedTime: this._stamp() };
    this.files.set(id, f);
    return f;
  }
  _out(f, fields) {
    const o = { id: f.id, name: f.name, mimeType: f.mimeType, trashed: f.trashed, appProperties: f.appProperties, modifiedTime: f.modifiedTime, parents: f.parents };
    if (f.bytes) { o.md5Checksum = md5(f.bytes); o.size = String(f.bytes.length); }
    return o;
  }

  // helpers for tests
  byPath(p, role = 'sync') { return [...this.files.values()].find((f) => !f.trashed && f.appProperties.snRole === role && this.pathOf(f) === p); }
  pathOf(f) { let p = f.appProperties.snPath; if (p == null) return null; for (let i = 1; f.appProperties['snPath' + i] != null; i++) p += f.appProperties['snPath' + i]; return p; }
  folderPath(id) { const parts = []; let f = this.files.get(id); while (f) { parts.unshift(f.name); f = this.files.get(f.parents[0]); } return parts.join('/'); }
  live() { return [...this.files.values()].filter((f) => !f.trashed); }

  async fetch(url, opts = {}) {
    const method = opts.method || 'GET';
    const u = new URL(url);
    this.calls.push(`${method} ${u.pathname}`);
    const fi = this.fail.findIndex((x) => x.match(method, u));
    if (fi >= 0) { const [x] = this.fail.splice(fi, 1); return json({ error: { message: 'injected' } }, x.status); }

    if (u.host === 'upload.session') return this._chunk(u, opts);
    const m = /^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname);
    if (!m) throw new Error('fake drive: unexpected ' + url);
    const upload = !!m[1], id = m[2] && decodeURIComponent(m[2]);

    if (!upload && !id && method === 'GET') {
      const pred = compile(u.searchParams.get('q') || '');
      let list = [...this.files.values()].filter(pred);
      if (u.searchParams.get('orderBy') === 'createdTime') list.sort((a, b) => (a.createdTime < b.createdTime ? -1 : 1));
      const size = Number(u.searchParams.get('pageSize') || 100);
      const start = Number(u.searchParams.get('pageToken') || 0);
      const page = list.slice(start, start + size);
      return json({ files: page.map((f) => this._out(f)), ...(start + size < list.length ? { nextPageToken: String(start + size) } : {}) });
    }
    if (!upload && !id && method === 'POST') {
      return json(this._out(this._create(JSON.parse(opts.body))));
    }
    if (!upload && id && method === 'GET') {
      const f = this.files.get(id);
      if (!f) return json({ error: { message: 'not found' } }, 404);
      if (u.searchParams.get('alt') === 'media') return new Response(f.bytes);
      return json(this._out(f));
    }
    if (!upload && id && method === 'PATCH') {
      const f = this.files.get(id);
      if (!f) return json({ error: { message: 'not found' } }, 404);
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (body.trashed != null) f.trashed = body.trashed;
      if (body.appProperties) Object.assign(f.appProperties, body.appProperties);
      const add = u.searchParams.get('addParents'), rem = u.searchParams.get('removeParents');
      if (rem) f.parents = f.parents.filter((p) => p !== rem);
      if (add) f.parents.push(add);
      return json(this._out(f));
    }
    if (upload) {
      const type = u.searchParams.get('uploadType');
      if (type === 'multipart') {
        const { meta, bytes } = parseMultipart(opts.body, opts.headers['Content-Type']);
        return json(this._out(this._write(id, meta, bytes)));
      }
      if (type === 'resumable') {
        const sid = 's' + ++this.n;
        this.sessions.set(sid, { id, meta: JSON.parse(opts.body), size: Number(opts.headers['X-Upload-Content-Length']), chunks: [] });
        return new Response(null, { status: 200, headers: { location: `https://upload.session/${sid}` } });
      }
    }
    throw new Error(`fake drive: unexpected ${method} ${url}`);
  }

  _write(id, meta, bytes) {
    if (!id) return this._create(meta, bytes);
    const f = this.files.get(id);
    if (!f) throw new Error('fake drive: update of unknown file ' + id);
    f.bytes = bytes;
    f.modifiedTime = this._stamp();
    if (meta.appProperties) Object.assign(f.appProperties, meta.appProperties);
    if (meta.name) f.name = meta.name;
    return f;
  }

  _chunk(u, opts) {
    const s = this.sessions.get(u.pathname.slice(1));
    const have = s.chunks.reduce((n, c) => n + c.length, 0);
    const cr = opts.headers['Content-Range'];
    if (cr.startsWith('bytes */')) return new Response(null, { status: 308, headers: have ? { range: `bytes=0-${have - 1}` } : {} });
    s.chunks.push(Buffer.from(opts.body));
    const got = have + opts.body.length;
    if (got < s.size) return new Response(null, { status: 308, headers: { range: `bytes=0-${got - 1}` } });
    return json(this._out(this._write(s.id, s.meta, Buffer.concat(s.chunks))));
  }
}

module.exports = { FakeDriveApi, FOLDER };
