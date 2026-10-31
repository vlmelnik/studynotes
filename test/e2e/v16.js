// End-to-end checks for v1.6 through the real UI.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v16.js
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v16-'));
const errors = [];
const shot = (win, name) => win.screenshot({ path: path.join(out, `v16-${name}.png`) });

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
  const sections = (process.env.ONLY || 'A,B,C,D,E,F,G,K,H,I,J').split(',');
  // a PDF with real text and a form field
  const pdfFile = path.join(tmp, 'Script.pdf');
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pg = doc.addPage([595, 842]);
    pg.drawText('The quick brown fox jumps over the lazy dog.', { x: 60, y: 760, size: 14, font });
    pg.drawText('Second line of printed text in this PDF.', { x: 60, y: 736, size: 14, font });
    doc.getForm().createTextField('Name').addToPage(pg, { x: 60, y: 600, width: 220, height: 24 });
    fs.writeFileSync(pdfFile, await doc.save());
  }
  let { app, win, ed } = await launch();
  const rel = await ed(async () => { const r = await window.api.createNotebook('', { title: 'v16', paper: 'blank', pageCount: 3 }); await window.__app.openNotebook(r); return r; });
  await win.waitForTimeout(500);
  const zoom1 = () => ed(() => { const v = window.__app.active.viewer; v.zoomTo(0.95, undefined, undefined, false); v.update(); });
  await zoom1();
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
  const pageData = (i = 0) => ed((k) => { const e = window.__app.active; return e.pageData(e.pages[k].id); }, i);
  const setData = (d, i = 0) => ed(([dd, k]) => { const e = window.__app.active; e.setPageData(e.pages[k].id, { strokes: [], texts: [], items: [], ...dd }); }, [d, i]);
  const closeDialogs = async () => { while (await win.locator('.modal-actions .btn').count()) { await win.locator('.modal-actions .btn').first().click(); await win.waitForTimeout(100); } };

  // ===================================================================== A. dialogs: Cancel works; delete page button
  if (sections.includes('A')) {
    await setData({ strokes: [{ id: 's1', t: 'pen', c: '#000', s: 2, p: [100, 100, 0.5, 200, 120, 0.5] }] });
    await ed(() => { window.__app.active.clearPage(); });
    await win.waitForSelector('.modal');
    await win.locator('.modal-actions .btn', { hasText: 'Cancel' }).click();
    await win.waitForTimeout(200);
    const open = await win.locator('.modal').count();
    const kept = (await pageData()).strokes.length;
    check('A: "Clear page" → Cancel closes the dialog and keeps the page', open === 0 && kept === 1, `dialogs ${open}, strokes ${kept}`);
    const n0 = await ed(() => window.__app.active.pages.length);
    await win.click('.bar-btn.page-del');
    await win.waitForTimeout(200);
    const n1 = await ed(() => window.__app.active.pages.length);
    await win.keyboard.press('Control+z');
    await win.waitForTimeout(200);
    const n2 = await ed(() => window.__app.active.pages.length);
    check('A: toolbar button deletes the current page at once; Ctrl+Z restores it', n1 === n0 - 1 && n2 === n0, `${n0} → ${n1} → ${n2}`);
  }

  // ===================================================================== B. paste with any tool, pasted object on top
  if (sections.includes('B')) {
    await setData({ texts: [{ id: 'a1', x: 100, y: 100, w: 300, fs: 14, c: '#000', text: 'Para one.\nPara two.\nPara three.' }] });
    await win.waitForTimeout(200);
    await ed(() => { const e = window.__app.active; e.setTool('text'); e.editText(e.pages[0].id, 'a1'); });
    await win.keyboard.press('Control+a'); await win.keyboard.press('Control+c');
    await ed(() => window.__app.active.finishEditing(true));
    const res = {};
    for (const tool of ['select', 'lasso', 'pen']) {
      await ed((t) => window.__app.active.setTool(t), tool);
      const [x, y] = await at(300, 400);
      await win.mouse.move(x, y);
      const before = (await pageData()).texts.length;
      await win.keyboard.press('Control+v');
      await win.waitForTimeout(300);
      res[tool] = (await pageData()).texts.length - before;
      await ed(() => window.__app.active.tools.clearSelection());
    }
    const d = await pageData();
    const last = d.texts[d.texts.length - 1];
    check('B: pasting text works with the select, lasso and pen tool', res.select === 1 && res.lasso === 1 && res.pen === 1, JSON.stringify(res));
    check('B: pasted object lies in the front layer, on top', last.lay === 'f' && typeof last.z === 'number' && d.texts.every((t) => t === last || !(t.z > last.z)), JSON.stringify({ lay: last.lay, z: last.z }));
  }

  // ===================================================================== C. text editing: paragraphs, exact selection, double-click word, box height
  if (sections.includes('C')) {
    await setData({ texts: [{ id: 't1', x: 80, y: 80, w: 380, fs: 14, c: '#000000', text: 'Alpha beta gamma.\nDelta red epsilon.\nZeta red eta theta.' }] });
    await win.waitForTimeout(200);
    await ed(() => { const e = window.__app.active; e.setTool('text'); e.editText(e.pages[0].id, 't1'); });
    // select the first "red" (line 2) and colour it
    await ed(() => {
      const el = document.querySelector('.textbox[data-id="t1"]');
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n; while ((n = tw.nextNode())) { const i = n.data.indexOf('red'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 3); const s = getSelection(); s.removeAllRanges(); s.addRange(r); break; } }
    });
    await ed(() => window.__app.active.applyTextStyle({ color: '#d62828' }));
    const selAfter = await ed(() => getSelection().toString());
    // second step: size of the still-selected word
    await ed(() => window.__app.active.applyTextStyle({ size: 20 }));
    await ed(() => window.__app.active.finishEditing(true));
    await win.waitForTimeout(200);
    const t = (await pageData()).texts.find((q) => q.id === 't1');
    const reds = (t.html.match(/data-c="#d62828"/g) || []).length;
    check('C: changing colour/size of one word keeps the paragraphs', t.text.split('\n').length === 3, JSON.stringify(t.text));
    check('C: only the selected word changes (selection stays exactly there)', selAfter === 'red' && reds === 1, `sel "${selAfter}", coloured spans ${reds}: ${t.html}`);
    // double-click a word with the select tool → that word is selected
    await ed(() => window.__app.active.setTool('select'));
    const box = await ed(() => { const el = document.querySelector('.textbox[data-id="t1"]'); const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) { const i = n.data.indexOf('gamma'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i + 1); r.setEnd(n, i + 2); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; } } return null; });
    await win.mouse.dblclick(box[0], box[1]);
    await win.waitForTimeout(250);
    const word = await ed(() => getSelection().toString());
    check('C: double-click selects the word, not everything', word === 'gamma', JSON.stringify(word));
    await ed(() => window.__app.active.finishEditing(true));
    // long pasted text: box height matches the wrapped text
    await setData({ texts: [{ id: 'lng', x: 80, y: 300, w: 160, fs: 14, c: '#000', text: 'word '.repeat(60).trim(), lines: 1 }] });
    await win.waitForTimeout(500);
    const lng = (await pageData()).texts[0];
    check('C: long text boxes get their real height (frame covers all text)', lng.lines > 5, `lines ${lng.lines}`);
  }

  // ===================================================================== D. format painter
  if (sections.includes('D')) {
    await setData({ texts: [
      { id: 'src', x: 80, y: 80, w: 200, fs: 22, c: '#2b9de9', b: true, ff: 'serif', text: 'Styled' },
      { id: 'dst', x: 80, y: 420, w: 200, fs: 12, c: '#000000', text: 'Plain text' },
    ] });
    await win.waitForTimeout(200);
    await ed(() => { const e = window.__app.active; e.setTool('select'); e.tools.select(0, e.pages[0].id, new Set(), new Set(['src'])); });
    await win.waitForSelector('.text-bar .tb-btn[title^="Format painter"]');
    await win.click('.text-bar .tb-btn[title^="Format painter"]');
    // like a person: the click that picks the style up must not paint it back
    // onto the source; the next click (on the other box) gets the style
    let src = (await pageData()).texts.find((q) => q.id === 'src');
    check('D: picking the style up leaves the source alone', src.fs === 22 && src.c === '#2b9de9');
    const r = await win.locator('.textbox[data-id="dst"]').boundingBox();
    await win.mouse.click(r.x + 20, r.y + r.height / 2);
    await win.waitForTimeout(300);
    const dst = (await pageData()).texts.find((q) => q.id === 'dst');
    check('D: format painter copies size, colour, font and bold', dst.fs === 22 && dst.c === '#2b9de9' && dst.ff === 'serif' && dst.b === true, JSON.stringify({ fs: dst.fs, c: dst.c, ff: dst.ff, b: dst.b }));
  }

  // ===================================================================== E. scribble to erase
  if (sections.includes('E')) {
    await setData({ strokes: [
      { id: 'w1', t: 'pen', c: '#000', s: 2, pf: 1, p: [100, 200, 0.5, 130, 190, 0.5, 160, 205, 0.5] },
      { id: 'keep', t: 'pen', c: '#000', s: 2, pf: 1, p: [100, 400, 0.5, 300, 400, 0.5] },
    ] });
    await ed(() => window.__app.active.setTool('pen'));
    const zig = [[95, 190]];
    for (let i = 1; i <= 12; i++) zig.push([95 + i * 6, i % 2 ? 210 : 188]);
    await draw(zig, { steps: 2 });
    const d = await pageData();
    if (d.strokes.length !== 1) { const sc = d.strokes[d.strokes.length - 1]; console.log('scribble pts', JSON.stringify(sc.p.filter((_, i) => i % 3 !== 2).map((v) => Math.round(v)))); }
    check('E: scribbling over handwriting erases it (other ink stays, scribble not kept)', d.strokes.length === 1 && d.strokes[0].id === 'keep', d.strokes.map((s) => s.id).join(','));
    // a zig-zag over empty paper stays as ink
    await draw([[100, 600], [110, 620], [120, 600], [130, 620], [140, 600], [150, 620], [160, 600], [170, 620]], { steps: 2 });
    check('E: a zig-zag on empty paper is normal ink', (await pageData()).strokes.length === 2);
  }

  // ===================================================================== F. dots and smoothing
  if (sections.includes('F')) {
    await setData({});
    await ed(() => { window.__app.toolState.pen.style = 'brush'; window.__app.toolState.pen.size = 4; window.__app.active.setTool('pen'); });
    const [x, y] = await at(300, 300);
    await win.mouse.click(x, y);
    await win.waitForTimeout(200);
    const px = await ed(([cx, cy]) => {
      const c = document.querySelector('.page canvas.ink-canvas, .page .page-ink, .page canvas:not(.region-canvas)');
      const all = [...document.querySelectorAll('.page canvas')];
      for (const cv of all) {
        const r = cv.getBoundingClientRect();
        if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
        const sx = cv.width / r.width, sy = cv.height / r.height;
        const d = cv.getContext('2d').getImageData(Math.round((cx - r.left) * sx), Math.round((cy - r.top) * sy), 1, 1).data;
        if (d[3] > 200 && d[0] < 80) return true;
      }
      void c;
      return false;
    }, [x, y]);
    check('F: a tap with the brush leaves a round dot (was invisible)', px);
    await ed(() => { window.__app.toolState.pen.style = 'ball'; window.__app.toolState.pen.size = 2; window.__app.settings.smoothInk = true; window.__app.active.setTool('pen'); });
    const wob = [[100, 500]];
    for (let i = 1; i <= 30; i++) wob.push([100 + i * 5, 500 + (i % 2 ? 1.2 : -1.2)]);
    await draw(wob, { steps: 1 });
    const st = (await pageData()).strokes.pop();
    let dev = 0;
    // the ends stay where the pen touched down / lifted; the line between is smoothed
    for (let i = 1; i < st.p.length / 3 - 1; i++) dev = Math.max(dev, Math.abs(st.p[i * 3 + 1] - 500));
    check('F: "Smooth my handwriting" removes shaking', st.pf === 1 && dev < 0.8, `max deviation ${dev.toFixed(2)}`);
    await ed(() => { window.__app.settings.smoothInk = false; });
  }

  // ===================================================================== G. pen side button (drivers without pressure, right-click emulation)
  if (sections.includes('G')) {
    await setData({ strokes: [{ id: 'l1', t: 'pen', c: '#000', s: 2, p: [100, 300, 0.5, 400, 300, 0.5] }] });
    await ed(() => window.__app.active.setTool('pen'));
    const pen = (type, x, y, o) => ed(([t, cx, cy, oo]) => {
      const target = document.elementFromPoint(cx, cy);
      target.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerId: 9, isPrimary: true, clientX: cx, clientY: cy, ...oo }));
    }, [type, x, y, o]);
    // a pen without pressure: button held reports pressure 0 and buttons 2 only
    let [x, y] = await at(200, 260);
    await pen('pointerdown', x, y, { pointerType: 'pen', buttons: 2, button: 2, pressure: 0 });
    for (let i = 1; i <= 10; i++) { [x, y] = await at(200, 260 + i * 8); await pen('pointermove', x, y, { pointerType: 'pen', buttons: 2, button: -1, pressure: 0 }); }
    await pen('pointerup', x, y, { pointerType: 'pen', buttons: 0, button: 2, pressure: 0 });
    const a = (await pageData()).strokes.length;
    // a driver that sends the side button as a right mouse click
    await setData({ strokes: [{ id: 'l2', t: 'pen', c: '#000', s: 2, p: [100, 300, 0.5, 400, 300, 0.5] }] });
    [x, y] = await at(150, 200);
    await pen('pointermove', x, y, { pointerType: 'pen', buttons: 0, button: -1, pressure: 0 });
    [x, y] = await at(300, 260);
    await pen('pointerdown', x, y, { pointerType: 'mouse', buttons: 2, button: 2, pointerId: 1 });
    for (let i = 1; i <= 10; i++) { [x, y] = await at(300, 260 + i * 8); await pen('pointermove', x, y, { pointerType: 'mouse', buttons: 2, button: -1, pointerId: 1 }); }
    await pen('pointerup', x, y, { pointerType: 'mouse', buttons: 0, button: 2, pointerId: 1 });
    const b = (await pageData()).strokes.length;
    check('G: pen button erases also on pens without pressure and when sent as right-click', a === 2 && b === 2, `${a}, ${b} pieces`);
  }
  // ===================================================================== K. Ctrl+Z with any keyboard layout
  if (sections.includes('K')) {
    await setData({});
    await ed(() => { window.__app.toolState.pen.style = 'ball'; window.__app.active.setTool('pen'); });
    const press = (key, code) => ed(([k, c]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: c, ctrlKey: true, bubbles: true, cancelable: true })), [key, code]);
    const count = async () => (await pageData()).strokes.length;
    await draw([[100, 100], [200, 120]]);
    await press('я', 'KeyZ'); // Russian layout: the key in the Z place
    const ru = await count();
    await draw([[100, 100], [200, 120]]);
    await press('z', 'KeyY'); // German QWERTZ: the key labelled Z
    const de = await count();
    await press('y', 'KeyZ'); // German: Ctrl+Y = redo
    const deRedo = await count();
    await press('z', 'KeyZ'); // English
    const en = await count();
    check('K: Ctrl+Z undoes with Russian, German and English layouts (Ctrl+Y redoes)', ru === 0 && de === 0 && deRedo === 1 && en === 0, JSON.stringify({ ru, de, deRedo, en }));
  }

  await ed(() => window.__app.closeAll());

  // ===================================================================== H. PDF: form field with the select tool, text selection, highlighter snap
  if (sections.includes('H')) {
    const prel = await ed(async (f) => { const [r] = await window.api.importFiles('', [f]); await window.__app.openNotebook(r); return r; }, pdfFile);
    void prel;
    await win.waitForTimeout(1200);
    await zoom1();
    await win.waitForTimeout(400);
    await ed(() => window.__app.active.setTool('select'));
    await win.waitForSelector('input.form-field', { timeout: 6000 }).catch(() => {});
    await win.locator('input.form-field').click();
    await win.keyboard.type('Jane');
    await win.waitForTimeout(200);
    const form = await ed(() => window.__app.active.doc.nb.form);
    check('H: a PDF form field takes typing directly, with the select tool', form && form.Name === 'Jane', JSON.stringify(form));
    // text selection: "quick brown" on line 1 (baseline y = 842-760 = 82)
    const [x0, y0] = await at(89, 77), [x1, y1] = await at(165, 77);
    await win.mouse.move(x0 - 5, y0); await win.waitForTimeout(400); // hover: text loads
    await win.mouse.move(x0, y0); await win.mouse.down(); await win.mouse.move(x1, y1, { steps: 5 }); await win.mouse.up();
    await win.waitForTimeout(300);
    await shot(win, '01-pdf-text-select');
    const menu = await win.locator('.pdf-sel-menu .menu-item').allTextContents();
    await win.locator('.pdf-sel-menu .menu-item', { hasText: 'Copy' }).click();
    await win.waitForTimeout(200);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    check('H: select printed PDF text → Copy / Highlight / Underline; copy gives the text', menu.length === 3 && /quick/.test(copied) && /brown/.test(copied), `menu ${menu.join('/')} copied "${copied}"`);
    // highlighter snaps to the second line
    await ed(() => window.__app.active.setTool('hl'));
    const [hx0, hy0] = await at(62, 104), [hx1, hy1] = await at(300, 108);
    await win.mouse.move(hx0, hy0); await win.mouse.down(); await win.mouse.move(hx1, hy1, { steps: 8 }); await win.mouse.up();
    await win.waitForTimeout(300);
    const hl = (await pageData()).strokes.filter((s) => s.t === 'hl');
    await shot(win, '02-highlight-snap');
    const ok = hl.length === 1 && hl[0].sh === 1 && Math.abs(hl[0].p[1] - hl[0].p[4]) < 0.01 && Math.abs(hl[0].p[1] - 101) < 4;
    check('H: highlighter snaps to the printed text line', ok, JSON.stringify(hl.map((s) => s.p)));
    await ed(() => window.__app.closeAll());
  }

  await app.close();
  const real = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
