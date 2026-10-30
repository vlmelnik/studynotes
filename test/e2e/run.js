// End-to-end test: launches the real app (under xvfb on Linux), imports a
// large PDF, writes with a simulated pen, uses every tool, checks persistence,
// export and performance. Screenshots go to test/out/.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/run.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = require('assert');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, { recursive: true });

const results = [];
let metricsApp = null;
async function mem(label) {
  if (!metricsApp) return;
  try {
    const m = await metricsApp.evaluate(({ app }) => app.getAppMetrics().map((p) => `${p.type}:${Math.round(p.memory.workingSetSize / 1024)}MB`).join(' '));
    console.log(`      [mem ${label}] ${m}`);
  } catch { /* app gone */ }
}
function check(name, ok, info = '') {
  mem(name);
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-e2e-'));
  const libDir = path.join(tmp, 'Library');
  const userData = path.join(tmp, 'userdata');
  const bigPdf = path.join(tmp, 'Halbleiter Skript.pdf');
  execFileSync('node', [path.join(root, 'scripts', 'make-test-pdf.js'), bigPdf, '600'], { stdio: 'inherit' });

  const launch = () => electron.launch({
    // STUDYNOTES_EXE: run a packaged build instead of the dev sources.
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: process.env.STUDYNOTES_EXE ? ['--no-sandbox'] : [root, '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: libDir, STUDYNOTES_USERDATA: userData },
  });

  let app = await launch();
  metricsApp = app;
  let win = await app.firstWindow();
  win.on('crash', () => console.log('!!! renderer crashed'));
  const errors = [];
  const watch = (w) => {
    w.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    w.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };
  watch(win);
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  await win.screenshot({ path: path.join(out, '01-library-empty.png') });
  check('app starts and shows library', true);

  // ---------- import & open the 600-page PDF ----------
  let t0 = Date.now();
  const rel = await win.evaluate(async (file) => (await window.api.importFiles('', [file]))[0], bigPdf);
  await win.evaluate((r) => window.__app.openNotebook(r), rel);
  await win.waitForFunction(() => document.querySelector('.page .bg-canvas'), null, { timeout: 60000 });
  const openMs = Date.now() - t0;
  check('import + open 600-page PDF', true, `${openMs} ms until first page visible`);
  const pageCount = await win.evaluate(() => window.__app.active.pages.length);
  check('all 600 pages listed', pageCount === 600, `${pageCount}`);
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(out, '02-editor-pdf.png') });

  // ---------- scroll performance ----------
  const perf = await win.evaluate(async () => {
    const ed = window.__app.active;
    const v = ed.viewer;
    const sc = v.scroller;
    const frames = [];
    let last = performance.now();
    let running = true;
    const tick = (t) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    // Smooth-scroll through 60 pages.
    const target = v.layout[60].y;
    const startT = performance.now();
    await new Promise((res) => {
      const step = () => {
        sc.scrollTop += 120;
        if (sc.scrollTop < target) requestAnimationFrame(step); else res();
      };
      step();
    });
    const scrollMs = performance.now() - startT;
    running = false;
    frames.sort((a, b) => a - b);
    const p95 = frames[Math.floor(frames.length * 0.95)];
    const domPages = document.querySelectorAll('.page').length;
    return { frames: frames.length, p95, scrollMs, domPages };
  });
  check('scrolling stays smooth (p95 frame time < 50 ms)', perf.p95 < 50, `p95=${perf.p95.toFixed(1)} ms over ${perf.frames} frames`);
  check('virtualisation: few page nodes in DOM', perf.domPages < 16, `${perf.domPages} page elements for 600 pages`);

  // Jump far and measure time until that page is sharp.
  t0 = Date.now();
  await win.evaluate(() => window.__app.active.viewer.scrollToPage(450));
  await win.waitForFunction(() => {
    const v = window.__app.active.viewer;
    const pv = v.view(450);
    return pv && pv.bgScale > 0 && pv.bgScale >= pv.targetScale() * 0.97;
  }, null, { timeout: 30000 });
  check('jump to page 451 renders quickly', Date.now() - t0 < 3000, `${Date.now() - t0} ms`);

  const mem = await win.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1));
  const cacheMpx = await win.evaluate(() => Math.round(window.__app.active.viewer.cache.used / 1e6));
  check('bitmap cache bounded', cacheMpx <= 72, `${cacheMpx} Mpx cached, JS heap ${mem} MB`);

  // ---------- zoom ----------
  await win.evaluate(() => window.__app.active.viewer.scrollToPage(2));
  await win.waitForTimeout(300);
  const vbox = await win.locator('.viewer').boundingBox();
  await win.mouse.move(vbox.x + vbox.width / 2, vbox.y + 300);
  await win.keyboard.down('Control');
  for (let i = 0; i < 5; i++) { await win.mouse.wheel(0, -100); await win.waitForTimeout(30); }
  await win.keyboard.up('Control');
  await win.waitForTimeout(700);
  const zoomInfo = await win.evaluate(() => {
    const v = window.__app.active.viewer;
    const pv = v.view(v.currentIndex);
    return { zoom: v.zoom, sharp: pv.bgScale >= pv.targetScale() * 0.97 };
  });
  check('ctrl+wheel zoom and sharp re-render', zoomInfo.zoom > 1.2 && zoomInfo.sharp, `zoom ${(zoomInfo.zoom * 100).toFixed(0)}%`);
  await win.screenshot({ path: path.join(out, '03-zoomed.png') });
  await win.keyboard.press('Control+0');
  await win.waitForTimeout(400);

  // ---------- pen with pressure via CDP ----------
  const cdp = await win.context().newCDPSession(win);
  const pageRect = async (i) => win.evaluate((idx) => window.__app.active.viewer.pageClientRect(idx), i);
  await win.evaluate(() => window.__app.active.viewer.scrollToPage(0));
  await win.waitForTimeout(300);
  let r = await pageRect(0);
  async function penStroke(points, opts = {}) {
    const type = opts.pointerType || 'pen';
    const base = { pointerType: type, button: 'left', clickCount: 1 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: points[0][0], y: points[0][1], force: points[0][2] ?? 0.5, buttons: 1, ...base });
    for (const [x, y, f] of points.slice(1)) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, force: f ?? 0.5, buttons: 1, ...base });
    }
    if (opts.holdMs) await win.waitForTimeout(opts.holdMs);
    const lastP = points[points.length - 1];
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: lastP[0], y: lastP[1], buttons: 0, ...base });
  }
  // Handwriting-ish wave with varying pressure
  const wave = [];
  for (let i = 0; i <= 80; i++) wave.push([r.left + 80 + i * 4, r.top + 160 + Math.sin(i / 5) * 18, 0.2 + 0.7 * Math.abs(Math.sin(i / 13))]);
  await penStroke(wave);
  const strokes1 = await win.evaluate(() => {
    const ed = window.__app.active;
    return ed.pageData(ed.pages[0].id).strokes;
  });
  check('pen stroke recorded with pressure', strokes1.length === 1 && !strokes1[0].np, `${strokes1[0] && strokes1[0].p.length / 3} points`);

  // Highlighter (straight line) over text line
  await win.keyboard.press('h');
  await penStroke([[r.left + 50, r.top + 112], [r.left + 200, r.top + 114], [r.left + 400, r.top + 113]]);
  // Draw & hold → rectangle
  await win.keyboard.press('p');
  const rectPts = [];
  const rx = r.left + 120, ry = r.top + 260, rw = 160, rh = 90;
  for (let i = 0; i <= 20; i++) rectPts.push([rx + (rw * i) / 20, ry + Math.random() * 2]);
  for (let i = 0; i <= 15; i++) rectPts.push([rx + rw + Math.random() * 2, ry + (rh * i) / 15]);
  for (let i = 0; i <= 20; i++) rectPts.push([rx + rw - (rw * i) / 20, ry + rh + Math.random() * 2]);
  for (let i = 0; i <= 15; i++) rectPts.push([rx + Math.random() * 2, ry + rh - (rh * i) / 15]);
  await penStroke(rectPts, { holdMs: 750 });
  const shapeStroke = await win.evaluate(() => {
    const ed = window.__app.active;
    const s = ed.pageData(ed.pages[0].id).strokes;
    return s[s.length - 1];
  });
  check('draw & hold snaps to a shape', shapeStroke && shapeStroke.sh === 1);

  // Shapes tool: ellipse with the mouse
  await win.keyboard.press('s');
  await win.evaluate(() => { window.__app.active.toolState.shape.kind = 'ellipse'; });
  await win.mouse.move(r.left + 360, r.top + 260);
  await win.mouse.down();
  await win.mouse.move(r.left + 460, r.top + 330, { steps: 8 });
  await win.mouse.up();
  const ell = await win.evaluate(() => {
    const ed = window.__app.active;
    const s = ed.pageData(ed.pages[0].id).strokes;
    const p = s[s.length - 1].p;
    const xs = p.filter((_, i) => i % 3 === 0), ys = p.filter((_, i) => i % 3 === 1);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), zoom: ed.viewer.zoom, n: s.length };
  });
  check('shapes tool draws an ellipse of the dragged size', Math.abs(ell.w * ell.zoom - 100) < 4 && Math.abs(ell.h * ell.zoom - 70) < 4, JSON.stringify(ell));

  // Text box
  await win.keyboard.press('t');
  await win.mouse.click(r.left + 80, r.top + 420);
  await win.keyboard.type('Bandlücke Si: 1,12 eV — Привет');
  await win.keyboard.press('Escape');
  await win.keyboard.press('p');
  const texts = await win.evaluate(() => {
    const ed = window.__app.active;
    return ed.pageData(ed.pages[0].id).texts;
  });
  check('text box created', texts.length === 1 && texts[0].text.includes('Привет'), texts[0] && texts[0].text);
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(out, '04-ink.png') });

  // ---------- eraser (partial) cuts the wave in two ----------
  await win.keyboard.press('e');
  await penStroke([[r.left + 240, r.top + 120], [r.left + 240, r.top + 200]]);
  const afterErase = await win.evaluate(() => {
    const ed = window.__app.active;
    return ed.pageData(ed.pages[0].id).strokes.filter((s) => s.t === 'pen' && !s.sh).length;
  });
  check('partial eraser splits the stroke', afterErase === 2, `${afterErase} pen pieces`);

  // ---------- undo / redo ----------
  await win.keyboard.press('Control+z');
  let pcs = await win.evaluate(() => { const ed = window.__app.active; return ed.pageData(ed.pages[0].id).strokes.filter((s) => s.t === 'pen' && !s.sh).length; });
  check('undo restores erased stroke', pcs === 1);
  await win.keyboard.press('Control+y');
  pcs = await win.evaluate(() => { const ed = window.__app.active; return ed.pageData(ed.pages[0].id).strokes.filter((s) => s.t === 'pen' && !s.sh).length; });
  check('redo re-applies erase', pcs === 2);

  // ---------- lasso select + move ----------
  await win.keyboard.press('l');
  const loop = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    loop.push([r.left + 200 + Math.cos(a) * 140, r.top + 305 + Math.sin(a) * 85]);
  }
  await win.mouse.move(loop[0][0], loop[0][1]);
  await win.mouse.down();
  for (const [x, y] of loop.slice(1)) await win.mouse.move(x, y);
  await win.mouse.up();
  const selCount = await win.evaluate(() => { const s = window.__app.active.tools.sel; return s ? s.strokeIds.size : 0; });
  check('lasso selects the rectangle', selCount >= 1, `${selCount} strokes selected`);
  await win.screenshot({ path: path.join(out, '05-lasso.png') });
  const before = shapeStroke.p.slice(0, 2);
  await win.mouse.move(r.left + 200, r.top + 305);
  await win.mouse.down();
  await win.mouse.move(r.left + 260, r.top + 365, { steps: 6 });
  await win.mouse.up();
  const movedP = await win.evaluate((id) => {
    const ed = window.__app.active;
    return ed.pageData(ed.pages[0].id).strokes.find((s) => s.id === id).p.slice(0, 2);
  }, shapeStroke.id);
  const z = await win.evaluate(() => window.__app.active.viewer.zoom);
  check('selection moves', Math.abs(movedP[0] - before[0] - 60 / z) < 1.5 && Math.abs(movedP[1] - before[1] - 60 / z) < 1.5, `${before} → ${movedP}`);
  // copy / paste
  await win.keyboard.press('Control+c');
  await win.keyboard.press('Control+v');
  const n2 = await win.evaluate(() => { const ed = window.__app.active; return ed.pageData(ed.pages[0].id).strokes.length; });
  check('copy / paste duplicates selection', n2 === strokes1.length + 5 + selCount - 1 || n2 > 5, `${n2} strokes on page`);
  await win.keyboard.press('Escape');

  // ---------- pages: insert, move, delete ----------
  await win.evaluate(() => window.__app.active.insertPage(0, 'grid'));
  let pages = await win.evaluate(() => window.__app.active.pages.map((p) => p.kind + ':' + (p.paper || p.pdfPage)));
  check('insert grid page after page 1', pages[1] === 'paper:grid' && pages.length === 601);
  await win.evaluate(() => window.__app.active.movePage(1, 3));
  pages = await win.evaluate(() => window.__app.active.pages.map((p) => p.kind + ':' + (p.paper || p.pdfPage)));
  check('move page', pages[3] === 'paper:grid');
  await win.keyboard.press('Control+z');
  await win.keyboard.press('Control+z');
  pages = await win.evaluate(() => window.__app.active.pages.length);
  check('undo page operations', pages === 600);

  // ---------- search ----------
  await win.keyboard.press('Control+f');
  await win.keyboard.type('Bandluecke');
  await win.waitForFunction(() => document.querySelectorAll('.search-panel .result').length > 0, null, { timeout: 60000 });
  await win.waitForTimeout(500);
  const hitCount = await win.evaluate(() => document.querySelectorAll('.search-panel .result').length);
  await win.click('.search-panel .result >> nth=3');
  await win.waitForSelector('.flash', { timeout: 5000 }).catch(() => null);
  const flashed = await win.evaluate(() => document.querySelectorAll('.flash').length);
  check('in-notebook search finds PDF text and highlights it', hitCount > 0 && flashed > 0, `${hitCount} hits`);
  await win.screenshot({ path: path.join(out, '06-search.png') });
  await win.keyboard.press('Escape');

  // ---------- persistence ----------
  await win.evaluate(() => window.__app.active.flush());
  const stored = JSON.parse(fs.readFileSync(path.join(libDir, rel, 'notebook.json'), 'utf8'));
  const firstId = stored.pages[0].id;
  const pageFile = path.join(libDir, rel, 'pages', firstId + '.json');
  check('ink saved to disk', fs.existsSync(pageFile));

  // ---------- export ----------
  const exportFile = path.join(tmp, 'export.pdf');
  t0 = Date.now();
  await win.evaluate(([r2, f]) => window.api.exportTo(r2, null, f), [rel, exportFile]);
  const exportMs = Date.now() - t0;
  const pdfinfo = execFileSync('pdfinfo', [exportFile]).toString();
  const pagesOut = /Pages:\s+(\d+)/.exec(pdfinfo)[1];
  check('export 600-page notebook to PDF', pagesOut === '600', `${exportMs} ms, ${(fs.statSync(exportFile).size / 1e6).toFixed(1)} MB`);
  execFileSync('pdftoppm', ['-r', '70', '-png', '-f', '1', '-l', '1', exportFile, path.join(out, '07-export')]);

  // ---------- blank notebook + library ----------
  await win.evaluate(async () => {
    const rel2 = await window.api.createNotebook('', { title: 'Mathe Notizen', paper: 'grid', coverColor: '#2f7d5b' });
    await window.api.createFolder('', 'Semester 1');
    await window.__app.openNotebook(rel2);
  });
  await win.waitForTimeout(500);
  r = await pageRect(0);
  await win.keyboard.press('p');
  const wave2 = [];
  for (let i = 0; i <= 60; i++) wave2.push([r.left + 60 + i * 5, r.top + 120 + Math.cos(i / 4) * 14, 0.5]);
  await penStroke(wave2, { pointerType: 'mouse' });
  console.log('      strokes in memory:', await win.evaluate(() => { const ed = window.__app.active; return ed.pageData(ed.pages[0].id).strokes.length + ' dirty=' + ed.dirtyPages.size; }));
  await win.screenshot({ path: path.join(out, '08-blank-notebook.png') });
  const blankRel = await win.evaluate(() => window.__app.active.rel);

  // A sync client's conflict copy inside pages/ must not break anything.
  const pagesDir = path.join(libDir, rel, 'pages');
  fs.writeFileSync(path.join(pagesDir, firstId + ' (1).json'), '{"strokes":[]}');

  // Close the window right after drawing (no explicit save): the close
  // handshake must still write the stroke.
  // Same path as the user clicking the window's X button.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await new Promise((res) => app.process().once('exit', res));
  const blankNb = JSON.parse(fs.readFileSync(path.join(libDir, blankRel, 'notebook.json'), 'utf8'));
  const blankPage = path.join(libDir, blankRel, 'pages', blankNb.pages[0].id + '.json');
  check('stroke saved when the window is closed immediately', fs.existsSync(blankPage) && JSON.parse(fs.readFileSync(blankPage)).strokes.length === 1,
    fs.readdirSync(path.join(libDir, blankRel, 'pages')).join(',') + ' / ' + blankNb.pages.map((p) => p.id).join(','));
  check('sync conflict copy left untouched', fs.existsSync(path.join(pagesDir, firstId + ' (1).json')));
  app = await launch();
  win = await app.firstWindow();
  watch(win);
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app && document.querySelectorAll('.card').length >= 3, null, { timeout: 20000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(out, '09-library.png') });
  await win.evaluate((r2) => window.__app.openNotebook(r2), rel);
  await win.waitForFunction(() => document.querySelector('.page .bg-canvas'), null, { timeout: 30000 });
  const reopened = await win.evaluate(() => {
    const ed = window.__app.active;
    return { strokes: ed.pageData(ed.pages[0].id).strokes.length, texts: ed.pageData(ed.pages[0].id).texts.length };
  });
  check('ink and text persist across restart', reopened.strokes >= 6 && reopened.texts === 1, JSON.stringify(reopened));

  // Double-clicking a tab's close button must close exactly that tab.
  await win.evaluate((r2) => window.__app.openNotebook(r2), blankRel);
  await win.waitForTimeout(400);
  const tabsBefore = await win.evaluate(() => window.__app.editors.length);
  await win.dblclick('.tab.active .tab-close');
  await win.waitForTimeout(600);
  const tabsAfter = await win.evaluate(() => window.__app.editors.length);
  check('double-click on tab close closes one tab', tabsBefore === 2 && tabsAfter === 1, `${tabsBefore} → ${tabsAfter}`);

  // Library-wide search
  await win.evaluate(() => window.__app.showLibrary());
  await win.fill('.search-input', 'Bandlücke');
  await win.waitForSelector('.lib-results .result', { timeout: 10000 });
  await win.screenshot({ path: path.join(out, '10-library-search.png') });
  check('library search finds typed note', true);

  await app.close();
  const realErrors = errors.filter((e) => !/Autofill|DevTools/.test(e));
  check('no console / page errors', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(out, 'e2e-results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
