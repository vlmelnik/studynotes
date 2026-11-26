'use strict';
// Study session: StudyNotes steps aside, a small bar stays on top of every
// app, and the user collects material from the whole screen – selected or
// copied text and pictures, Ctrl + drag (a region), Alt + click (a window),
// Alt+S (the whole screen) and spoken notes. Ctrl+E pauses it (what was
// collected goes into the notebook's chat) and goes on with the same session;
// Finish hands everything to the main window to file it into the notebook.
const electron = require('electron');
const { BrowserWindow, globalShortcut, desktopCapturer, screen, nativeImage } = electron;
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { newSession, addItem, removeItem, summary } = require('../shared/capture-session');

// the clipboard (tests: a JSON file { text, image } – reading the X clipboard of a
// virtual display can block). Electron 44+ only has the async ClipboardItem API.
const fakeClip = process.env.STUDYNOTES_STUDY_FAKE_CLIPBOARD;
const clip = fakeClip ? {
  read() { try { return JSON.parse(fs.readFileSync(fakeClip, 'utf8')); } catch { return {}; } },
  async readText() { return this.read().text || ''; },
  async readImage() { const f = this.read().image; return f ? nativeImage.createFromPath(f) : nativeImage.createEmpty(); },
} : {
  // never fatal: a session must go on even when the clipboard cannot be read
  async readText() { try { return String(await electron.clipboard.readText() || ''); } catch { return ''; } },
  async readImage() {
    try {
      for (const item of await electron.clipboard.read()) {
        for (const type of item.types.filter((t) => /^image\//.test(t))) {
          const img = nativeImage.createFromBuffer(Buffer.from(await (await item.getType(type)).arrayBuffer()));
          if (!img.isEmpty()) return img;
        }
        // "Copy image" in some browsers: only HTML with the picture's address
        if (item.types.includes('text/html')) {
          const m = /<img[^>]+src="([^"]+)"/i.exec(await (await item.getType('text/html')).text());
          if (m) { const img = await fetchImage(m[1].replace(/&amp;/g, '&')); if (img && !img.isEmpty()) return img; }
        }
      }
    } catch { /* nothing readable */ }
    return nativeImage.createEmpty();
  },
  // what is on the clipboard (for the log when a picture is not collected)
  async types() { try { return (await electron.clipboard.read()).flatMap((i) => i.types); } catch { return []; } },
};

const imgCache = new Map();
async function fetchImage(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  let img = null;
  try {
    if (/^data:image\//.test(src)) img = nativeImage.createFromDataURL(src);
    else if (/^https?:/.test(src)) { const r = await electron.net.fetch(src); if (r.ok) img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer())); }
  } catch { img = null; }
  imgCache.set(src, img);
  return img;
}

// ---------- gestures all over Windows (scripts/study-hook.ps1) ----------
const { spawn } = require('child_process');
const HOOK = path.join(__dirname, 'scripts', 'study-hook.ps1');
function startHook(onLine, env = {}) {
  if (process.platform !== 'win32') return null;
  const b64 = Buffer.from(fs.readFileSync(HOOK, 'utf8'), 'utf16le').toString('base64');
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], { windowsHide: true, env: { ...process.env, ...env } });
  let buf = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (d) => { buf += d; for (let i; (i = buf.indexOf('\n')) >= 0;) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); } });
  ps.stderr.on('data', () => {});
  ps.on('error', () => {});
  ps.stdin.on('error', () => {});
  ps.say = (l) => { try { ps.stdin.write(l + '\n'); } catch { /* gone */ } };
  return ps;
}

// only while a session runs (not paused); Ctrl+E is registered by main.js for the whole app
const KEYS = { page: 'Alt+S' };

class Study {
  /** opts: { main: () => BrowserWindow, dir, settings: () => object, test } */
  constructor(opts) { this.o = opts; this.s = null; this.bar = null; this.n = 0; this.paused = false; this.sent = 0; }

  get active() { return !!this.s && !this.paused; }

  /** Ctrl+E: start (or go on with the paused session), or pause. */
  async toggle(opts = {}) {
    if (this.active) return this.pause();
    if (this.s) return this.resume();
    if (!opts.rel) return null;
    return this.start(opts);
  }

