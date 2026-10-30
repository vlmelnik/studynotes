'use strict';
// Google Drive sync service for the main process: wires drive.js (login +
// Drive API) and sync.js (two-way sync engine) to Electron, keeps the login
// encrypted with the OS keychain (safeStorage) and runs syncs one at a time.

const path = require('path');
const fsp = require('fs').promises;
const crypto = require('crypto');
const { GoogleAuth, DriveRemote } = require('./drive');
const { syncLibrary } = require('./sync');
const { publish } = require('./publish');
const { atomicWrite } = require('./library');
const BUILTIN = require('./google-client');

class CloudSync {
  /**
   * @param {object} o
   * @param {string} o.userData      app data folder (tokens + sync state live here)
   * @param {() => string} o.libraryRoot
   * @param {() => object} o.getConfig   { clientId, clientSecret } from settings
   * @param {object} o.electron      { safeStorage, shell, net }
   * @param {(status:object) => void} o.onStatus
   * @param {() => string[]} o.openNotebooks  library-relative paths open in the editor
   */
  constructor(o) {
    this.o = o;
    this.running = null;
    this.status = { state: 'off', last: null, message: '' };
    this.timer = null;
  }

  // ---------- token storage (encrypted) ----------
  tokenFile() { return path.join(this.o.userData, 'google-token.bin'); }

