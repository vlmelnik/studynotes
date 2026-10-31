// End-to-end checks for v1.6.1 through the real UI.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v161.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, { recursive: true });
const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const packaged = !!process.env.STUDYNOTES_EXE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v161-'));
const errors = [];
const shot = (win, name) => win.screenshot({ path: path.join(out, `v161-${name}.png`) });

async function launch() {
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: [...(packaged ? [] : [root]), '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: path.join(tmp, 'Library'), STUDYNOTES_USERDATA: path.join(tmp, 'u') },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app);
  return { app, win, ed: (fn, arg) => win.evaluate(fn, arg) };
}


(async () => {
  const sections = (process.env.ONLY || 'A,B,C,D,E,F,G').split(',');
  let { app, win, ed } = await launch();
  const rel = await ed(async () => { const r = await window.api.createNotebook('', { title: 'v161', paper: 'blank', pageCount: 4 }); await window.__app.openNotebook(r); return r; });
  await win.waitForTimeout(600);
  const pageData = () => ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });
  const setData = (d) => ed((d) => { const e = window.__app.active; e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [], ...d }); }, d);
  const at = async (x, y, page = 0) => {
    const r = await ed((p) => window.__app.active.viewer.pageClientRect(p), page);
    const z = await ed(() => window.__app.active.viewer.zoom);
    return [r.left + x * z, r.top + y * z];
  };
  const draw = async (pts, opt = {}) => {
    const [x0, y0] = await at(...pts[0]);
    await win.mouse.move(x0, y0); await win.mouse.down();
    for (const p of pts.slice(1)) { const [x, y] = await at(...p); await win.mouse.move(x, y, { steps: opt.steps || 4 }); }
    await win.mouse.up();
    await win.waitForTimeout(150);
  };
  const pen = (type, x, y, o) => ed(([t, cx, cy, oo]) => {
    const target = document.elementFromPoint(cx, cy);
    target.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerId: 9, isPrimary: true, pointerType: 'pen', clientX: cx, clientY: cy, ...oo }));
  }, [type, x, y, o]);
  const key = (init) => ed((i) => {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...i });
    if (i.keyCode != null) Object.defineProperty(ev, 'keyCode', { get: () => i.keyCode });
    document.body.dispatchEvent(ev);
  }, init);

  // ===================================================================== A. reopen at the same page and zoom
  if (sections.includes('A')) {
    await ed(() => window.__app.active.viewer.zoomTo(1.7, undefined, undefined, false));
    await win.waitForTimeout(300);
    await ed(() => window.__app.active.viewer.scrollToPage(2));
    await win.waitForTimeout(500);
    const before = await ed(() => ({ z: window.__app.active.viewer.zoom, i: window.__app.active.viewer.currentIndex }));
    await ed(() => window.__app.closeEditor(window.__app.active));
    await win.waitForTimeout(400);
    await ed((r) => window.__app.openNotebook(r), rel);
    await win.waitForTimeout(1000);
    let after = await ed(() => ({ z: window.__app.active.viewer.zoom, i: window.__app.active.viewer.currentIndex }));
    check('A: a notebook reopens at the same page and zoom', Math.abs(after.z - before.z) < 0.01 && after.i === before.i, JSON.stringify({ before, after }));
    // a notebook in a background tab keeps its view when the app closes
    const rel2 = await ed(async () => { const r = await window.api.createNotebook('', { title: 'other', paper: 'blank', pageCount: 2 }); await window.__app.openNotebook(r); return r; });
    await win.waitForTimeout(500);
    void rel2;
    // also after restarting the app
    // closing the window the normal way (X), with the first notebook in a background tab
    await ed(() => { window.__app.onWindowClose(); }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    await app.close().catch(() => {});
    ({ app, win, ed } = await launch());
    await ed((r) => window.__app.openNotebook(r), rel);
    await win.waitForTimeout(1000);
    after = await ed(() => ({ z: window.__app.active.viewer.zoom, i: window.__app.active.viewer.currentIndex }));
    check('A: … also after restarting the app', Math.abs(after.z - before.z) < 0.01 && after.i === before.i, JSON.stringify({ before, after }));
    await ed(() => { const v = window.__app.active.viewer; v.fitWidth(); v.scrollToPage(0); });
    await win.waitForTimeout(300);
  }

  // ===================================================================== B. undo from tablet buttons / keyboard layouts
  if (sections.includes('B')) {
    await setData({});
    await ed(() => { window.__app.toolState.pen.style = 'ball'; window.__app.active.setTool('pen'); });
    const count = async () => (await pageData()).strokes.length;
    // Russian layout, key sent by a tablet driver: no key name, no code – only Windows' key code
    await draw([[100, 100], [200, 120]]);
    await key({ key: 'я', code: '', keyCode: 90, ctrlKey: true });
    const ru = await count();
    // learn the tablet button in Settings: it arrives as Ctrl+Y (German layout)
    await ed(() => window.__app.showSettings());
    await win.locator('.modal .btn', { hasText: 'Set…' }).first().click();
    await key({ key: 'y', code: 'KeyZ', keyCode: 89, ctrlKey: true });
    const shown = await win.locator('.modal .tk-val').first().textContent();
    await win.locator('.modal-actions .btn', { hasText: 'Done' }).click();
    await draw([[100, 150], [200, 170]]);
    await key({ key: 'y', code: 'KeyZ', keyCode: 89, ctrlKey: true });
    const learned = await count();
    check('B: tablet button: Russian layout undoes; a learned button (arrives as Ctrl+Y) undoes', ru === 0 && learned === 0 && shown === 'Ctrl+Y', JSON.stringify({ ru, learned, shown }));
    await ed(() => { delete window.__app.settings.tabletKeys; });
  }

  // ===================================================================== C. scribble also erases text (setting, off by default)
  if (sections.includes('C')) {
    const zig = [[95, 205]];
    for (let i = 1; i <= 12; i++) zig.push([95 + i * 6, i % 2 ? 215 : 190]);
    const box = { id: 'tx', x: 100, y: 195, w: 60, fs: 12, c: '#000', text: 'note' };
    await setData({ texts: [box], strokes: [{ id: 'k', t: 'pen', c: '#000', s: 2, p: [100, 500, 0.5, 300, 500, 0.5] }] });
    await ed(() => { window.__app.toolState.pen.style = 'ball'; window.__app.active.setTool('pen'); });
    await draw(zig, { steps: 2 });
    const off = await pageData();
    await setData({ texts: [box], strokes: [{ id: 'k', t: 'pen', c: '#000', s: 2, p: [100, 500, 0.5, 300, 500, 0.5] }] });
    await ed(() => { window.__app.settings.scribbleText = true; });
    await draw(zig, { steps: 2 });
    const on = await pageData();
    await ed(() => { window.__app.settings.scribbleText = false; });
    check('C: scribbling erases a text box only with "Scribbling also erases text"', off.texts.length === 1 && on.texts.length === 0 && on.strokes.length === 1,
      JSON.stringify({ off: [off.texts.length, off.strokes.length], on: [on.texts.length, on.strokes.length] }));
  }

  // ===================================================================== D. text box frame = real text height
  if (sections.includes('D')) {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    await setData({ texts: [{ id: 'big', x: 80, y: 80, w: 400, fs: 14, c: '#000', text: long, h: 40, lines: 2 }] });
    await win.waitForTimeout(300);
    // narrower box (like dragging its side): many more lines
    await ed(() => { const e = window.__app.active, id = e.pages[0].id, d = e.pageData(id); e.commit(id, d, { ...d, texts: d.texts.map((t) => ({ ...t, w: 120, aw: false })) }); });
    await win.waitForTimeout(400);
    await ed(() => { const e = window.__app.active; e.setTool('select'); e.tools.select(0, e.pages[0].id, new Set(), new Set(['big'])); });
    await win.waitForTimeout(300);
    const m = await ed(() => {
      const el = document.querySelector('.textbox[data-id="big"]');
      const frame = document.querySelector('.sel-box, .selection-box, .sel-frame');
      const t = window.__app.active.pageData(window.__app.active.pages[0].id).texts[0];
      return { dom: el.offsetHeight, h: t.h, frame: frame ? frame.getBoundingClientRect().height / window.__app.active.viewer.zoom : null, tb: el.getBoundingClientRect().height / window.__app.active.viewer.zoom };
    });
    check('D: the frame follows the real text height after the width changes', Math.abs(m.h - m.dom) < 1 && (m.frame == null || Math.abs(m.frame - m.tb) < 16), JSON.stringify(m));
    const side = await ed(() => { const r = document.querySelector('.textbox-wrap[data-id="big"] .tb-handle.resize.right').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    check('D: the side handle can be grabbed along the whole side', side.h > 100 && side.w >= 10, JSON.stringify(side));
    await ed(() => window.__app.active.tools.clearSelection());
  }

  // ===================================================================== E. mouse wheel over a size field
  if (sections.includes('E')) {
    await ed(() => { window.__app.toolState.pen.size = 2; window.__app.active.setTool('pen'); });
    await win.waitForTimeout(200);
    const ctl = win.locator('.tool-size').first().locator('xpath=..');
    const r = await ctl.boundingBox();
    await win.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await win.mouse.wheel(0, -100); await win.waitForTimeout(100);
    await win.mouse.wheel(0, -100); await win.waitForTimeout(100);
    const up = await ed(() => window.__app.toolState.pen.size);
    await win.mouse.wheel(0, 100); await win.waitForTimeout(100);
    const down = await ed(() => window.__app.toolState.pen.size);
    check('E: mouse wheel over the size field changes the size', up > 2 && down < up, JSON.stringify({ up, down }));
  }

  // ===================================================================== F. pen eraser state (Windows Ink "Erase" button)
  if (sections.includes('F')) {
    await setData({ strokes: [{ id: 'l1', t: 'pen', c: '#000', s: 2, p: [100, 300, 0.5, 400, 300, 0.5] }] });
    await ed(() => window.__app.active.setTool('pen'));
    let [x, y] = await at(150, 200);
    await pen('pointermove', x, y, { buttons: 0, button: -1, pressure: 0 });
    await pen('pointermove', x, y, { buttons: 1, button: -1, pressure: 0.42 }); // the app learns: this pen has pressure
    // eraser touches: buttons 32, and some drivers report pressure 0 for it
    [x, y] = await at(250, 260);
    await pen('pointerdown', x, y, { buttons: 32, button: 5, pressure: 0 });
    for (let i = 1; i <= 10; i++) { [x, y] = await at(250, 260 + i * 8); await pen('pointermove', x, y, { buttons: 32, button: -1, pressure: 0 }); }
    await pen('pointerup', x, y, { buttons: 0, button: 5, pressure: 0 });
    const a = (await pageData()).strokes.length;
    // eraser arrives as a new pointer while a line is being drawn
    await setData({ strokes: [{ id: 'l2', t: 'pen', c: '#000', s: 2, p: [100, 300, 0.5, 400, 300, 0.5] }] });
    [x, y] = await at(150, 250);
    await pen('pointerdown', x, y, { buttons: 1, button: 0, pressure: 0.5, pointerId: 11 });
    await pen('pointermove', x + 5, y + 5, { buttons: 1, button: -1, pressure: 0.5, pointerId: 11 });
    [x, y] = await at(300, 260);
    await pen('pointerdown', x, y, { buttons: 32, button: 5, pressure: 0.4, pointerId: 12 });
    for (let i = 1; i <= 10; i++) { [x, y] = await at(300, 260 + i * 8); await pen('pointermove', x, y, { buttons: 32, button: -1, pressure: 0.4, pointerId: 12 }); }
    await pen('pointerup', x, y, { buttons: 0, button: 5, pressure: 0, pointerId: 12 });
    const d2 = await pageData();
    const pieces = d2.strokes.filter((s) => s.id !== 'l2' && s.p.length >= 6 && Math.abs(s.p[1] - 300) < 1).length + d2.strokes.filter((s) => s.id === 'l2').length;
    check('F: pen eraser erases (pressure 0 / as a new pointer while drawing)', a === 2 && pieces === 2, JSON.stringify({ a, strokes: d2.strokes.map((s) => s.id + ':' + s.p.length) }));
  }

  // ===================================================================== G. drawing: the line never changes after it is drawn
  if (sections.includes('G')) {
    await setData({});
    await ed(() => { window.__app.toolState.pen.style = 'ball'; window.__app.toolState.pen.size = 3; window.__app.active.setTool('pen'); });
    // a curl drawn with the pen (pressure varies, eases off at the end)
    const pts = [];
    for (let i = 0; i <= 50; i++) { const t = i / 50; pts.push([200 + 30 * Math.cos(t * 7) + t * 60, 300 + 25 * Math.sin(t * 7), i > 44 ? 0.5 - (i - 44) * 0.08 : 0.5 + 0.2 * Math.sin(t * 9)]); }
    let [x, y] = await at(pts[0][0], pts[0][1]);
    await pen('pointerdown', x, y, { buttons: 1, button: 0, pressure: pts[0][2], pointerId: 21 });
    const snaps = [];
    for (let i = 1; i < pts.length; i++) {
      [x, y] = await at(pts[i][0], pts[i][1]);
      await pen('pointermove', x, y, { buttons: 1, button: -1, pressure: pts[i][2], pointerId: 21 });
      if (i === 25) { await win.waitForTimeout(60); snaps.push(await ed(() => { const c = window.__app.active.tools.cur; return c && JSON.parse(JSON.stringify(c.st)); })); }
    }
    await pen('pointerup', x, y, { buttons: 0, button: 0, pressure: 0, pointerId: 21 });
    await win.waitForTimeout(200);
    const fin = (await pageData()).strokes[0];
    const mid = snaps[0];
    let same = !!mid && !!fin;
    if (same) for (let i = 0; i < mid.p.length - 6; i++) if (Math.abs(mid.p[i] - fin.p[i]) > 1e-9) { same = false; break; }
    // the end of the line keeps its width (no thin tail)
    const n = fin.p.length / 3, endP = fin.p[fin.p.length - 1], midP = fin.p[Math.floor(n / 2) * 3 + 2];
    check('G: what is drawn stays exactly as drawn; no pressure use flip; no thin tail', same && mid.np === fin.np && endP > midP * 0.45, JSON.stringify({ same, np: [mid && mid.np, fin.np], endP, midP }));
    // pencil and a few quick small letters for the eye
    await ed(() => { window.__app.toolState.pen.style = 'pencil'; window.__app.toolState.pen.size = 4; window.__app.active.setTool('pen'); });
    const wave = []; for (let i = 0; i <= 40; i++) wave.push([150 + i * 5, 352 + 8 * Math.sin(i / 4), 0.5 + 0.3 * Math.sin(i / 7)]);
    [x, y] = await at(wave[0][0], wave[0][1]);
    await pen('pointerdown', x, y, { buttons: 1, button: 0, pressure: 0.5, pointerId: 22 });
    for (const q of wave.slice(1)) { [x, y] = await at(q[0], q[1]); await pen('pointermove', x, y, { buttons: 1, button: -1, pressure: q[2], pointerId: 22 }); }
    await pen('pointerup', x, y, { buttons: 0, button: 0, pressure: 0, pointerId: 22 });
    await ed(() => { window.__app.toolState.pen.style = 'ball'; window.__app.toolState.pen.size = 2; });
    await win.waitForTimeout(300);
    { const q = (await pageData()).strokes[0].p; const turns = []; for (let i = 3; i + 3 < q.length; i += 3) { const a = Math.atan2(q[i + 1] - q[i - 2], q[i] - q[i - 3]), b = Math.atan2(q[i + 4] - q[i + 1], q[i + 3] - q[i]); let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d; if (d > 0.5) turns.push([i / 3, q[i], q[i + 1], +d.toFixed(2)]); } check('G: uneven tablet timing does not bend the line (no kinks)', turns.length === 0, JSON.stringify(turns)); }
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const z = await ed(() => window.__app.active.viewer.zoom);
    await win.screenshot({ path: path.join(out, 'v161-curl.png'), clip: { x: r.left + 140 * z, y: r.top + 260 * z, width: 230 * z, height: 105 * z } });
  }

  await app.close();
  const real = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
