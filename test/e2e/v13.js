// End-to-end checks for v1.3 through the real UI.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v13.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, { recursive: true });
const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const packaged = !!process.env.STUDYNOTES_EXE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v13-'));
const libDir = path.join(tmp, 'Library');
const driveDir = path.join(tmp, 'FakeDrive');
const errors = [];

async function launch() {
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: packaged ? ['--no-sandbox'] : [root, '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: libDir, STUDYNOTES_USERDATA: path.join(tmp, 'u'), STUDYNOTES_FAKE_DRIVE: driveDir },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app);
  return { app, win, ed: (fn, arg) => win.evaluate(fn, arg) };
}
const driveIndex = () => { try { return JSON.parse(fs.readFileSync(path.join(driveDir, 'index.json'), 'utf8')); } catch { return {}; } };
const driveFile = (p) => { const [id] = Object.entries(driveIndex()).find(([, f]) => f.path === p && !f.role) || []; return id ? fs.readFileSync(path.join(driveDir, id), 'utf8') : null; };

(async () => {
  let { app, win, ed } = await launch();
  const sections = (process.env.ONLY || 'A,B,C,D,E,F,G,H').split(',');

  const rel = await ed(async () => {
    const r = await window.api.createNotebook('', { title: 'v13', paper: 'lined' });
    await window.__app.openNotebook(r);
    return r;
  });
  await win.waitForTimeout(500);
  const z = await ed(() => window.__app.active.viewer.zoom);
  const at = async (x, y, page = 0) => {
    await ed(([p, yy]) => { const v = window.__app.active.viewer; v.scrollToPage(p, yy); v.update(); }, [page, y]);
    await win.waitForTimeout(120);
    const r = await ed((p) => window.__app.active.viewer.pageClientRect(p), page);
    const zz = await ed(() => window.__app.active.viewer.zoom);
    return [r.left + x * zz, r.top + y * zz];
  };
  const draw = async (pts) => {
    const [x0, y0] = await at(pts[0][0], pts[0][1]);
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const zz = await ed(() => window.__app.active.viewer.zoom);
    await win.mouse.move(x0, y0); await win.mouse.down();
    for (const [x, y] of pts.slice(1)) await win.mouse.move(r.left + x * zz, r.top + y * zz, { steps: 4 });
    await win.mouse.up();
  };
  const pageData = (i = 0) => ed((k) => { const e = window.__app.active; return e.pageData(e.pages[k].id); }, i);
  void z;

  // =====================================================================
  // A. sync & data safety
  if (sections.includes('A') && !packaged) {
    await win.keyboard.press('p');
    await draw([[100, 120], [200, 140], [300, 120]]);
    await win.waitForTimeout(2600); // autosave: at most ~2 s
    const onDisk = JSON.parse(fs.readFileSync(path.join(libDir, rel, 'pages', (await ed(() => window.__app.active.pages[0].id)) + '.json'), 'utf8'));
    check('A: a stroke is on disk within ~2 s without pressing anything', onDisk.strokes && onDisk.strokes.length === 1);

    // Ctrl+S saves and syncs (signed in to the simulated Drive)
    await draw([[100, 220], [300, 240]]);
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => document.querySelector('.cloud-label') !== null, null, { timeout: 2000 }).catch(() => {});
    const pid = await ed(() => window.__app.active.pages[0].id);
    for (let i = 0; i < 40 && !(driveFile(`${rel}/pages/${pid}.json`) || '').includes('"strokes"'); i++) await win.waitForTimeout(150);
    const up = JSON.parse(driveFile(`${rel}/pages/${pid}.json`) || '{}');
    check('A: Ctrl+S saves and uploads the open notebook to Drive', up.strokes && up.strokes.length === 2, `${up.strokes && up.strokes.length} strokes on Drive`);

    // closing a background tab tells sync it is closed
    const rel2 = await ed(async () => { const r = await window.api.createNotebook('', { title: 'second' }); await window.__app.openNotebook(r); return r; });
    await ed(() => window.__app.activate(window.__app.editors[0].editor));
    await ed((r) => window.__app.closeEditor(window.__app.editors.find((t) => t.editor.rel === r).editor), rel2);
    const openList = await ed(() => window.__app.editors.map((t) => t.editor.rel));
    check('A: closing a background tab updates the open-notebook list for sync', openList.length === 1 && openList[0] === rel);

    // backups now (normally hourly) – list via the library menu API
    const snap = await ed(() => window.api.backupSnapshotNow());
    const list = await ed((r) => window.api.backupList(r), rel);
    check('A: local backup of the notebook exists next to the library', snap.saved.includes(rel) && list.length === 1 && fs.existsSync(path.join(tmp, 'Library Backups', 'index.json')), JSON.stringify(snap));

    // restore as copy from the library
    await ed(() => window.__app.showLibrary());
    await win.waitForTimeout(300);
    const restored = await ed(async (r) => { const l = await window.api.backupList(r); return window.api.backupRestore(r, l[0].stamp); }, rel);
    check('A: restore from backup adds a copy, original untouched', fs.existsSync(path.join(libDir, restored, 'notebook.json')) && restored !== rel && fs.existsSync(path.join(libDir, rel, 'notebook.json')), restored);

    // rename from the library while the notebook is open in a tab
    await ed((r) => window.__app.openNotebook(r), rel);
    await ed(() => window.__app.showLibrary());
    await win.waitForTimeout(300);
    const card = win.locator('.nb-card').filter({ has: win.locator('.card-title', { hasText: /^v13$/ }) }).first();
    await card.click({ button: 'right' });
    await win.locator('.menu .menu-item', { hasText: 'Rename' }).click();
    await win.locator('.modal input').fill('Physik 1');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(800);
    const renamed = await ed(() => ({ titles: [...document.querySelectorAll('.nb-card .card-title')].map((e) => e.textContent), tab: window.__app.editors[0].editor.rel }));
    check('E: rename from the library works (also while open in a tab)', renamed.titles.includes('Physik 1') && renamed.tab === 'Physik 1', JSON.stringify(renamed));
    await ed(() => window.__app.activate(window.__app.editors[0].editor));
    await win.waitForTimeout(300);

    // close the app: it waits for Drive and shows progress
    await draw([[100, 320], [300, 330]]);
    const pid2 = await ed(() => window.__app.active.pages[0].id);
    let sawProgress = false;
    win.on('console', (m) => { if (m.text() === 'E2E: closing sync window') sawProgress = true; });
    await ed(() => new MutationObserver(() => {
      const t = document.querySelector('.modal-title');
      if (t && t.textContent.includes('Syncing before closing') && !window.__seen) { window.__seen = true; console.log('E2E: closing sync window'); }
    }).observe(document.body, { childList: true, subtree: true }));
    const closing = Promise.resolve();
    // like clicking the window's X button
    const exited = new Promise((r) => app.process().once('exit', r));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closing;
    await Promise.race([exited, new Promise((r) => setTimeout(r, 20000))]);
    const sawWindow = sawProgress;
    const upAtExit = JSON.parse(driveFile(`Physik 1/pages/${pid2}.json`) || '{}');
    check('A: closing syncs first (progress window) – last stroke is on Drive', sawWindow && upAtExit.strokes && upAtExit.strokes.length === 3, `window ${sawWindow}, ${upAtExit.strokes && upAtExit.strokes.length} strokes`);

    // simulated crash: damaged page + no clean exit -> repaired from backup, notice shown
    ({ app, win, ed } = await launch());
    await ed(() => window.api.backupSnapshotNow());
    const pfile = path.join(libDir, 'Physik 1', 'pages', pid2 + '.json');
    app.process().kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
    fs.writeFileSync(pfile, ''); // power cut while writing
    ({ app, win, ed } = await launch());
    const notice = await win.waitForSelector('.modal-title:has-text("Your notes are safe")', { timeout: 8000 }).then(() => true).catch(() => false);
    const fixed = JSON.parse(fs.readFileSync(pfile, 'utf8'));
    check('A: after a crash the damaged page is restored from the backup and the user is told', notice && fixed.strokes && fixed.strokes.length === 3);
    await win.screenshot({ path: path.join(out, 'v13-01-crash-notice.png') });
    await win.keyboard.press('Enter');
    await ed(async () => { const items = await window.api.list(''); const nb = items.notebooks.find((n) => n.title === 'Physik 1'); await window.__app.openNotebook(nb.path); });
    await win.waitForTimeout(500);
  }

  // Fresh notebook for the drawing checks (the crash test may have reopened the app)
  if (!(await ed(() => !!window.__app.active))) {
    await ed(async () => { const r = await window.api.createNotebook('', { title: 'v13b', paper: 'lined' }); await window.__app.openNotebook(r); });
    await win.waitForTimeout(500);
  }
  const ink = async () => ed(() => document.querySelector('.page'));
  void ink;

  // =====================================================================
  // B. text box
  if (sections.includes('B')) {
    await win.keyboard.press('t');
    const [tx, ty] = await at(120, 420);
    await win.mouse.click(tx, ty);
    await win.waitForTimeout(200);
    const w0 = await ed(() => { const w = document.querySelector('.textbox-wrap.editing'); return w && w.getBoundingClientRect().width; });
    await win.keyboard.type('Hi');
    await win.waitForTimeout(100);
    const w1 = await ed(() => document.querySelector('.textbox-wrap.editing').getBoundingClientRect().width);
    await win.keyboard.type(' there, this line grows while I type');
    await win.waitForTimeout(100);
    const w2 = await ed(() => document.querySelector('.textbox-wrap.editing').getBoundingClientRect().width);
    check('B: a new text box starts thin and grows while typing', w0 < 40 && w1 < 70 && w2 > w1 * 3, `${Math.round(w0)} → ${Math.round(w1)} → ${Math.round(w2)} px`);
    const frame = await ed(() => getComputedStyle(document.querySelector('.textbox-wrap.editing')).outlineStyle);
    const handles = await ed(() => [...document.querySelectorAll('.textbox-wrap.editing .tb-handle.resize')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check('B: frame and small side handles only while editing', frame === 'solid' && handles.length === 2 && handles.every(([w, hh]) => w >= 10 && w <= 24 && hh >= 10) /* 1.6.1: grab zone = whole side */, JSON.stringify(handles));
    await win.screenshot({ path: path.join(out, 'v13-02-textbox-editing.png') });
    // tap elsewhere: only ends editing
    const [ox2, oy2] = await at(350, 600);
    const nBefore = (await pageData()).texts.length;
    await win.mouse.click(ox2, oy2);
    await win.waitForTimeout(250);
    const after1 = await ed(() => ({ editing: !!document.querySelector('.textbox-wrap.editing'), outline: getComputedStyle(document.querySelector('.textbox-wrap')).outlineStyle }));
    const nAfter = (await pageData()).texts.length;
    check('B: first tap elsewhere only finishes editing – frame disappears, no new box', !after1.editing && after1.outline === 'none' && nAfter === nBefore, JSON.stringify(after1) + ` boxes ${nBefore}→${nAfter}`);
    await win.screenshot({ path: path.join(out, 'v13-03-textbox-done.png') });
    await win.mouse.click(ox2, oy2);
    await win.waitForTimeout(200);
    check('B: the next tap starts a new box', await ed(() => !!document.querySelector('.textbox-wrap.editing')));
    await win.keyboard.press('Escape');
    // box style: preset with a fill
    const box = (await pageData()).texts.find((t) => t.text.startsWith('Hi'));
    await ed((id) => { const e = window.__app.active; e.editText(e.pages[0].id, id); const el = document.querySelector(`.textbox[data-id="${id}"]`); window.getSelection().collapse(el, 0); }, box.id);
    await win.waitForTimeout(150);
    await win.click('.text-bar button[title="Text box style"]');
    await win.waitForTimeout(150);
    const tabs = await ed(() => [...document.querySelectorAll('.box-tabs button')].map((b) => b.textContent));
    await win.locator('.box-menu .box-swatch').nth(2).click(); // green, rounded
    await win.waitForTimeout(150);
    await win.screenshot({ path: path.join(out, 'v13-04-box-style.png') });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(150);
    const boxed = (await pageData()).texts.find((t) => t.id === box.id);
    const bgOnScreen = await ed((id) => getComputedStyle(document.querySelector(`.textbox[data-id="${id}"]`)).backgroundColor, box.id);
    check('B: text box style popup (Presets / Custom) gives the box a background', tabs.join() === 'Presets,Custom' && boxed.bg === '#b4ff52' && boxed.br === 8 && bgOnScreen === 'rgb(180, 255, 82)', `${boxed.bg} ${bgOnScreen}`);
  }

  // =====================================================================
  // C. shapes: fill + clean corners
  if (sections.includes('C')) {
    await win.keyboard.press('s');
    await ed(() => { const e = window.__app.active; e.toolState.shape.kind = 'rect'; e.toolState.shape.fill = '#ffd9cf'; e.toolState.pen.size = 3; e.renderOptions(); });
    const fillBtn = await ed(() => !!document.querySelector('.tool-options .fill-chip'));
    const [a1, b1] = await at(320, 250);
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const zz = await ed(() => window.__app.active.viewer.zoom);
    await win.mouse.move(a1, b1); await win.mouse.down();
    await win.mouse.move(r.left + 450 * zz, r.top + 330 * zz, { steps: 6 }); await win.mouse.up();
    await win.waitForTimeout(300);
    const rect = (await pageData()).strokes.at(-1);
    const px = await ed(([x, y]) => {
      const v = window.__app.active.viewer.view(0);
      const c = document.createElement('canvas'); c.width = 1; c.height = 1;
      const pr = window.__app.active.viewer.pageClientRect(0), cr = v.inkCanvas.getBoundingClientRect();
      const g = c.getContext('2d');
      const sx = v.inkCanvas.width / cr.width;
      g.drawImage(v.inkCanvas, (pr.left + x * window.__app.active.viewer.zoom - cr.left) * sx, (pr.top + y * window.__app.active.viewer.zoom - cr.top) * sx, 1, 1, 0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data];
    }, [385, 290]);
    check('C: shape tool has a Fill option; the rectangle is filled inside', fillBtn && rect.f === '#ffd9cf' && Math.abs(px[0] - 255) < 3 && Math.abs(px[1] - 217) < 3, JSON.stringify(px));
    // select it and change the fill from the selection toolbar
    await win.keyboard.press('v');
    await ed((id) => { const e = window.__app.active; e.tools.select(0, e.pages[0].id, new Set([id]), new Set(), new Set()); }, rect.id);
    await win.waitForTimeout(150);
    await win.click('.sel-toolbar .fill-chip');
    await win.locator('.color-grid .swatch').nth(4).click();
    await win.waitForTimeout(200);
    const refill = (await pageData()).strokes.find((s) => s.id === rect.id);
    check('C: fill can be changed for a selected shape', refill.f && refill.f !== '#ffd9cf', refill.f);
    await win.keyboard.press('Escape');
    await win.screenshot({ path: path.join(out, 'v13-05-shape.png') });
  }

  // =====================================================================
  // D. laser: red only, one continuous line
  if (sections.includes('D')) {
    await win.keyboard.press('k');
    const opts = await ed(() => ({ swatches: document.querySelectorAll('.tool-options .opt-swatch').length, chips: [...document.querySelectorAll('.tool-options .opt-chip')].map((b) => b.textContent) }));
    const [lx, ly] = await at(100, 650);
    await win.mouse.move(lx, ly); await win.mouse.down();
    for (let i = 1; i <= 30; i++) await win.mouse.move(lx + i * 12, ly + Math.sin(i / 3) * 30);
    const gaps = await ed(([x0, y0]) => {
      const c = document.querySelector('.laser-canvas');
      const host = c.getBoundingClientRect();
      const g = c.getContext('2d');
      const dpr = c.width / host.width;
      // walk along the path: every sample point must be lit (no dotted gaps)
      let miss = 0;
      for (let i = 2; i <= 29; i++) {
        for (let t = 0; t < 1; t += 0.25) {
          const x = x0 + (i + t) * 12, yy = y0 + (Math.sin(i / 3) + (Math.sin((i + 1) / 3) - Math.sin(i / 3)) * t) * 30;
          const d = g.getImageData(Math.round((x - host.left) * dpr), Math.round((yy - host.top) * dpr), 1, 1).data;
          if (d[3] < 100) miss++;
        }
      }
      return miss;
    }, [lx, ly]);
    const color = await ed(() => window.__app.active.tools.laser.state.color);
    await win.mouse.up();
    check('D: laser is red only and draws one continuous line (no dots)', opts.swatches === 0 && gaps === 0 && opts.chips.join() === 'Dot,Trail', `${gaps} gaps, ${opts.swatches} colours, stored ${color}`);
    await win.keyboard.press('v');
  }

  // =====================================================================
  // F. pictures
  if (sections.includes('F')) {
    // a picture with a transparent background over a stroke
    await win.keyboard.press('p');
    await draw([[150, 520], [400, 520]]);
    await win.waitForTimeout(200);
    const pic = await ed(async () => {
      const e = window.__app.active;
      const c = document.createElement('canvas'); c.width = 200; c.height = 200;
      const g = c.getContext('2d'); g.fillStyle = '#2b9de9'; g.beginPath(); g.arc(100, 100, 50, 0, Math.PI * 2); g.fill();
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      await e.placeImages([{ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }], { index: 0, x: 275, y: 520 });
      const d = e.pageData(e.pages[0].id);
      const it = d.items.at(-1);
      e.tools.select(0, e.pages[0].id, new Set(), new Set(), new Set([it.id]));
      e.tools.order(1); // in front of the ink
      e.tools.clearSelection();
      return it;
    });
    await win.waitForTimeout(400);
    // click on the line inside the picture's box but outside the circle: must pick the stroke
    await win.keyboard.press('v');
    const [cx1, cy1] = await at(pic.x + pic.w * 0.08, 520);
    await win.mouse.click(cx1, cy1);
    await win.waitForTimeout(150);
    const picked = await ed(() => { const s = window.__app.active.tools.sel; return s ? { strokes: s.strokeIds.size, items: s.itemIds.size } : null; });
    await win.keyboard.press('Escape');
    const [cx2, cy2] = await at(pic.x + pic.w / 2, pic.y + pic.h / 2);
    await win.mouse.click(cx2, cy2);
    await win.waitForTimeout(150);
    const picked2 = await ed(() => { const s = window.__app.active.tools.sel; return s ? { strokes: s.strokeIds.size, items: s.itemIds.size } : null; });
    check('F: transparent parts of a picture let clicks through to the ink behind', picked && picked.strokes === 1 && picked.items === 0 && picked2 && picked2.items === 1, JSON.stringify([picked, picked2]));
    // rotate 90° + transparency 50%
    await win.click('.sel-toolbar button[title="Rotate right 90°"]');
    await win.waitForTimeout(200);
    await ed(() => { const r = document.querySelector('.sel-toolbar .opacity-range'); r.value = '50'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    await win.waitForTimeout(200);
    const it2 = (await pageData()).items.find((q) => q.id === pic.id);
    const imgStyle = await ed((id) => { const im = document.querySelector(`.item[data-id="${id}"] img`); return [im.style.transform, im.style.opacity]; }, pic.id);
    check('F: picture can be rotated and made transparent', it2.r === 90 && it2.o === 0.5 && imgStyle[0] === 'rotate(90deg)' && imgStyle[1] === '0.5', JSON.stringify([it2.r, it2.o, imgStyle]));
    const hasHandle = await ed(() => !!document.querySelector('.sel-rotate'));
    check('F: a single selected picture has a rotate handle', hasHandle);
    await win.screenshot({ path: path.join(out, 'v13-06-picture.png') });
    // background removal (real model, offline)
    const before = it2.src;
    const t0 = Date.now();
    await ed((id) => window.__app.active.removePictureBackground(window.__app.active.pages[0].id, id), pic.id);
    const it3 = (await pageData()).items.find((q) => q.id === pic.id);
    check('F: "Remove background" replaces the picture with a transparent PNG (undoable)', it3.src !== before && /\.png$/.test(it3.src), `${it3.src} in ${Date.now() - t0} ms`);
    await win.keyboard.press('Control+z');
    await win.waitForTimeout(200);
    check('F: undo brings the original picture back', (await pageData()).items.find((q) => q.id === pic.id).src === before);
    await win.keyboard.press('Escape');
  }

  // =====================================================================
  // G. pages
  if (sections.includes('G')) {
    const n0 = await ed(() => window.__app.active.pages.length);
    await ed(() => { window.__app.active.viewer.scrollToPage(0); });
    await win.click('button[title="Add a page after this one (same style)"]');
    await win.waitForTimeout(300);
    const pages1 = await ed(() => window.__app.active.pages.map((p) => p.paper));
    check('G: "Add page" adds a page in the same style after the current one', pages1.length === n0 + 1 && pages1[1] === pages1[0], JSON.stringify(pages1));
    await ed(() => window.__app.active.viewer.scrollToPage(1));
    await win.waitForTimeout(200);
    await win.click('.split-arrow');
    await win.click('.addpage-pos button[data-where="before"]');
    await win.locator('.addpage-list .menu-item', { hasText: 'Grid' }).first().click();
    await win.waitForTimeout(300);
    const pages2 = await ed(() => window.__app.active.pages.map((p) => p.paper));
    check('G: dropdown: choose a style and add it before the current page', pages2.length === n0 + 2 && pages2[1] === 'grid', JSON.stringify(pages2));
    await win.screenshot({ path: path.join(out, 'v13-07-pages.png') });
    // "+" at the end, then keep scrolling for 2 s
    await ed(() => { const s = window.__app.active.viewer.scroller; s.scrollTop = s.scrollHeight; });
    await win.waitForTimeout(300);
    const plusVisible = await win.locator('.page-end-btn').isVisible();
    await win.click('.page-end-btn');
    await win.waitForTimeout(300);
    const n3 = await ed(() => window.__app.active.pages.length);
    const vb = await win.locator('.viewer').boundingBox();
    await ed(() => { const s = window.__app.active.viewer.scroller; s.scrollTop = s.scrollHeight; });
    await win.waitForTimeout(200);
    await win.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
    let ring = 0;
    for (let i = 0; i < 9; i++) {
      await win.mouse.wheel(0, 120);
      await win.waitForTimeout(80);
      if (i === 3) ring = await ed(() => parseFloat(getComputedStyle(document.querySelector('.page-end')).getPropertyValue('--p')) || 0);
    }
    await win.waitForTimeout(300);
    const n4 = await ed(() => window.__app.active.pages.length);
    check('G: "+" after the last page adds one; scrolling on for 0.5 s adds one with a progress ring', plusVisible && n3 === n0 + 3 && n4 === n0 + 4 && ring > 0.2 && ring < 1, `${n0}→${n3}→${n4}, ring ${ring.toFixed(2)}`);
    // rotate, bookmark, duplicate from the page menu
    await ed(() => window.__app.active.viewer.scrollToPage(0));
    await win.waitForTimeout(200);
    const p0 = await ed(() => ({ ...window.__app.active.pages[0] }));
    const st0 = (await pageData(0)).strokes[0];
    await ed(() => window.__app.active.rotatePage(0, 1));
    await win.waitForTimeout(200);
    const p0r = await ed(() => ({ ...window.__app.active.pages[0] }));
    const st0r = (await pageData(0)).strokes.find((s) => s.id === st0.id);
    check('G: rotate page turns the page and what is on it', p0r.w === p0.h && p0r.h === p0.w && p0r.rot === 90 && Math.abs(st0r.p[0] - (p0.h - st0.p[1])) < 0.02 && Math.abs(st0r.p[1] - st0.p[0]) < 0.02);
    await win.keyboard.press('Control+z');
    await win.waitForTimeout(200);
    const p0u = await ed(() => ({ ...window.__app.active.pages[0] }));
    check('G: rotating a page is undoable', p0u.w === p0.w && !p0u.rot && (await pageData(0)).strokes.find((s) => s.id === st0.id).p[0] === st0.p[0]);
    await ed(() => window.__app.active.toggleBookmark(0));
    await win.waitForTimeout(200);
    await win.click('.thumb-filter button[data-f="bm"]');
    await win.waitForTimeout(100);
    const bm = await ed(() => ({ ribbon: !!document.querySelector('.page[data-page-id] .page-bm'), shown: [...document.querySelectorAll('.thumb')].filter((t) => t.style.display !== 'none').length, thumbBm: !!document.querySelector('.thumb .thumb-bm') }));
    check('G: bookmark: ribbon on the page and the thumbnail, bookmark filter shows only it', bm.ribbon && bm.thumbBm && bm.shown === 1, JSON.stringify(bm));
    await win.screenshot({ path: path.join(out, 'v13-08-bookmarks.png') });
    await win.click('.thumb-filter button[data-f="all"]');
    const nd = await ed(() => window.__app.active.pages.length);
    await ed(() => window.__app.active.duplicatePage(0));
    check('G: duplicate page', (await ed(() => window.__app.active.pages.length)) === nd + 1);
    const menuLabels = await ed(() => { window.__app.active.moreMenu(document.querySelector('button[title="More"]')); const l = [...document.querySelectorAll('.menu .mi-label')].map((e) => e.textContent); document.querySelector('.menu').remove(); return l; });
    check('G: page options in the ⋯ menu (bookmark, rotate, duplicate)', ['Remove bookmark', 'Rotate page right 90°', 'Duplicate page'].every((x) => menuLabels.includes(x)), menuLabels.slice(0, 6).join(' | '));
  }

  // =====================================================================
  // H. delete is red
  if (sections.includes('H')) {
    await ed(() => { const e = window.__app.active; e.viewer.scrollToPage(0); e.viewer.update(); });
    await win.waitForTimeout(200);
    await ed(() => { const e = window.__app.active; const d = e.pageData(e.pages[0].id); e.tools.select(0, e.pages[0].id, new Set([d.strokes[0].id]), new Set(), new Set()); });
    await win.waitForTimeout(150);
    const red = await ed(() => getComputedStyle(document.querySelector('.sel-toolbar button[title^="Delete"]')).color);
    check('H: delete icon is red', red === 'rgb(229, 72, 77)', red);
    await win.keyboard.press('Escape');
  }

  // export: everything new appears in the PDF
  if (!packaged || true) {
    const pdfFile = path.join(tmp, 'v13.pdf');
    await ed(([f]) => { const e = window.__app.active; return e.flush().then(() => window.api.exportTo(e.rel, null, f)); }, [pdfFile]);
    const { execFileSync } = require('child_process');
    execFileSync('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '3', pdfFile, path.join(out, 'v13-export')]);
    const txt = execFileSync('pdftotext', [pdfFile, '-']).toString();
    check('export: PDF has the text boxes and pages', /Hi there/.test(txt), txt.slice(0, 60).replace(/\s+/g, ' '));
  }

  await app.close();
  const realErrors = errors.filter((e) => !/Autofill|DevTools/.test(e));
  check('no console / page errors', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
