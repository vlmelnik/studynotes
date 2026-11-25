'use strict';
// The floating reference reader: a small always-on-top window with a PDF,
// and the smooth move between it and the docked pane in the main window.
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { clampBounds, defaultBounds, snapBounds } = require('../shared/overlay-bounds');

const ease = (t) => 1 - Math.pow(1 - t, 3);

/** Moves a window from its bounds to `to` in `ms`; resolves when done. */
function animate(w, to, ms = 260) {
  return new Promise((resolve) => {
    if (!w || w.isDestroyed()) return resolve();
    const from = w.getBounds();
    const t0 = Date.now();
    const tick = () => {
      if (w.isDestroyed()) return resolve();
      const t = Math.min(1, (Date.now() - t0) / ms);
      const k = ease(t);
      w.setBounds({
        x: Math.round(from.x + (to.x - from.x) * k), y: Math.round(from.y + (to.y - from.y) * k),
        width: Math.round(from.width + (to.width - from.width) * k), height: Math.round(from.height + (to.height - from.height) * k),
      });
      if (t < 1) setTimeout(tick, 12); else resolve();
    };
    tick();
  });
}

class ReaderWindow {
  /** opts: { main: () => BrowserWindow, config: () => object, save: () => void, test: bool } */
  constructor(opts) { this.o = opts; this.win = null; this.state = null; }

  displays() { return screen.getAllDisplays().map((d) => d.workArea); }

  bounds() {
    const saved = this.o.config().readerBounds;
    const main = this.o.main();
    const d = main ? screen.getDisplayMatching(main.getBounds()).workArea : screen.getPrimaryDisplay().workArea;
    return saved ? clampBounds(saved, this.displays()) : defaultBounds(d);
  }

  create(bounds, show = true) {
    const w = new BrowserWindow({
      ...bounds, frame: false, alwaysOnTop: true, skipTaskbar: false, minWidth: 240, minHeight: 180, show: false,
      title: 'StudyNotes – reader', backgroundColor: '#2a2b2f',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    w.setAlwaysOnTop(true, 'floating');
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    let t = null;
    const keep = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (w.isDestroyed() || this.moving) return;
        const b = w.getBounds();
        const d = screen.getDisplayMatching(b).workArea;
        const snapped = snapBounds(b, d);
        if (snapped.x !== b.x || snapped.y !== b.y) w.setBounds(snapped);
        this.o.config().readerBounds = snapped;
        this.o.save();
      }, 350);
    };
    w.on('move', keep);
    w.on('resize', keep);
    w.on('closed', () => { if (this.win === w) this.win = null; });
    w.loadURL('sn://app/index.html#sub=reader');
    w.webContents.once('did-finish-load', () => { if (this.state) w.webContents.send('reader:state', this.state); });
    w.once('ready-to-show', () => { if (show) w.showInactive(); });
    this.win = w;
    return w;
  }

  open(state) {
    this.state = state;
    if (this.win && !this.win.isDestroyed()) { this.win.webContents.send('reader:state', state); this.win.show(); this.win.focus(); return true; }
    this.create(this.bounds());
    return true;
  }

  /** From the floating window into the main window: it glides to the reader pane, then the pane takes over. */
  async dock(state, ratio = 0.5, side = 'right') {
    this.state = state;
    const main = this.o.main();
    if (!main) return false;
    const c = main.getContentBounds();
    const top = 52; // below the tool bar
    const w = Math.round(c.width * (1 - ratio));
    const to = { x: side === 'right' ? c.x + c.width - w : c.x, y: c.y + top, width: w, height: c.height - top };
    if (this.win && !this.win.isDestroyed() && !this.o.test) {
      this.moving = true;
      this.win.setAlwaysOnTop(false);
      await animate(this.win, to);
      this.moving = false;
    }
    main.webContents.send('reader:docked', state);
    main.focus();
    setTimeout(() => { if (this.win && !this.win.isDestroyed()) this.win.close(); }, this.o.test ? 0 : 140);
    return true;
  }

  /** From the docked pane (rect in the main window, CSS px) out into its own window, gliding to where it was last. */
  async undock(state, rect) {
    this.state = state;
    const main = this.o.main();
    const c = main.getContentBounds();
    const zoom = main.webContents.getZoomFactor ? main.webContents.getZoomFactor() : 1;
    const from = { x: Math.round(c.x + rect.x * zoom), y: Math.round(c.y + rect.y * zoom), width: Math.round(rect.width * zoom), height: Math.round(rect.height * zoom) };
    const to = this.bounds();
    if (this.win && !this.win.isDestroyed()) this.win.close();
    const w = this.create(from, false);
    await new Promise((r) => w.once('ready-to-show', r));
    w.showInactive();
    main.webContents.send('reader:undocked');
    if (!this.o.test) { this.moving = true; await animate(w, to); this.moving = false; } else w.setBounds(to);
    w.setAlwaysOnTop(true, 'floating');
    return true;
  }

  close() { if (this.win && !this.win.isDestroyed()) this.win.close(); }
}

module.exports = { ReaderWindow, animate };
