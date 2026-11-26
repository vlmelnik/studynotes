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
    // Only remember the bounds while the user moves or resizes; never set them back
    // during a resize (setBounds at a fractional display scale grows the window a
    // pixel each time – the "grows in small steps" bug). Snapping and docking
    // happen when a move ends.
    let t = null, endT = null;
    const remember = () => {
      clearTimeout(t);
      t = setTimeout(() => { if (!w.isDestroyed() && !this.moving) { this.o.config().readerBounds = w.getBounds(); this.o.save(); } }, 400);
    };
    const moveEnd = () => {
      if (w.isDestroyed() || this.moving) return;
      if (this.zone) { const side = this.zone; this.setZone(null); this.dock(this.state, this.split().ratio, side); return; }
      const b = w.getBounds();
      const snapped = snapBounds(b, screen.getDisplayMatching(b).workArea);
      if (snapped.x !== b.x || snapped.y !== b.y) w.setPosition(snapped.x, snapped.y);
      remember();
    };
    w.on('move', () => {
      if (this.moving) return;
      this.dropZone(w);
      remember();
      // 'moved' marks the end of a drag on Windows; elsewhere a short pause does
      if (process.platform !== 'win32') { clearTimeout(endT); endT = setTimeout(moveEnd, 350); }
    });
    w.on('moved', moveEnd);
    w.on('resize', remember);
    w.on('closed', () => { if (this.win === w) this.win = null; });
    w.loadURL('sn://app/index.html#sub=reader');
    w.webContents.once('did-finish-load', () => { if (this.state) w.webContents.send('reader:state', this.state); });
    w.once('ready-to-show', () => { if (show) w.showInactive(); });
    this.win = w;
    return w;
  }

  split() { return { ratio: 0.5, ...(this.o.config().readerSplit || {}) }; }

  // dragging the reader by its header to the left or right edge of the main window: a blue strip shows where it docks
  dropZone(w) {
    const main = this.o.main();
    if (!main || main.isMinimized() || !main.isVisible()) return this.setZone(null);
    const c = main.getContentBounds();
    const p = screen.getCursorScreenPoint();
    const inside = p.y >= c.y && p.y <= c.y + c.height && p.x >= c.x - 8 && p.x <= c.x + c.width + 8;
    const edge = 56;
    this.setZone(!inside ? null : p.x <= c.x + edge ? 'left' : p.x >= c.x + c.width - edge ? 'right' : null);
  }

  setZone(side) {
    if (this.zone === side) return;
    this.zone = side;
    const main = this.o.main();
    if (main && !main.isDestroyed()) main.webContents.send('reader:zone', side);
  }

  /** The reader window's renderer reports where it is (page, zoom), so a drag-dock keeps them. */
  report(state) { if (state) this.state = { ...this.state, ...state }; }

  /** A dialog in the main window: the reader steps behind it, then comes back on top. */
  yieldTo(on) {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (on) w.setAlwaysOnTop(false); else w.setAlwaysOnTop(true, 'floating');
    if (on) { const main = this.o.main(); if (main) main.moveTop(); }
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
    // the window pours into the edge: it narrows towards the side and fades while the pane opens from there
    main.webContents.send('reader:docked', { ...state, side });
    if (this.win && !this.win.isDestroyed() && !this.o.test) {
      this.moving = true;
      const w = this.win;
      w.setAlwaysOnTop(false);
      const from = w.getBounds();
      const narrow = { x: side === 'right' ? c.x + c.width - Math.round(to.width * 0.35) : c.x, y: to.y, width: Math.round(to.width * 0.35), height: to.height };
      const t0 = Date.now();
      await new Promise((resolve) => {
        const tick = () => {
          if (w.isDestroyed()) return resolve();
          const t = Math.min(1, (Date.now() - t0) / 300);
          const k = ease(t);
          w.setBounds({ x: Math.round(from.x + (narrow.x - from.x) * k), y: Math.round(from.y + (narrow.y - from.y) * k), width: Math.round(from.width + (narrow.width - from.width) * k), height: Math.round(from.height + (narrow.height - from.height) * k) });
          w.setOpacity(Math.max(0, 1 - k * 1.1));
          if (t < 1) setTimeout(tick, 12); else resolve();
        };
        tick();
      });
      this.moving = false;
    }
    main.focus();
    if (this.win && !this.win.isDestroyed()) this.win.close();
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
