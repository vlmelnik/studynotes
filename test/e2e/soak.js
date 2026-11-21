// Long use: does anything grow without bound? The user saw zoom, scrolling
// and drawing slow down after the app had been open for a long time (fine
// again after a restart). This repeats what a study session does – scroll,
// zoom with Ctrl+wheel, draw, undo, switch notebooks – many times and prints
// after every round what the renderer holds: JS heap, DOM nodes, canvases
// (and their pixels), event listeners, timers / animation frames that run.
// The checks at the end guard against the leak found with it (2026-11): a
// closed notebook stayed in memory with all its pages and canvases, because
// a screen-density listener of its viewer was never removed.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/soak.js
//        ROUNDS=12 (default 4), CLOSE=0 keeps the notebooks open between rounds,
//        SNAP=<file> saves a heap snapshot (see heap-retainers.js)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { launch, root } = require('./harness/app');
const { check, errors, finish } = require('./harness/report');

const ROUNDS = Number(process.env.ROUNDS || 4);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-soak-'));
  const pdf = path.join(tmp, 'Lecture.pdf');
  execFileSync('node', [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '60'], { stdio: 'ignore' });
  const { app, win, ed } = await launch({ tmp });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Performance.enable');

  // counting wrappers: timers, intervals, animation frames, listeners added and removed
  await ed(() => {
    const c = window.__soak = { timeouts: 0, intervals: 0, liveIntervals: new Set(), raf: 0, addL: 0, remL: 0, canvases: new Set() };
    const st = window.setTimeout, si = window.setInterval, ci = window.clearInterval, ra = window.requestAnimationFrame;
    window.setTimeout = function (...a) { c.timeouts++; return st.apply(this, a); };
    window.setInterval = function (...a) { c.intervals++; const id = si.apply(this, a); c.liveIntervals.add(id); return id; };
    window.clearInterval = function (id) { c.liveIntervals.delete(id); return ci.call(this, id); };
    window.requestAnimationFrame = function (...a) { c.raf++; return ra.apply(this, a); };
    const ael = EventTarget.prototype.addEventListener, rel = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (...a) { c.addL++; return ael.apply(this, a); };
    EventTarget.prototype.removeEventListener = function (...a) { c.remL++; return rel.apply(this, a); };
    // every canvas ever created (WeakRef: does not keep it alive)
    const ce = Document.prototype.createElement;
    c.refs = [];
    Document.prototype.createElement = function (tag, ...a) { const el = ce.call(this, tag, ...a); if (String(tag).toLowerCase() === 'canvas') c.refs.push(new WeakRef(el)); return el; };
  });

  const rels = [];
  rels.push(await ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf));
  rels.push(await ed(async () => (await window.api.createNotebook('', { title: 'Notes', paper: 'lined', pageCount: 8 })).rel || null));
  const open = async (r) => { await ed((x) => window.__app.openNotebook(x), r); await win.waitForTimeout(700); };
  const notesRel = rels[1] || (await ed(() => { const t = window.__app.tabs || []; return null; }));

  const pen = async (x0, y0) => {
    const base = { pointerType: 'pen', button: 'left', clickCount: 1 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, force: 0.5, buttons: 1, ...base });
    for (let i = 1; i <= 40; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + i * 5, y: y0 + Math.sin(i / 4) * 12, force: 0.5, buttons: 1, ...base });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 200, y: y0, buttons: 0, ...base });
  };

  const measure = async () => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await win.waitForTimeout(300);
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const r = await ed(() => {
      const c = window.__soak;
      const live = c.refs.map((w) => w.deref()).filter(Boolean);
      const inDom = live.filter((el) => el.isConnected);
      const px = (list) => list.reduce((s, el) => s + el.width * el.height, 0);
      const ed = window.__app.active;
      const v = ed && ed.viewer;
      return {
        canvasesAlive: live.length, canvasesInDom: inDom.length,
        mpxAlive: +(px(live) / 1e6).toFixed(1), mpxDetached: +(px(live.filter((el) => !el.isConnected)) / 1e6).toFixed(1),
        listenersNet: c.addL - c.remL, liveIntervals: c.liveIntervals.size, raf: c.raf, timeouts: c.timeouts,
        cacheMpx: v && v.cache ? +(v.cache.used / 1e6).toFixed(1) : null, views: v && v.views ? v.views.size : null,
        undo: ed && ed.history ? (ed.history.undo || ed.history.stack || []).length : null,
        editors: (window.__app.editors || window.__app.tabs || []).length,
      };
    });
    const mem = await app.evaluate(({ app }) => app.getAppMetrics().filter((p) => p.type === 'Tab' || p.type === 'Renderer').map((p) => Math.round(p.memory.workingSetSize / 1024)));
    const count = async (expr) => {
      try {
        const { result } = await cdp.send('Runtime.evaluate', { expression: expr, objectGroup: 'soak' });
        if (!result.objectId) return null;
        const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId, objectGroup: 'soak' });
        const { result: n } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
        await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'soak' }).catch(() => {});
        return n.value;
      } catch { return null; }
    };
    const inst = {
      Editors: await count('window.__soakProto.editor'), PageViews: await count('window.__soakProto.view'),
      PdfDocs: await count('window.__soakProto.pdf'), Path2Ds: await count('Path2D.prototype'),
      Canvases: await count('HTMLCanvasElement.prototype'), ImageBitmaps: await count('ImageBitmap.prototype'),
    };
    return { heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1), nodes: m.Nodes, docs: m.Documents, jsListeners: m.JSEventListeners, rendererMB: mem.join('/'), ...r, ...inst };
  };

  const timeStep = async () => ed(async () => {
    // time for 20 scroll steps + 10 zoom steps on the active notebook (ms per step)
    const v = window.__app.active.viewer, s = v.scroller;
    const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
    let t = performance.now();
    for (let i = 0; i < 20; i++) { s.scrollTop += 300; await frame(); }
    const scroll = (performance.now() - t) / 20;
    t = performance.now();
    for (let i = 0; i < 10; i++) { v.setZoom(v.zoom * (i % 2 ? 1 / 1.15 : 1.15)); await frame(); }
    return { scrollMs: +scroll.toFixed(1), zoomMs: +((performance.now() - t) / 10).toFixed(1) };
  });

  const rows = [];
  for (let round = 0; round <= ROUNDS; round++) {
    if (round > 0) {
      // a stretch of study: read the lecture, zoom, take notes, switch, back
      await open(rels[0]);
      const box = await ed(() => { const r = window.__app.active.viewer.scroller.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await win.mouse.move(box.x, box.y);
      for (let i = 0; i < 15; i++) { await win.mouse.wheel(0, 900); await win.waitForTimeout(40); }
      await win.keyboard.down('Control');
      for (let i = 0; i < 8; i++) { await win.mouse.wheel(0, i < 4 ? -120 : 120); await win.waitForTimeout(60); }
      await win.keyboard.up('Control');
      // deep zoom on a corner and back (smooth zoom passes many zoom levels)
      await win.keyboard.down('Control');
      for (let i = 0; i < 12; i++) { await win.mouse.wheel(0, -240); await win.waitForTimeout(30); }
      await win.waitForTimeout(400);
      for (let i = 0; i < 12; i++) { await win.mouse.wheel(0, 240); await win.waitForTimeout(30); }
      await win.keyboard.up('Control');
      for (let i = 0; i < 15; i++) { await win.mouse.wheel(0, -900); await win.waitForTimeout(40); }
      await win.keyboard.press('p');
      for (let k = 0; k < 4; k++) await pen(box.x - 150, box.y - 120 + k * 40);
      await win.keyboard.press('Control+z');
      if (rels[1]) {
        await open(rels[1]);
        await win.keyboard.press('p');
        for (let k = 0; k < 4; k++) await pen(box.x - 150, box.y - 120 + k * 40);
      }
      // close both notebooks (Ctrl+W) as one does between lectures
      if (process.env.CLOSE !== '0') { for (let k = 0; k < 2; k++) { await win.keyboard.press('Control+w'); await win.waitForTimeout(400); } }
      await win.waitForTimeout(500);
    }
    await open(rels[0]);
    await ed(() => { const e = window.__app.active; const v = e.viewer; const pv = v.views.values().next().value;
      window.__soakProto = window.__soakProto || {};
      window.__soakProto.editor = Object.getPrototypeOf(e); if (pv) window.__soakProto.view = Object.getPrototypeOf(pv);
      const pdf = e.doc.pdfs.get('main'); if (pdf) window.__soakProto.pdf = Object.getPrototypeOf(pdf); });
    const t = await timeStep();
    const m = await measure();
    rows.push({ round, ...t, ...m });
    console.log(JSON.stringify({ round, ...t, ...m }));
  }
  // SNAP=<file>: a heap snapshot at the end, for the retainer analysis
  // (scripts: node test/e2e/heap-retainers.js <file> Editor)
  if (process.env.SNAP) {
    const chunks = [];
    cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    fs.writeFileSync(process.env.SNAP, chunks.join(''));
  }
  const first = rows[1] || rows[0], last = rows[rows.length - 1];
  console.log('GROWTH (round 1 → last): ' + Object.keys(last).filter((k) => typeof last[k] === 'number' && typeof first[k] === 'number' && k !== 'round')
    .map((k) => `${k} ${first[k]} → ${last[k]}`).join(', '));
  if (ROUNDS >= 3) {
    // (round 1 still warms up caches; compare with it, not with the fresh start)
    check('closed notebooks are freed: one editor alive', last.Editors === 1, `editors alive: ${rows.map((r) => r.Editors).join(' ')}`);
    check('canvases do not pile up', last.Canvases <= first.Canvases * 1.3 + 10, `canvases: ${rows.map((r) => r.Canvases).join(' ')}`);
    check('JS heap stays flat', last.heapMB <= first.heapMB + 6, `heap MB: ${rows.map((r) => r.heapMB).join(' ')}`);
    check('DOM nodes stay flat', last.nodes <= first.nodes * 1.2 + 50, `nodes: ${rows.map((r) => r.nodes).join(' ')}`);
  }
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
