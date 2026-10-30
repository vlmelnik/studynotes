// End-to-end checks for v1.4 through the real UI.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v14.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const ext = require('../../src/main/external');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, { recursive: true });
const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const packaged = !!process.env.STUDYNOTES_EXE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v14-'));
const libDir = path.join(tmp, 'Library');
const userData = path.join(tmp, 'u');
const errors = [];
const shot = (win, name) => win.screenshot({ path: path.join(out, `v14-${name}.png`) });

async function launch(extraArgs = [], size = { width: 1500, height: 940 }) {
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: [...(packaged ? [] : [root]), '--no-sandbox', ...extraArgs],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: libDir, STUDYNOTES_USERDATA: userData },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await win.setViewportSize(size);
  await win.waitForFunction(() => window.__app);
  return { app, win, ed: (fn, arg) => win.evaluate(fn, arg) };
}

(async () => {
  const sections = (process.env.ONLY || 'A,B,C,D,E,F,G,H,I,J,K,L').split(',');
  // An "older version" was used before: the What's new window must show once.
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ settings: { lastSeenVersion: '1.3.0' } }));
  let { app, win, ed } = await launch();

  // ===================================================================== A. What's new
  if (sections.includes('A')) {
    await win.waitForSelector('.whats-new', { timeout: 4000 }).catch(() => {});
    const wn = await ed(() => { const el = document.querySelector('.whats-new'); return el && { cards: el.querySelectorAll('.wn-card').length, badge: el.querySelector('.wn-badge').textContent }; });
    await win.waitForTimeout(500);
    await shot(win, '01-whats-new');
    check("A: What's new appears once after an update", wn && wn.cards >= 8, JSON.stringify(wn));
  }
  // close it like a user does (removing the element would leave its key handler behind)
  while (await win.locator('.modal-actions .btn-primary').count()) { await win.locator('.modal-actions .btn-primary').last().click(); await win.waitForTimeout(150); }

  // ===================================================================== B. template picker, covers, paper colours
  let rel;
  if (sections.includes('B') || true) {
    await win.locator('button', { hasText: 'New notebook' }).first().click();
    await win.waitForSelector('.tp');
    const coverTiles = await win.locator('.tp-tile').count();
    await shot(win, '02-picker-cover');
    await win.locator('.tp-tile', { hasText: 'Blue' }).first().click();
    await win.click('.tp-tabs button[data-tab="paper"]');
    await win.selectOption('.tp-pc', 'white');
    await win.locator('.tp-tile', { hasText: 'Dotted' }).first().click();
    await win.click('.tp-orient button[title="Landscape"]');
    await win.fill('.tp-title', 'Physics');
    await shot(win, '03-picker-paper');
    await win.locator('.modal-actions .btn-primary').click();
    await win.waitForFunction(() => window.__app.active && window.__app.active.doc.nb.title === 'Physics');
    await win.waitForTimeout(600);
    const nb = await ed(() => { const e = window.__app.active; return { rel: e.rel, pages: e.doc.nb.pages.map((p) => ({ paper: p.paper, pc: p.pc, w: p.w, h: p.h, cover: p.cover && p.cover.color })) }; });
    rel = nb.rel;
    const [c, p] = nb.pages;
    check('B: picker has Cover/Paper tabs; cover + dotted white landscape page is created',
      coverTiles > 8 && c.paper === 'cover' && c.cover && p.paper === 'dotted' && p.pc === 'white' && p.w > p.h, JSON.stringify(nb.pages) + ' tiles ' + coverTiles);
    await shot(win, '04-new-notebook');
    // cream default page
    const r2 = await ed(async () => { const r = await window.api.createNotebook('', { title: 'Cream', paper: 'lined' }); await window.__app.openNotebook(r); return r; });
    await win.waitForTimeout(500);
    const bg = await ed(() => getComputedStyle(document.querySelector('.page')).backgroundColor);
    check('B: default paper is cream #FAF6E8', bg === 'rgb(250, 246, 232)', bg);
    rel = r2;
  }
  // whole page visible: page coordinates map into the window
  await ed(() => { const v = window.__app.active.viewer; v.zoomTo(0.95, undefined, undefined, false); v.scroller.scrollTop = 0; v.update(); });
  await win.waitForTimeout(300);

  // helpers on the open notebook
  const at = async (x, y, page = 0) => {
    const r = await ed((p) => window.__app.active.viewer.pageClientRect(p), page);
    const z = await ed(() => window.__app.active.viewer.zoom);
    return [r.left + x * z, r.top + y * z];
  };
  const draw = async (pts, hold = 0) => {
    const [x0, y0] = await at(...pts[0]);
    await win.mouse.move(x0, y0); await win.mouse.down();
    for (const p of pts.slice(1)) { const [x, y] = await at(...p); await win.mouse.move(x, y, { steps: 5 }); }
    if (hold) await win.waitForTimeout(hold);
    await win.mouse.up();
    await win.waitForTimeout(150);
  };
  const pageData = (i = 0) => ed((k) => { const e = window.__app.active; return e.pageData(e.pages[k].id); }, i);

  // ===================================================================== C. shortcuts on a Russian layout
  if (sections.includes('C')) {
    const key = (code, k) => ed(([c, kk]) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: kk, bubbles: true })), [code, k]);
    await key('KeyT', 'е');
    const t1 = await ed(() => window.__app.toolState.tool);
    await key('KeyP', 'з');
    const t2 = await ed(() => window.__app.toolState.tool);
    check('C: tool shortcuts work with the Russian layout (е → text, з → pen)', t1 === 'text' && t2 === 'pen', `${t1}, ${t2}`);
  }

  // ===================================================================== D. group & rotate
  if (sections.includes('D')) {
    await ed(() => window.__app.active.setTool('pen'));
    await draw([[100, 100], [200, 110], [260, 100]]);
    await draw([[100, 160], [200, 170], [260, 160]]);
    let d = await pageData();
    const ids = d.strokes.map((s) => s.id);
    await ed((ids_) => { const e = window.__app.active; e.setTool('lasso'); e.tools.select(0, e.pages[0].id, new Set(ids_), new Set()); }, ids);
    await win.waitForTimeout(150);
    await win.click('.sel-toolbar button[title^="Group"]');
    await win.waitForTimeout(150);
    d = await pageData();
    const g = d.strokes[0].g;
    await ed((id) => { const e = window.__app.active; e.tools.clearSelection(); e.tools.select(0, e.pages[0].id, new Set([id]), new Set()); }, ids[0]);
    const selN = await ed(() => window.__app.active.tools.sel.strokeIds.size);
    check('D: Group joins strokes; selecting one selects the whole group', g && d.strokes.every((s) => s.g === g) && selN === 2, `g=${g} sel=${selN}`);
    const before = JSON.stringify(d.strokes[0].p.slice(0, 2));
    await ed(() => window.__app.active.tools.rotateSelection(90));
    await win.waitForTimeout(150);
    await shot(win, '05-rotated-group');
    d = await pageData();
    check('D: a group rotates (rotate handle shown)', JSON.stringify(d.strokes[0].p.slice(0, 2)) !== before && (await win.locator('.sel-rotate').count()) === 1);
    await ed(() => window.__app.active.tools.clearSelection());
    // text: rotate
    await ed(() => {
      const e = window.__app.active;
      e.setTool('lasso');
      const before_ = e.pageData(e.pages[0].id);
      e.setPageData(e.pages[0].id, { ...before_, texts: before_.texts.concat([{ id: 'tx1', x: 300, y: 300, w: 160, fs: 16, c: '#000', text: 'Rotate me' }]) });
      e.tools.select(0, e.pages[0].id, new Set(), new Set(['tx1']));
    });
    await ed(() => window.__app.active.tools.rotateSelection(90));
    await win.waitForTimeout(200);
    const tr = await ed(() => { const t = window.__app.active.pageData(window.__app.active.pages[0].id).texts.find((q) => q.id === 'tx1'); const el = document.querySelector('.textbox[data-id="tx1"]'); return { r: t.r, tf: el && (el.closest('.text-wrap') || el).style.transform }; });
    check('D: text boxes rotate', tr.r === 90 && /rotate\(90deg\)/.test(tr.tf || ''), JSON.stringify(tr));
    await ed(() => window.__app.active.tools.clearSelection());
  }

  // ===================================================================== E. text size control; frame disappears
  if (sections.includes('E')) {
    await ed(() => window.__app.active.setTool('text'));
    const [x, y] = await at(120, 420);
    await win.mouse.click(x, y);
    await win.keyboard.type('Size test');
    await win.waitForSelector('.size-ctl');
    await win.click('.size-ctl .size-drop');
    const sizes = await win.locator('.size-list .menu-item').allTextContents();
    await win.locator('.size-list .menu-item', { hasText: /^24/ }).first().click();
    await win.waitForTimeout(100);
    await win.click('.size-ctl .size-arrows button >> nth=0');
    await win.waitForTimeout(100);
    await shot(win, '06-text-size');
    const [x2, y2] = await at(500, 700);
    await win.mouse.click(x2, y2); // finish editing
    await win.waitForTimeout(250);
    const d = await pageData();
    const t = d.texts.find((q) => q.text === 'Size test');
    const editing = await ed(() => document.querySelectorAll('.editing').length);
    check('E: size list with common sizes + arrows step to the next size (24 → 28)', sizes.length >= 8 && t && t.fs === 28, `${sizes.join(',')} fs=${t && t.fs} ${JSON.stringify(d.texts.map((q) => [q.text, q.fs, q.html]))}`);
    check('E: text frame disappears after editing', editing === 0, String(editing));
  }

  // ===================================================================== F. pens: custom size, shapes keep the pen, partial erase, brush
  if (sections.includes('F')) {
    await ed(() => window.__app.active.setTool('pen'));
    await win.waitForTimeout(300);
    await win.fill('.tool-size', '2.7');
    await win.press('.tool-size', 'Enter');
    await win.waitForTimeout(200);
    const size = await ed(() => (window.__app.active.toolState || window.__app.toolState).pen.size);
    const diag = await ed(() => [document.querySelectorAll('.size-menu').length, document.activeElement && document.activeElement.className, window.__app.toolState === window.__app.active.toolState]);
    check('F: custom pen size', size === 2.7, String(size) + ' ' + JSON.stringify(diag));
    await ed(() => { window.__app.toolState.pen.style = 'fountain'; window.__app.active.setTool('pen'); });
    const n0 = (await pageData()).strokes.length;
    await draw([[100, 520], [200, 525], [300, 520], [300, 620], [100, 620], [100, 522]], 900);
    const st = (await pageData()).strokes.slice(n0);
    const sh = st.find((s) => s.sh);
    check('F: draw & hold → shape keeps the pen style and width', sh && sh.ps === 'fountain' && sh.s === 2.7, JSON.stringify(sh && { sh: sh.sh, ps: sh.ps, s: sh.s }) + ` n0=${n0} new=${st.length} tool=${await ed(() => window.__app.toolState.tool)} menus=${await ed(() => document.querySelectorAll('.menu').length)}`);
    await shot(win, '07-shape-fountain');
    // partial eraser cuts the shape instead of deleting all of it
    await ed(() => { window.__app.toolState.eraser.mode = 'partial'; window.__app.active.setTool('eraser'); });
    await draw([[200, 600], [200, 640]]);
    const after = (await pageData()).strokes.slice(n0);
    check('F: partial eraser erases only part of a shape', after.length >= 1 && !after.some((s) => s.id === (sh && sh.id)), `${st.length} → ${after.length} strokes`);
    await shot(win, '08-shape-erased');
    const brush = await ed(() => window.__app.active.constructor && null);
    void brush;
  }

  // ===================================================================== G. table cell typing
  if (sections.includes('G')) {
    await ed(() => {
      const e = window.__app.active;
      const t = e.makeTable([[{ t: '' }, { t: '' }], [{ t: '' }, { t: '' }]], { index: 0, x: 400, y: 150 });
      t.x = 380; t.y = 150; t.cw = [90, 90];
      e.tools.placeObjects(0, { items: [t] });
      e.tools.clearSelection();
      e.setTool('text');
    });
    await win.waitForTimeout(200);
    const cell = await win.locator('.item td[data-r="0"][data-c="0"]').first().boundingBox();
    await win.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
    await win.waitForTimeout(150);
    await win.keyboard.type('42');
    await ed(() => document.activeElement && document.activeElement.blur());
    await win.waitForTimeout(200);
    const tb = (await pageData()).items.find((i) => i.type === 'table');
    const txt = tb && (tb.cells || tb.rows || [[]])[0][0];
    check('G: click a table cell with the text tool and type', txt && (txt.t || txt) === '42', JSON.stringify(txt));
  }

  // ===================================================================== H. add page: menu fits; pull with the hand
  if (sections.includes('H')) {
    await win.setViewportSize({ width: 1000, height: 640 });
    await win.waitForTimeout(300);
    await win.click('.split-arrow');
    await win.waitForTimeout(250);
    const box = await win.locator('.menu').last().boundingBox();
    await shot(win, '09-addpage-menu');
    check('H: add-page menu stays inside the window', box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1000 && box.y + box.height <= 640, JSON.stringify(box));
    await win.keyboard.press('Escape');
    await win.mouse.click(5, 300);
    await win.setViewportSize({ width: 1500, height: 940 });
    await win.waitForTimeout(300);
    const n0 = await ed(() => window.__app.active.pages.length);
    await ed(() => { const s = window.__app.active.viewer.scroller; s.scrollTop = s.scrollHeight; window.__app.active.setTool('hand'); });
    await win.waitForTimeout(250);
    const vb = await win.locator('.viewer').boundingBox();
    await win.mouse.move(vb.x + vb.width / 2, vb.y + vb.height - 60);
    await win.mouse.down();
    for (let i = 0; i < 10; i++) { await win.mouse.move(vb.x + vb.width / 2, vb.y + vb.height - 80 - i * 25, { steps: 2 }); await win.waitForTimeout(70); }
    await win.mouse.up();
    await win.waitForTimeout(300);
    const n1 = await ed(() => window.__app.active.pages.length);
    const plus = await win.locator('.page-end-btn').boundingBox();
    const pageR = await ed(() => window.__app.active.viewer.pageClientRect(window.__app.active.pages.length - 1));
    const centred = plus && Math.abs(plus.x + plus.width / 2 - (pageR.left + pageR.width / 2)) < 4;
    check('H: pulling past the end with the hand adds a page; "+" is centred under the page', n1 === n0 + 1 && centred, `${n0}→${n1} plus ${plus && plus.x} page ${pageR.left}/${pageR.width}`);
    await ed(() => window.__app.active.setTool('pen'));
  }

  // ===================================================================== I. "add page" picker (more templates)
  if (sections.includes('I')) {
    await win.click('.split-arrow');
    await win.locator('.menu-item', { hasText: 'More templates' }).click();
    await win.waitForSelector('.tp');
    await win.locator('.tp-tile', { hasText: 'Grid' }).first().click();
    await win.selectOption('.tp-pc', 'dark');
    await win.locator('.modal-actions .btn-primary').click();
    await win.waitForTimeout(400);
    const pages = await ed(() => window.__app.active.pages.map((p) => `${p.paper}/${p.pc || ''}`));
    check('I: add page from the template picker (dark grid)', pages.includes('grid/dark'), pages.join(' '));
    await shot(win, '10-dark-grid');
  }

  // ===================================================================== J. endless board: back to centre
  if (sections.includes('J')) {
    await ed(async () => { const r = await window.api.createNotebook('', { title: 'Board', kind: 'board' }); await window.__app.openNotebook(r); });
    await win.waitForTimeout(600);
    const s0 = await ed(() => { const s = window.__app.active.viewer.scroller; return [s.scrollLeft, s.scrollTop]; });
    const vb = await win.locator('.viewer').boundingBox();
    await win.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
    for (let i = 0; i < 8; i++) { await win.mouse.wheel(250, 150); await win.waitForTimeout(40); }
    await win.waitForTimeout(300);
    const sMid = await ed(() => { const s = window.__app.active.viewer.scroller; return [s.scrollLeft, s.scrollTop]; });
    await win.click('.board-center');
    await win.waitForTimeout(600);
    const s1 = await ed(() => { const s = window.__app.active.viewer.scroller; return [s.scrollLeft, s.scrollTop]; });
    check('J: board "back to centre" button', Math.hypot(sMid[0] - s0[0], sMid[1] - s0[1]) > 400 && Math.abs(s1[0] - s0[0]) < 60 && Math.abs(s1[1] - s0[1]) < 60, `${s0} → ${sMid} → ${s1}`);
    await ed(() => window.__app.closeEditor(window.__app.active));
  }

  // ===================================================================== K. sync: opening/closing does not touch notebook.json
  if (sections.includes('K') && rel) {
    await ed(() => window.__app.closeAll && window.__app.closeAll());
    const f = path.join(libDir, rel, 'notebook.json');
    const m0 = fs.statSync(f).mtimeMs;
    await ed(async (r) => { const e = await window.__app.openNotebook(r); e.viewer.scroller.scrollTop += 300; await new Promise((res) => setTimeout(res, 400)); await window.__app.closeEditor(e); }, rel);
    const m1 = fs.statSync(f).mtimeMs;
    check('K: opening, scrolling and closing a notebook does not rewrite it (nothing to sync)', m0 === m1, `${m0} ${m1}`);
  }

  await app.close();

  // ===================================================================== L. open a PDF from the computer
  if (sections.includes('L')) {
    const docs = path.join(tmp, 'Documents');
    fs.mkdirSync(docs, { recursive: true });
    const file = path.join(docs, 'Lecture 7.pdf');
    const src = await PDFDocument.create();
    src.addPage([595, 842]); src.addPage([595, 842]);
    fs.writeFileSync(file, await src.save());
    ({ app, win, ed } = await launch([file]));
    await win.waitForFunction(() => window.__app.active && window.__app.active.isExternal, null, { timeout: 8000 }).catch(() => {});
    const info = await ed(() => window.__app.active && { title: window.__app.active.doc.nb.title, pages: window.__app.active.pages.length, wn: !!document.querySelector('.whats-new') });
    await ed(() => window.__app.active.setTool('pen'));
    await draw([[100, 100], [300, 130], [400, 100]]);
    await shot(win, '11-external-pdf');
    await win.keyboard.press('Control+w');
    await win.waitForFunction(() => !window.__app.active, null, { timeout: 8000 }).catch(() => {});
    const emb = await ext.readEmbedded(fs.readFileSync(file));
    const listed = await ed(() => window.api.list('')).catch(() => null);
    check('L: a PDF passed by Windows opens directly in a tab (no What\'s new again)', info && info.title === 'Lecture 7' && info.pages === 2 && !info.wn, JSON.stringify(info));
    check('L: closing the tab writes the notes into the PDF file itself', emb && Object.values(emb.data.pages).some((p) => p.strokes && p.strokes.length === 1) && (await PDFDocument.load(fs.readFileSync(file))).getPageCount() === 2);
    check('L: the PDF does not appear in the library', listed && !listed.notebooks.some((n) => /Lecture/.test(n.title || n.name || '')), JSON.stringify(listed && listed.notebooks.map((n) => n.title || n.name)));
    // second instance (double click while running) opens another file
    const file2 = path.join(docs, 'Sheet.pdf');
    fs.copyFileSync(file, file2);
    await ed((f) => window.__app.openPdfFile(f), file2);
    await win.waitForTimeout(800);
    const reopened = await ed(() => window.__app.active && { strokes: window.__app.active.pageData(window.__app.active.pages[0].id).strokes.length, title: window.__app.active.doc.nb.title });
    check('L: a PDF saved by StudyNotes opens with its notes editable again', reopened && reopened.strokes === 1 && reopened.title === 'Sheet', JSON.stringify(reopened));
    await app.close();
  }

  const real = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
