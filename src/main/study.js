'use strict';
// Study session: StudyNotes steps aside, a small bar stays on top of every
// app, and the user collects material from the whole screen – a region
// (Ctrl+Shift+1), a window (Ctrl+Shift+2), the whole screen (Ctrl+Shift+3),
// everything copied with Ctrl+C (text or pictures) and own notes. At the end
// the main window gets the session back to file it into the notebook.
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
        const type = item.types.find((t) => /^image\/(png|jpeg|bmp|webp|gif)$/.test(t));
        if (type) return nativeImage.createFromBuffer(Buffer.from(await (await item.getType(type)).arrayBuffer()));
      }
    } catch { /* nothing readable */ }
    return nativeImage.createEmpty();
  },
};

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
  return ps;
}

const KEYS = { region: 'CommandOrControl+Shift+1', window: 'CommandOrControl+Shift+2', page: 'CommandOrControl+Shift+3' };

class Study {
  /** opts: { main: () => BrowserWindow, dir, test } */
  constructor(opts) { this.o = opts; this.s = null; this.bar = null; this.n = 0; }

  get active() { return !!this.s; }

  webPrefs() { return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }; }

  async start({ topic = '', prompt = '', rel = '' } = {}) {
    if (this.s) return this.state();
    const id = 's' + Date.now().toString(36);
    this.s = { ...newSession({ id, topic, prompt, startedAt: Date.now() }), rel };
    this.folder = path.join(this.o.dir, id);
    await fsp.mkdir(this.folder, { recursive: true });
    // what is on the clipboard now is not part of the session
    this.lastText = await clip.readText();
    this.lastImage = this.imageKey(await clip.readImage());
    this.watch = setInterval(() => this.checkClipboard().catch(() => {}), 700);
    // (not in tests: on a virtual X display registering can block)
    if (!this.o.test) for (const [kind, key] of Object.entries(KEYS)) { try { globalShortcut.register(key, () => this.capture(kind)); } catch { /* taken by another app */ } }
    // drag to select / double-click: collected; Ctrl + drag: a region
    this.hook = this.o.test ? null : startHook((line) => this.gesture(line));
    const d = screen.getPrimaryDisplay().workArea;
    const w = 560, h = 56;
    this.bar = new BrowserWindow({ x: Math.round(d.x + (d.width - w) / 2), y: d.y + 10, width: w, height: h, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: false, show: false, transparent: false, backgroundColor: '#1f2023', title: 'StudyNotes – study session', webPreferences: this.webPrefs() });
    this.bar.setAlwaysOnTop(true, 'screen-saver');
    this.bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.bar.webContents.on('will-navigate', (e) => e.preventDefault());
    this.bar.loadURL('sn://app/index.html#sub=study');
    this.bar.once('ready-to-show', () => this.bar.showInactive());
    this.bar.on('closed', () => { this.bar = null; });
    const main = this.o.main();
    if (main && !this.o.test) main.minimize();
    return this.state();
  }

  state() { return this.s ? { id: this.s.id, topic: this.s.topic, prompt: this.s.prompt, items: this.s.items, summary: summary(this.s, Date.now()), keys: KEYS } : null; }

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
    if (!this.s || this.checking) return;
    this.checking = true;
    try { await this.readClipboard(); } finally { this.checking = false; }
  }

  async readClipboard() {
    const text = await clip.readText();
    if (text && text !== this.lastText) { this.lastText = text; await this.add({ kind: 'text', text: text.slice(0, 20000) }); return; }
    const img = await clip.readImage();
    const key = this.imageKey(img);
    if (key && key !== this.lastImage) { this.lastImage = key; await this.add({ kind: 'region', image: await this.keepImage(img) }); }
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
      if (kind === 'window') { if (this.bar) { this.bar.webContents.send('study:pickWindow'); this.bar.focus(); } return; }
      if (this.bar) this.bar.hide();
      await new Promise((r) => setTimeout(r, 120)); // the bar is gone from the picture
      const { img, d } = await this.screenShot();
      if (this.bar && !this.bar.isDestroyed()) this.bar.showInactive();
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

  // a line from the hook: snip-start / snip-move / snip-end x y (physical pixels)
  gesture(line) {
    const [what, xs, ys] = line.split(' ');
    if (!/^snip-/.test(what)) return;
    let pt = { x: Number(xs), y: Number(ys) };
    try { if (screen.screenToDipPoint) pt = screen.screenToDipPoint(pt); } catch { /* not Windows */ }
    if (what === 'snip-start') this.liveStart(pt);
    else if (what === 'snip-move') this.liveMove(pt);
    else this.liveEnd(pt);
  }

  // Ctrl + drag: the screen is taken at once, a dark veil shows the rectangle while dragging
  liveStart(pt) {
    if (!this.s || this.live) return;
    const d = screen.getDisplayNearestPoint(pt);
    const live = this.live = { d, a: pt, b: pt, shot: this.screenShot(pt).catch(() => null) };
    const w = new BrowserWindow({ ...d.bounds, frame: false, transparent: true, focusable: false, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, show: false, alwaysOnTop: true, webPreferences: this.webPrefs() });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true);
    w.loadURL('sn://app/index.html#sub=sniplive');
    w.once('ready-to-show', () => { if (this.live === live) w.showInactive(); });
    live.win = w;
  }

  liveMove(pt) {
    const live = this.live;
    if (!live) return;
    live.b = pt;
    const b = live.d.bounds;
    const r = { x: Math.min(live.a.x, pt.x) - b.x, y: Math.min(live.a.y, pt.y) - b.y, width: Math.abs(pt.x - live.a.x), height: Math.abs(pt.y - live.a.y) };
    if (live.win && !live.win.isDestroyed()) live.win.webContents.send('snip:rect', r);
  }

  async liveEnd(pt) {
    const live = this.live;
    if (!live) return;
    this.live = null;
    this.liveMove(pt);
    if (live.win && !live.win.isDestroyed()) live.win.close();
    const b = live.d.bounds;
    const rect = { x: Math.min(live.a.x, pt.x) - b.x, y: Math.min(live.a.y, pt.y) - b.y, width: Math.abs(pt.x - live.a.x), height: Math.abs(pt.y - live.a.y) };
    if (rect.width < 6 || rect.height < 6) return;
    const shot = await live.shot;
    if (!shot) return;
    await this.addRegion(shot.img, shot.d, rect);
  }

  async addRegion(img, d, rect) {
    const k = img.getSize().width / d.bounds.width;
    const crop = img.crop({ x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.max(1, Math.round(rect.width * k)), height: Math.max(1, Math.round(rect.height * k)) });
    await this.add({ kind: 'region', image: await this.keepImage(crop) });
  }

  async windows() {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 200 } });
    this.winSources = sources.filter((x) => !/^StudyNotes/.test(x.name));
    return this.winSources.map((x) => ({ id: x.id, name: x.name, thumb: x.thumbnail.toDataURL() }));
  }

  async takeWindow(id) {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 2560, height: 1600 } });
    const src = sources.find((x) => x.id === id);
    if (!src) throw new Error('That window is gone.');
    await this.add({ kind: 'window', title: src.name, image: await this.keepImage(src.thumbnail) });
  }

  async note(text) { if (String(text || '').trim()) await this.add({ kind: 'note', text: String(text).trim() }); }

  remove(id) { if (this.s) { this.s = { ...removeItem(this.s, id), rel: this.s.rel }; this.push(); } }

  image(hash) {
    if (!/^[0-9a-f]{20}$/.test(String(hash)) || !this.lastFolder) throw new Error('No such picture');
    return fsp.readFile(path.join(this.lastFolder, hash + '.png'));
  }

  /** Ends the session: the bar goes, the main window comes back with the material. */
  finish(cancel = false) {
    if (!this.s) return null;
    clearInterval(this.watch);
    if (this.hook) { try { this.hook.kill(); } catch { /* gone */ } this.hook = null; }
    if (this.live && this.live.win && !this.live.win.isDestroyed()) this.live.win.close();
    this.live = null;
    if (!this.o.test) for (const key of Object.values(KEYS)) { try { globalShortcut.unregister(key); } catch { /* not ours */ } }
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