  tokenStore() {
    const { safeStorage } = this.o.electron;
    const file = this.tokenFile();
    return {
      load: async () => {
        try {
          const buf = await fsp.readFile(file);
          const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
          return JSON.parse(json);
        } catch { return null; }
      },
      save: async (obj) => {
        const json = JSON.stringify(obj);
        const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, data, { mode: 0o600 });
      },
      clear: async () => { await fsp.rm(file, { force: true }); },
    };
  }

  // Automated tests: a folder stands in for Google Drive (never in normal use).
  fake() {
    if (!process.env.STUDYNOTES_TEST || !process.env.STUDYNOTES_FAKE_DRIVE) return null;
    if (this._fake === undefined) {
      try {
        const { FakeRemote, FakeAuth } = require(path.join(__dirname, '..', '..', 'test', 'e2e', 'fake-drive.js'));
        this._fake = { auth: new FakeAuth(), remote: new FakeRemote(process.env.STUDYNOTES_FAKE_DRIVE) };
      } catch { this._fake = null; } // not shipped in the installed app
    }
    return this._fake;
  }

  auth() {
    if (this.fake()) return this.fake().auth;
    const cfg = this.config();
    const { shell, net } = this.o.electron;
    const key = `${cfg.clientId}|${cfg.clientSecret || ''}`;
    if (!this._auth || this._authKey !== key) {
      this._auth = new GoogleAuth({
        clientId: cfg.clientId.trim(),
        clientSecret: (cfg.clientSecret || '').trim(),
        tokenStore: this.tokenStore(),
        openExternal: (url) => shell.openExternal(url),
        fetch: (...a) => net.fetch(...a),
      });
      this._authKey = key;
      this._remote = null;
    }
    return this._auth;
  }

  // The user's own client from Settings, else the built-in StudyNotes client.
  config() {
    const cfg = this.o.getConfig() || {};
    let own = (cfg.clientId || '').trim();
    // Settings from 1.2/1.3 may hold the same client with an old secret: use the built-in one.
    if (own && own === BUILTIN.clientId) own = '';
    return { ...cfg, clientId: own || BUILTIN.clientId, clientSecret: own ? (cfg.clientSecret || '') : BUILTIN.clientSecret, own: !!own, auto: cfg.auto !== false };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.o.onStatus(this.status);
  }

  async info() {
    const cfg = this.config();
    let account = null;
    try { if ((cfg.clientId || this.fake()) && (await this.auth().isSignedIn())) account = await this.auth().getAccount(); } catch { /* not signed in */ }
    return { configured: !!cfg.clientId, ownClient: cfg.own, account, status: this.status, auto: cfg.auto };
  }

  async signIn() {
    const acc = await this.auth().signIn();
    this.setStatus({ state: 'idle', message: '' });
    this.schedule();
    return acc;
  }

  async signOut() {
    this.stopTimer();
    try { await this.auth().signOut(); } finally {
      this._remote = null;
      await fsp.rm(this.statePath(), { force: true });
      await fsp.rm(this.tokenFile(), { force: true }); // also when auth() failed (e.g. client ID removed)
      this.setStatus({ state: 'off', message: '', last: null });
    }
  }

  // Drop files from the sync state (see main.js: damaged pages after a crash).
  async forgetFiles(rels) {
    let state;
    try { state = JSON.parse(await fsp.readFile(this.statePath(), 'utf8')); } catch { return; }
    for (const r of rels) delete state.files[r];
    await atomicWrite(this.statePath(), JSON.stringify(state));
  }

  // State is per library folder: switching libraries never mixes them up.
  statePath() {
    const root = this.o.libraryRoot();
    const id = crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 32);
    return path.join(this.o.userData, `sync-state-${id}.json`);
  }

  remote() {
    if (this.fake()) return this.fake().remote;
    if (!this._remote) {
      const { net } = this.o.electron;
      this._remote = new DriveRemote({ auth: this.auth(), fetch: (...a) => net.fetch(...a) });
    }
    return this._remote;
  }

  // Run one sync (calls while one is running share it).
  // opts.publish = false: only the notes themselves (used when closing the app).
  // A call while a sync is running gets a fresh one right after it (that one
  // sees the files saved in the meantime, e.g. the last edits before closing).
  sync(opts = {}) {
    if (this.running) {
      this.nextOpts = opts;
      if (!this.next) {
        this.next = this.running.catch(() => {}).then(() => {
          this.next = null;
          return this.sync(this.nextOpts);
        });
      }
      return this.next;
    }
    this.running = this._sync(opts).finally(() => { this.running = null; });
    return this.running;
  }

  async signedIn() {
    const cfg = this.config();
    if (!cfg.clientId && !this.fake()) return false;
    try { return await this.auth().isSignedIn(); } catch { return false; }
  }

  async _sync({ publish: doPublish = true } = {}) {
    if (!(await this.signedIn())) return null;
    this.setStatus({ state: 'syncing', message: 'Syncing…', progress: null });
    const openNow = () => this.o.openNotebooks();
    const inOpen = (rel) => openNow().some((nb) => rel === nb || rel.startsWith(nb + '/'));
    try {
      const remote = this.remote();
      await remote.init();
      const summary = await syncLibrary({
        root: this.o.libraryRoot(),
        remote,
        statePath: this.statePath(),
        // Open notebooks were saved just before: their changes go up, but
        // nothing is written into them while they are open.
        uploadOnly: inOpen,
        trashLocal: (abs) => this.o.electron.shell.trashItem(abs),
        onProgress: (p) => {
          if (p && p.total) this.setStatus({ state: 'syncing', message: `Syncing ${Math.min(p.done + 1, p.total)} / ${p.total}…`, progress: { done: p.done, total: p.total } });
        },
      });
      if (remote.cleanup) await remote.cleanup().catch(() => {});
      let pub = null;
      if (doPublish && remote.listOutputs && this.o.publishDeps) {
        const state = JSON.parse(await fsp.readFile(this.statePath(), 'utf8'));
        pub = await publish({
          remote,
          stateFiles: state.files,
          ...this.o.publishDeps(),
          onProgress: (msg) => this.setStatus({ state: 'syncing', message: msg, progress: null }),
        }).catch((err) => ({ errors: [{ path: '', message: err.message }] }));
      }
      const n = summary.uploaded + summary.downloaded + summary.deletedLocal + summary.deletedRemote;
      const errors = (summary.errors || []).length + (pub ? pub.errors.length : 0);
      const parts = [];
      if (summary.conflicts.length) parts.push(`${summary.conflicts.length} conflict(s) – both versions kept`);
      parts.push(n ? `${n} change(s) synced` : 'Up to date');
      if (summary.deferred) parts.push('changes from the other PC arrive when you close the open notebook');
      if (errors) parts.push(`${errors} file(s) failed, will retry`);
      this.setStatus({ state: errors ? 'warning' : 'idle', last: Date.now(), message: parts.join(' · '), summary, progress: null });
      if (summary.downloaded || summary.deletedLocal) this.o.onLibraryChanged && this.o.onLibraryChanged();
      return summary;
    } catch (err) {
      const code = err.code || '';
      const message = code === 'AUTH_REVOKED' || code === 'NOT_SIGNED_IN' ? 'Signed out – please sign in to Google again'
        : code === 'MASS_DELETE' ? 'Stopped: one side looks empty, nothing was deleted. Check your library folder and Drive.'
          : code === 'NO_LIBRARY' ? 'Stopped: library folder not found (drive unplugged or folder moved?). Nothing was changed.'
            : `Sync failed: ${err.message}`;
      this.setStatus({ state: 'error', message, progress: null });
      return null;
    }
  }

  // Automatic sync every 15 minutes (and shortly after start). The app is
  // asked first, so it can save every open notebook before the sync runs.
  schedule() {
    this.stopTimer();
    if (!this.config().auto) return;
    const tick = () => (this.o.requestSync ? this.o.requestSync() : this.sync());
    this.timer = setInterval(tick, AUTO_MS);
    this._first = setTimeout(tick, 5000);
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    clearTimeout(this._first);
    this.timer = null;
  }
}

const AUTO_MS = 15 * 60 * 1000;

module.exports = { CloudSync };
