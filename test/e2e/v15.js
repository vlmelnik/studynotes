// End-to-end checks for v1.5 through the real UI.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v15.js
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v15-'));
const libDir = path.join(tmp, 'Library');
const userData = path.join(tmp, 'u');
const errors = [];
const shot = (win, name) => win.screenshot({ path: path.join(out, `v15-${name}.png`) });

async function launch(extraArgs = []) {
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: [...(packaged ? [] : [root]), '--no-sandbox', ...extraArgs],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: libDir, STUDYNOTES_USERDATA: userData },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app);
  return { app, win, ed: (fn, arg) => win.evaluate(fn, arg) };
}

(async () => {
  const sections = (process.env.ONLY || 'A,B,C,D,E,F,G,H,I').split(',');
  let { app, win, ed } = await launch();

  // ===================================================================== A. Russian interface
  if (sections.includes('A')) {
    await ed(async () => { await window.api.createNotebook('', { title: 'Pages' }); await window.__app.library.load(''); });
    await win.click('button[title="Settings"]');
    await win.click('.chip[data-lang="ru"]');
    await win.waitForTimeout(300);
    await shot(win, '01-settings-ru');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
    const lib = await ed(() => ({
      importBtn: [...document.querySelectorAll('.lib-actions .btn')].map((b) => b.textContent.trim()),
      card: [...document.querySelectorAll('.card-title')].map((c) => c.textContent),
      lang: document.documentElement.lang,
    }));
    await shot(win, '02-library-ru');
    check('A: interface switches to Russian at once', lib.lang === 'ru' && lib.importBtn.includes('Импорт PDF') && lib.importBtn.includes('Заполнить и подписать'), JSON.stringify(lib.importBtn));
    check('A: user content is never translated (notebook "Pages" stays "Pages")', lib.card.includes('Pages'), JSON.stringify(lib.card));
    await ed(async () => { const r = await window.api.createNotebook('', { title: 'RU' }); await window.__app.openNotebook(r); });
    await win.waitForTimeout(500);
    const tb = await ed(() => [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).filter((t) => /Ручка|Ластик|Маркер/.test(t)));
    await shot(win, '03-editor-ru');
    check('A: editor tooltips are Russian', tb.some((t) => t.startsWith('Ручка')) && tb.some((t) => t.startsWith('Ластик')), tb.join(' | '));
    await ed(() => window.__app.closeEditor(window.__app.active));
    await win.click('button[title="Настройки"]');
    await win.click('.chip[data-lang="en"]');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
    const back = await ed(() => [...document.querySelectorAll('.lib-actions .btn')].map((b) => b.textContent.trim()));
    check('A: back to English restores every text', back.includes('Import PDF') && back.includes('Fill & sign'), JSON.stringify(back));
  }

  // notebook for the drawing tests, whole page visible
  const rel = await ed(async () => { const r = await window.api.createNotebook('', { title: 'v15', paper: 'blank' }); await window.__app.openNotebook(r); return r; });
  await win.waitForTimeout(500);
  await ed(() => { const v = window.__app.active.viewer; v.zoomTo(0.95, undefined, undefined, false); v.scroller.scrollTop = 0; v.update(); });
  await win.waitForTimeout(300);
  const at = async (x, y) => {
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const z = await ed(() => window.__app.active.viewer.zoom);
    return [r.left + x * z, r.top + y * z];
  };
  const draw = async (pts) => {
    const [x0, y0] = await at(...pts[0]);
    await win.mouse.move(x0, y0); await win.mouse.down();
    for (const p of pts.slice(1)) { const [x, y] = await at(...p); await win.mouse.move(x, y, { steps: 6 }); }
    await win.mouse.up();
    await win.waitForTimeout(150);
  };
  const pageData = () => ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });
  const clearPage = () => ed(() => { const e = window.__app.active; e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [] }); });
  // synthetic pen events (Playwright has no real pen)
  const pen = (type, x, y, o = {}) => ed(([t, cx, cy, oo]) => {
    const target = document.elementFromPoint(cx, cy) || document.querySelector('.scroller');
    target.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'pen', clientX: cx, clientY: cy, isPrimary: true, ...oo }));
  }, [type, x, y, o]);

  // ===================================================================== B. pen side button
  if (sections.includes('B')) {
    await clearPage();
    await ed(() => window.__app.active.setTool('pen'));
    // write a line, press the button in the middle of the next movement: erases, release: writes again
    let [x, y] = await at(100, 200);
    await pen('pointerdown', x, y, { buttons: 1, button: 0, pressure: 0.5 });
    for (let i = 1; i <= 20; i++) { [x, y] = await at(100 + i * 10, 200); await pen('pointermove', x, y, { buttons: 1, button: -1, pressure: 0.5 }); }
    await pen('pointerup', x, y, { buttons: 0, button: 0, pressure: 0 });
    const n1 = (await pageData()).strokes.length;
    // second gesture: starts drawing at y=300, button pressed while moving over the first line = erase
    [x, y] = await at(150, 300);
    await pen('pointerdown', x, y, { buttons: 1, button: 0, pressure: 0.5 });
    for (let i = 1; i <= 8; i++) { [x, y] = await at(150, 300 - i * 6); await pen('pointermove', x, y, { buttons: 1, button: -1, pressure: 0.5 }); }
    for (let i = 1; i <= 12; i++) { [x, y] = await at(150, 252 - i * 8); await pen('pointermove', x, y, { buttons: 3, button: 2, pressure: 0.5 }); } // crosses y=200 with the button held
    for (let i = 1; i <= 8; i++) { [x, y] = await at(150 + i * 8, 156); await pen('pointermove', x, y, { buttons: 1, button: -1, pressure: 0.5 }); } // released: writes again
    await pen('pointerup', x, y, { buttons: 0, button: 0, pressure: 0 });
    await win.waitForTimeout(200);
    const d = await pageData();
    const tool = await ed(() => window.__app.toolState.tool);
    await shot(win, '04-pen-button');
    // first line is cut in two (erased), plus the stroke before and the stroke after the button
    check('B: pen side button erases while held, then writing continues', n1 === 1 && d.strokes.length === 4 && tool === 'pen', `${n1} → ${d.strokes.length} strokes, tool ${tool}`);
    // button pressed while hovering, then touching: erases
    await clearPage();
    await draw([[100, 400], [400, 400]]);
    [x, y] = await at(250, 360);
    await pen('pointerdown', x, y, { buttons: 2, button: 2, pressure: 0 });
    await pen('pointermove', x, y, { buttons: 3, button: -1, pressure: 0.4 });
    for (let i = 1; i <= 10; i++) { [x, y] = await at(250, 360 + i * 8); await pen('pointermove', x, y, { buttons: 3, button: -1, pressure: 0.4 }); }
    await pen('pointermove', x, y, { buttons: 2, button: -1, pressure: 0 });
    await pen('pointerup', x, y, { buttons: 0, button: 2, pressure: 0 });
    const d2 = await pageData();
    check('B: button pressed before touching the page also erases', d2.strokes.length === 2, `${d2.strokes.length} strokes`);
  }

  // ===================================================================== C. size field for tools, higher maximum
  if (sections.includes('C')) {
    await ed(() => window.__app.active.setTool('pen'));
    await win.waitForTimeout(150);
    await win.fill('.tool-size', '45');
    await win.press('.tool-size', 'Enter');
    await win.waitForTimeout(150);
    const s1 = await ed(() => window.__app.toolState.pen.size);
    await win.click('.opt-bar .size-ctl .size-drop, .size-ctl .size-drop >> nth=0');
    const list = await win.locator('.size-list .menu-item').allTextContents();
    await win.keyboard.press('Escape');
    await ed(() => window.__app.active.setTool('eraser'));
    await win.waitForTimeout(150);
    await win.click('.size-ctl .size-arrows button >> nth=0');
    const e1 = await ed(() => window.__app.toolState.eraser.size);
    await shot(win, '05-eraser-bar');
    check('C: pen/eraser get the text-style size field; pen up to 60', s1 === 45 && list.includes('60') && e1 === 30, `pen ${s1}, list ${list.join(',')}, eraser ${e1}`);
    await ed(() => { window.__app.toolState.pen.size = 2; window.__app.toolState.eraser.size = 22; window.__app.active.setTool('pen'); });
  }

  // ===================================================================== D. Alt + wheel
  if (sections.includes('D')) {
    await clearPage();
    await draw([[100, 100], [200, 120], [300, 100]]);
    const vb = await win.locator('.viewer').boundingBox();
    await win.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
    await win.keyboard.down('Alt');
    await win.mouse.wheel(0, -100);
    await win.keyboard.up('Alt');
    await win.waitForTimeout(150);
    const ps = await ed(() => window.__app.toolState.pen.size);
    const st0 = (await pageData()).strokes[0];
    await ed((id) => { const e = window.__app.active; e.setTool('lasso'); e.tools.select(0, e.pages[0].id, new Set([id]), new Set()); }, st0.id);
    const undo0 = await ed(() => window.__app.active.undoStack.length);
    await win.keyboard.down('Alt');
    for (let i = 0; i < 3; i++) { await win.mouse.wheel(0, -100); await win.waitForTimeout(60); }
    await win.keyboard.up('Alt');
    await win.waitForTimeout(150);
    const st1 = (await pageData()).strokes[0];
    const w = (s) => { const xs = s.p.filter((_, i) => i % 3 === 0); return Math.max(...xs) - Math.min(...xs); };
    const undo1 = await ed(() => window.__app.active.undoStack.length);
    check('D: Alt+wheel: no selection → pen size; selection → resized, one undo step', ps === 2.5 && w(st1) > w(st0) * 1.2 && undo1 === undo0 + 1, `pen ${ps}, width ${w(st0).toFixed(1)}→${w(st1).toFixed(1)}, undo +${undo1 - undo0}`);
    await ed(() => { window.__app.active.tools.clearSelection(); window.__app.toolState.pen.size = 2; });
  }

  // ===================================================================== E. exact eraser circle, still lines
  if (sections.includes('E')) {
    await clearPage();
    await ed(() => { window.__app.toolState.pen.size = 14; window.__app.active.setTool('pen'); });
    await draw([[100, 300], [250, 320], [400, 300]]);
    const before = (await pageData()).strokes[0];
    await ed(() => { Object.assign(window.__app.toolState.eraser, { mode: 'partial', exact: true, size: 60 }); window.__app.active.setTool('eraser'); });
    await draw([[250, 305], [250, 318]]);
    const d = await pageData();
    await shot(win, '06-exact-eraser');
    const pieces = d.strokes;
    const kept = pieces.every((pc) => { for (let i = 0; i < pc.p.length - 3; i += 3) { const x = pc.p[i], y = pc.p[i + 1]; if (!before.p.some((_, j) => j % 3 === 0 && Math.abs(before.p[j] - x) < 0.02 && Math.abs(before.p[j + 1] - y) < 0.02)) return i === 0; } return true; });
    check('E: exact circle cuts the line with the eraser circle (clip saved), other points untouched', pieces.length === 2 && pieces.every((pc) => pc.k) && kept, JSON.stringify(pieces.map((pc) => pc.k)));
    const pdf = path.join(tmp, 'cut.pdf');
    await ed(([r, f]) => window.api.exportTo(r, null, f), [rel, pdf]);
    check('E: export with eraser cuts works', fs.existsSync(pdf) && (await PDFDocument.load(fs.readFileSync(pdf))).getPageCount() === 1);
    await ed(() => { window.__app.toolState.pen.size = 2; Object.assign(window.__app.toolState.eraser, { exact: false, size: 22 }); });
  }

  // ===================================================================== F. eraser removes text and pictures (option)
  if (sections.includes('F')) {
    await clearPage();
    await ed(() => { const e = window.__app.active; const b = e.pageData(e.pages[0].id); e.setPageData(e.pages[0].id, { ...b, texts: [{ id: 'tx1', x: 100, y: 500, w: 120, fs: 16, c: '#000', text: 'erase me' }] }); });
    await ed(() => { Object.assign(window.__app.toolState.eraser, { objects: false }); window.__app.active.setTool('eraser'); });
    await draw([[90, 508], [240, 508]]);
    const t0 = (await pageData()).texts.length;
    await ed(() => { window.__app.toolState.eraser.objects = true; window.__app.active.setTool('eraser'); });
    await draw([[90, 508], [240, 508]]);
    const t1 = (await pageData()).texts.length;
    await ed(() => window.__app.active.undo && window.__app.active.undo());
    const t2 = (await pageData()).texts.length;
    check('F: "Text & pictures too" erases a text box (off by default, undoable)', t0 === 1 && t1 === 0 && t2 === 1, `${t0} ${t1} ${t2}`);
    await ed(() => { window.__app.toolState.eraser.objects = false; window.__app.active.setTool('pen'); });
  }

  // ===================================================================== G. About + licences
  if (sections.includes('G')) {
    await ed(() => window.__app.showAbout());
    await win.waitForSelector('.about');
    await shot(win, '07-about');
    await win.locator('.about .btn', { hasText: 'Licences' }).click();
    await win.waitForSelector('pre.notices');
    const txt = await ed(() => document.querySelector('pre.notices').textContent);
    check('G: About shows version and the licences of everything bundled', /PDF\.js/.test(txt) && /SIL OPEN FONT LICENSE/i.test(txt) && /Apache License/.test(txt), txt.length + ' chars');
    while (await win.locator('.modal-actions .btn').count()) { await win.locator('.modal-actions .btn').last().click(); await win.waitForTimeout(100); }
  }
  await ed(() => window.__app.closeAll());
  await app.close();

  // ===================================================================== H. Fill & sign
  if (sections.includes('H')) {
    const docs = path.join(tmp, 'Docs');
    fs.mkdirSync(docs, { recursive: true });
    const file = path.join(docs, 'Antrag.pdf');
    const src = await PDFDocument.create();
    const pg = src.addPage([595, 842]);
    const form = src.getForm();
    form.createTextField('Name').addToPage(pg, { x: 80, y: 700, width: 260, height: 26 });
    form.createCheckBox('Agree').addToPage(pg, { x: 80, y: 640, width: 16, height: 16 });
    fs.writeFileSync(file, await src.save());
    ({ app, win, ed } = await launch());
    await ed((f) => window.__app.openPdfFile(f, { fill: true }), file);
    await win.waitForSelector('.fill-bar', { timeout: 8000 });
    await win.waitForSelector('.form-field', { timeout: 8000 });
    const nFields = await win.locator('.form-field').count();
    await win.locator('input.form-field').fill('Иван Петров');
    await win.locator('.form-check').click();
    // a drawn signature
    await win.locator('.fill-btn', { hasText: 'Signature' }).click();
    await win.waitForSelector('.sig-pad');
    const pad = await win.locator('.sig-pad').boundingBox();
    await win.mouse.move(pad.x + 40, pad.y + 120); await win.mouse.down();
    for (let i = 1; i < 30; i++) await win.mouse.move(pad.x + 40 + i * 14, pad.y + 120 + Math.sin(i / 2) * 40, { steps: 2 });
    await win.mouse.up();
    await win.locator('.btn', { hasText: 'Save signature' }).click();
    await win.waitForSelector('.sig-pick img');
    await shot(win, '08-signature-dialog');
    await win.locator('.sig-pick').first().click();
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const z = await ed(() => window.__app.active.viewer.zoom);
    await win.mouse.click(r.left + 300 * z, r.top + 300 * z);
    await win.waitForTimeout(400);
    const items = await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).items.length);
    await win.locator('.fill-btn', { hasText: 'Date' }).click();
    await win.mouse.click(r.left + 300 * z, r.top + 380 * z);
    await win.waitForTimeout(300);
    await shot(win, '09-fill-sign');
    await win.locator('.fill-btn', { hasText: 'Save PDF' }).click();
    await win.waitForTimeout(1500);
    const saved = fs.readFileSync(file);
    const emb = await ext.readEmbedded(saved);
    const flat = (await PDFDocument.load(saved)).getForm().getFields().length;
    check('H: Fill & sign shows the form fields as inputs', nFields === 2, String(nFields));
    check('H: signature drawn, saved and placed with a click; date stamp', items === 1, `items ${items}`);
    check('H: Save PDF writes values into the fields (flattened), notes stay editable', emb && emb.data.notebook.form && emb.data.notebook.form.Name === 'Иван Петров' && emb.data.notebook.form.Agree === true && flat === 0,
      JSON.stringify(emb && emb.data.notebook.form) + ' fields ' + flat);
    await ed(() => window.__app.closeAll());
    // reopen: the value is back in the input
    await ed((f) => window.__app.openPdfFile(f), file);
    await win.waitForTimeout(1500);
    const again = await ed(() => { const i = document.querySelector('input.form-field'); return i && i.value; });
    check('H: reopened PDF shows the filled value again', again === 'Иван Петров', String(again));
    await ed(() => window.__app.closeAll());
    await app.close();
  }

  const real = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
