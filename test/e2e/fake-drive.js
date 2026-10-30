'use strict';
// Test-only stand-in for Google Drive: a folder on disk with an index.json.
// Loaded by src/main/cloud.js only when STUDYNOTES_TEST and
// STUDYNOTES_FAKE_DRIVE are set. Same interface as DriveRemote.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FakeRemote {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  idx() { try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8')); } catch { return {}; } }
  save(i) { fs.writeFileSync(path.join(this.dir, 'index.json'), JSON.stringify(i, null, 1)); }
  async init() {}
  async list() {
    return Object.entries(this.idx()).filter(([, f]) => (f.role || 'sync') === 'sync').map(([id, f]) => ({ id, path: f.path, md5: f.md5, size: f.size, modifiedTime: f.modifiedTime }));
  }
  async listOutputs(role) {
    return Object.entries(this.idx()).filter(([, f]) => f.role === role).map(([id, f]) => ({ id, path: f.path, md5: f.md5, size: f.size, modifiedTime: f.modifiedTime, props: f.props || {} }));
  }
  async putOutput(role, p, data, { id = null, props = {} } = {}) {
    const res = this.put(id || 'o' + crypto.randomBytes(6).toString('hex'), p, data);
    const i = this.idx();
    i[res.id].role = role;
    i[res.id].props = props;
    this.save(i);
    return res;
  }
  put(id, p, data) {
    const bytes = Buffer.isBuffer(data) || data instanceof Uint8Array ? Buffer.from(data) : fs.readFileSync(data);
    fs.writeFileSync(path.join(this.dir, id), bytes);
    const i = this.idx();
    const md5 = crypto.createHash('md5').update(bytes).digest('hex');
    i[id] = { ...(i[id] || {}), path: p, md5, size: bytes.length, modifiedTime: new Date().toISOString() };
    this.save(i);
    return { id, md5 };
  }
  async upload(p, data) { return this.put('f' + crypto.randomBytes(6).toString('hex'), p, data); }
  async update(id, p, data) { return this.put(id, p, data); }
  async download(id) { return fs.readFileSync(path.join(this.dir, id)); }
  async remove(id) { const i = this.idx(); delete i[id]; this.save(i); fs.rmSync(path.join(this.dir, id), { force: true }); }
}

class FakeAuth {
  async isSignedIn() { return true; }
  async getAccount() { return { email: 'student@example.com', name: 'Test' }; }
  async signIn() { return this.getAccount(); }
  async signOut() {}
}

module.exports = { FakeRemote, FakeAuth };