  webPrefs() { return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }; }

  async start({ topic = '', prompt = '', rel = '' } = {}) {
    if (this.s) return this.paused ? this.resume() : this.state();
    const id = 's' + Date.now().toString(36);
    this.s = { ...newSession({ id, topic, prompt, startedAt: Date.now() }), rel };
    this.sent = 0;
    this.folder = path.join(this.o.dir, id);
    await fsp.mkdir(this.folder, { recursive: true });
    const d = screen.getPrimaryDisplay().workArea;
    const w = 300, h = 44;
    this.bar = new BrowserWindow({ x: Math.round(d.x + (d.width - w) / 2), y: d.y + 8, width: w, height: h, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, transparent: true, hasShadow: false, title: 'StudyNotes – study session', webPreferences: this.webPrefs() });
    this.bar.setAlwaysOnTop(true, 'screen-saver');
    this.bar.setContentProtection(true); // never in its own screenshots
    this.bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.bar.webContents.on('will-navigate', (e) => e.preventDefault());
    this.bar.loadURL('sn://app/index.html#sub=study');
    this.bar.on('closed', () => { this.bar = null; });
    this.paused = true;
    return this.resume();
  }

  /** Goes on: the bar comes back, collecting starts again (the same session). */
  async resume() {
    if (!this.s) return null;
    this.paused = false;
    // what is on the clipboard now is not part of the session
    this.lastText = await clip.readText();
    this.lastImage = this.imageKey(await clip.readImage());
    clearInterval(this.watch);
    this.watch = null;
    // Windows: the hook says when the clipboard changes; elsewhere it is looked at twice a second
    if (this.o.test || process.platform !== 'win32') this.watch = setInterval(() => this.checkClipboard().catch(() => {}), 500);
    // (not in tests: on a virtual X display registering can block)
    if (!this.o.test) for (const [kind, key] of Object.entries(KEYS)) { try { globalShortcut.register(key, () => this.capture(kind)); } catch { /* taken by another app */ } }
    // drag to select / double-click: collected; Ctrl + drag: a region; Alt + click: a window
    if (!this.o.test) {
      if (!this.hook || this.hook.exitCode != null) {
        this.hookReady = false;
        this.hook = startHook((line) => this.gesture(line));
        // no hook (PowerShell blocked): look at the clipboard twice a second instead
        setTimeout(() => { if (!this.hookReady && this.active && !this.watch) this.watch = setInterval(() => this.checkClipboard().catch(() => {}), 500); }, 8000);
      } else this.hook.say('on');
    }
    if (this.hook) this.veil(); // ready for the first Ctrl + drag (only with the gesture hook)
    const bar = this.bar;
    if (bar && !bar.isDestroyed()) { if (bar.webContents.isLoading()) bar.once('ready-to-show', () => { if (!this.paused) bar.showInactive(); }); else bar.showInactive(); }
    this.push();
    const main = this.o.main();
    if (main && !this.o.test && main.isFocused()) main.minimize();
    return this.state();
  }

  /** Ctrl+E while collecting: everything stops but the session stays; what is new goes into the chat. */
  pause() {
    if (!this.active) return this.state();
    this.paused = true;
    this.quiet();
    if (this.bar && !this.bar.isDestroyed()) this.bar.hide();
    const fresh = this.s.items.slice(this.sent);
    this.sent = this.s.items.length;
    const main = this.o.main();
    if (main && !main.isDestroyed()) main.webContents.send('study:paused', { ...this.state(), rel: this.s.rel, fresh, folder: this.s.id });
    return this.state();
  }

  // collecting stops (pause and finish)
  quiet() {
    clearInterval(this.watch);
    this.watch = null;
    if (this.hook) this.hook.say('off');
    this.endLive();
    if (!this.o.test) for (const key of Object.values(KEYS)) { try { globalShortcut.unregister(key); } catch { /* not ours */ } }
  }

  state() {
    if (!this.s) return null;
    const sp = ((this.o.settings && this.o.settings()) || {}).speech || {};
    return { id: this.s.id, topic: this.s.topic, prompt: this.s.prompt, items: this.s.items, summary: summary(this.s, Date.now()), keys: KEYS, paused: this.paused, startedAt: this.s.startedAt, speech: sp };
  }

  push() { if (this.bar && !this.bar.isDestroyed()) this.bar.webContents.send('study:state', this.state()); }

  imageKey(img) { if (!img || img.isEmpty()) return ''; const s = img.getSize(); return `${s.width}x${s.height}:${crypto.createHash('sha1').update(img.toBitmap()).digest('hex')}`; }

  async keepImage(img) {
    const png = img.toPNG();
    const hash = crypto.createHash('sha1').update(png).digest('hex').slice(0, 20);
    const file = path.join(this.folder, hash + '.png');
    if (!fs.existsSync(file)) await fsp.writeFile(file, png);
    const { width, height } = img.getSize();
    return { hash, width, height };
  }

  async add(item) {
    if (!this.s) return;
    this.s = { ...addItem(this.s, { id: 'c' + (++this.n), at: Date.now(), ...item }), rel: this.s.rel };
    this.push();
  }

  async checkClipboard() {
    if (!this.active) return;
    if (this.checking) { this.again = true; return; }
    this.checking = true;
    try { do { this.again = false; await this.readClipboard(); } while (this.again && this.active); } finally { this.checking = false; }
  }

  async readClipboard() {
    let got = false;
    const text = await clip.readText();
    if (text && text !== this.lastText) { this.lastText = text; got = true; await this.add({ kind: 'text', text: text.slice(0, 20000) }); }
    const img = await clip.readImage();
    const key = this.imageKey(img);
    if (key && key !== this.lastImage) { this.lastImage = key; got = true; await this.add({ kind: 'region', image: await this.keepImage(img) }); }
    // nothing usable: what was there goes to a log (a picture a browser copies in a form we do not read yet)
    if (!got && !text && !key && clip.types && this.folder) {
      const types = (await clip.types()).join(',');
      if (types && types !== this.lastTypes) { this.lastTypes = types; fsp.appendFile(path.join(this.o.dir, 'clipboard.log'), `${new Date().toISOString()} ${types}\n`).catch(() => {}); }
    }
  }

  // the screen under the mouse as a picture (test: a fixed picture)
  async screenShot(at) {
    const d = screen.getDisplayNearestPoint(at || screen.getCursorScreenPoint());
    if (process.env.STUDYNOTES_STUDY_FAKE_SCREEN) return { img: nativeImage.createFromPath(process.env.STUDYNOTES_STUDY_FAKE_SCREEN), d };
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((x) => String(x.display_id) === String(d.id)) || sources[0];
    if (!src) throw new Error('The screen could not be captured.');
    return { img: src.thumbnail, d };
  }

  async capture(kind) {
    if (!this.s) return;
    try {
      // (the bar is not in screenshots: content protection; on systems without it, it steps aside)
      const hide = this.bar && !this.bar.isDestroyed() && process.platform !== 'win32';
      if (hide) { this.bar.hide(); await new Promise((r) => setTimeout(r, 120)); }
      const { img, d } = await this.screenShot();
      if (hide && !this.paused) this.bar.showInactive();
      if (kind === 'page') { await this.add({ kind: 'page', image: await this.keepImage(img) }); return; }
      // region: the screenshot full-screen, the user draws a rectangle
      const rect = await this.snip(img, d);
      if (rect) await this.addRegion(img, d, rect);
    } catch (err) {
      if (this.bar && !this.bar.isDestroyed()) { this.bar.showInactive(); this.bar.webContents.send('study:error', String(err.message || err)); }
    }
  }

  snip(img, d) {
    return new Promise((resolve) => {
      const w = new BrowserWindow({ ...d.bounds, frame: false, alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, resizable: false, movable: false, show: false, backgroundColor: '#000000', webPreferences: this.webPrefs() });
      w.setAlwaysOnTop(true, 'screen-saver');
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', (e) => e.preventDefault());
      this.snipDone = (rect) => { this.snipDone = null; if (!w.isDestroyed()) w.close(); resolve(rect); };
      w.on('closed', () => { if (this.snipDone) this.snipDone(null); });
      w.loadURL('sn://app/index.html#sub=snip');
      w.webContents.once('did-finish-load', () => { w.webContents.send('snip:image', img.toDataURL()); });
      w.once('ready-to-show', () => { w.show(); w.focus(); });
      this.snipWin = w;
    });
  }

  // a line from the hook: snip-start / snip-move / snip-end x y, window x y w h (physical pixels)
  gesture(line) {
    if (line === 'ready') { this.hookReady = true; return; }
    if (!this.active) return;
    const [what, xs, ys, ws, hs] = line.split(' ');
    if (what === 'clip') { setTimeout(() => this.checkClipboard().catch(() => {}), 60); return; }
    if (what === 'window') return this.takeRect({ x: Number(xs), y: Number(ys), width: Number(ws), height: Number(hs) }).catch((err) => this.error(err));
    if (!/^snip-/.test(what)) return;
    let pt = { x: Number(xs), y: Number(ys) };
    try { if (screen.screenToDipPoint) pt = screen.screenToDipPoint(pt); } catch { /* not Windows */ }
    if (what === 'snip-start') this.liveStart(pt);
    else if (what === 'snip-move') this.liveMove(pt);
    else this.liveEnd(pt);
  }

  // the dark veil for Ctrl + drag: made once, ready before the first drag (shown at once, never in screenshots)
  veil(d = screen.getPrimaryDisplay()) {
    let w = this.veilWin;
    if (!w || w.isDestroyed()) {
      w = this.veilWin = new BrowserWindow({ ...d.bounds, frame: false, transparent: true, focusable: false, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, show: false, alwaysOnTop: true, enableLargerThanScreen: true, webPreferences: this.webPrefs() });
      w.setAlwaysOnTop(true, 'screen-saver');
      w.setIgnoreMouseEvents(true);
      w.setContentProtection(true);
      w.loadURL('sn://app/index.html#sub=sniplive');
    }
    const b = w.getBounds();
    if (b.x !== d.bounds.x || b.y !== d.bounds.y || b.width !== d.bounds.width || b.height !== d.bounds.height) w.setBounds(d.bounds);
    return w;
  }

  liveStart(pt) {
    if (!this.active || this.live) return;
    const d = screen.getDisplayNearestPoint(pt);
    this.live = { d, a: pt, b: pt };
    const w = this.veil(d);
    w.webContents.send('snip:rect', null);
    w.showInactive();
  }

  liveMove(pt) {
    const live = this.live;
    if (!live) return;
    live.b = pt;
    const b = live.d.bounds;
    const r = { x: Math.min(live.a.x, pt.x) - b.x, y: Math.min(live.a.y, pt.y) - b.y, width: Math.abs(pt.x - live.a.x), height: Math.abs(pt.y - live.a.y) };
    if (this.veilWin && !this.veilWin.isDestroyed()) this.veilWin.webContents.send('snip:rect', r);
  }

  endLive() {
    this.live = null;
    if (this.veilWin && !this.veilWin.isDestroyed()) this.veilWin.hide();
  }

  async liveEnd(pt) {
    const live = this.live;
    if (!live) return;
    this.endLive();
    const b = live.d.bounds;
    const rect = { x: Math.min(live.a.x, pt.x) - b.x, y: Math.min(live.a.y, pt.y) - b.y, width: Math.abs(pt.x - live.a.x), height: Math.abs(pt.y - live.a.y) };
    if (rect.width < 6 || rect.height < 6) return;
    try {
      // taken after the drag: the veil and the bar are left out of the picture
      const shot = await this.screenShot({ x: live.a.x, y: live.a.y });
      await this.addRegion(shot.img, shot.d, rect);
    } catch (err) { this.error(err); }
  }

  // Alt + click: the window's rectangle on screen (physical pixels)
  async takeRect(px) {
    let r = px;
    try { if (screen.screenToDipRect) r = screen.screenToDipRect(null, px); } catch { /* not Windows */ }
    const shot = await this.screenShot({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const b = shot.d.bounds;
    const x = Math.max(b.x, r.x), y = Math.max(b.y, r.y);
    const rect = { x: x - b.x, y: y - b.y, width: Math.min(b.x + b.width, r.x + r.width) - x, height: Math.min(b.y + b.height, r.y + r.height) - y };
    if (rect.width < 6 || rect.height < 6) return;
    await this.addRegion(shot.img, shot.d, rect, 'window');
  }

  error(err) { if (this.bar && !this.bar.isDestroyed()) this.bar.webContents.send('study:error', String((err && err.message) || err)); }

  async addRegion(img, d, rect, kind = 'region') {
    const k = img.getSize().width / d.bounds.width;
    const crop = img.crop({ x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.max(1, Math.round(rect.width * k)), height: Math.max(1, Math.round(rect.height * k)) });
    await this.add({ kind, image: await this.keepImage(crop) });
  }

  async note(text) { if (String(text || '').trim()) await this.add({ kind: 'note', text: String(text).trim() }); }

  remove(id) { if (this.s) { this.s = { ...removeItem(this.s, id), rel: this.s.rel }; this.push(); } }

  image(hash) {
    const dir = (this.s && this.folder) || this.lastFolder;
    if (!/^[0-9a-f]{20}$/.test(String(hash)) || !dir) throw new Error('No such picture');
    return fsp.readFile(path.join(dir, hash + '.png'));
  }

  /** Ends the session: the bar goes, the main window comes back with the material. */
  finish(cancel = false) {
    if (!this.s) return null;
    this.quiet();
    if (this.hook) { try { this.hook.kill(); } catch { /* gone */ } this.hook = null; }
    if (this.veilWin && !this.veilWin.isDestroyed()) this.veilWin.close();
    this.veilWin = null;
    this.paused = false;
    const st = this.state();
    st.rel = this.s.rel;
    this.lastFolder = this.folder;
    this.s = null;
    if (this.bar && !this.bar.isDestroyed()) this.bar.close();
    const main = this.o.main();
    if (main) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); if (!cancel) main.webContents.send('study:done', st); }
    return st;
  }
}

module.exports = { Study, KEYS, startHook };
