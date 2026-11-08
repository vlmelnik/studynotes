// End-to-end checks for v1.7 through the real UI.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v17.js
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v17-'));
const errors = [];
const shot = (win, name) => win.screenshot({ path: path.join(out, `v17-${name}.png`) });

// The text recognition add-on is "downloaded" from a local copy of the release files.
function ocrUrl() {
  const dir = path.join(tmp, 'ocr-release');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    for (const l of ['eng', 'deu', 'rus']) fs.copyFileSync(require.resolve(`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`), path.join(dir, `${l}.traineddata.gz`));
  }
  return require('url').pathToFileURL(dir).href + '/';
}

async function launch() {
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: [...(packaged ? [] : [root]), '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: path.join(tmp, 'Library'), STUDYNOTES_USERDATA: path.join(tmp, 'u'), STUDYNOTES_OCR_URL: ocrUrl(), STUDYNOTES_FAKE_INK: '1' },
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
  const rel = await ed(async () => { const r = await window.api.createNotebook('', { title: 'v17', paper: 'blank', pageCount: 4 }); await window.__app.openNotebook(r); return r; });
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

  // ===================================================================== A. library ↔ notebook keeps page and zoom
  if (sections.includes('A')) {
    await ed(() => window.__app.active.viewer.zoomTo(1.6, undefined, undefined, false));
    await win.waitForTimeout(300);
    await ed(() => window.__app.active.viewer.scrollToPage(2));
    await win.waitForTimeout(500);
    const before = await ed(() => ({ z: window.__app.active.viewer.zoom, i: window.__app.active.viewer.currentIndex }));
    await ed(() => window.__app.showLibrary());
    await win.waitForTimeout(500);
    // open it again from the library (a click on its card)
    await win.locator('.nb-card, .card', { hasText: 'v17' }).first().click();
    await win.waitForTimeout(1200);
    const after = await ed(() => ({ z: window.__app.active.viewer.zoom, i: window.__app.active.viewer.currentIndex }));
    check('A: library → notebook: same page and zoom', Math.abs(after.z - before.z) < 0.01 && after.i === before.i, JSON.stringify({ before, after }));
    await ed(() => { const v = window.__app.active.viewer; v.fitWidth(); v.scrollToPage(0); });
    await win.waitForTimeout(300);
  }

  // ===================================================================== B. objects dragged onto the next page
  if (sections.includes('B')) {
    await ed(() => { const v = window.__app.active.viewer; v.fitWidth(); });
    await win.waitForTimeout(300);
    const pid = await ed(() => window.__app.active.pages.map((p) => p.id));
    await ed((ids) => { const e = window.__app.active; e.setPageData(ids[1], { strokes: [], texts: [{ id: 'old', x: 100, y: 100, w: 200, fs: 12, c: '#000', text: 'already here' }], items: [] }); }, pid);
    await setData({ strokes: [{ id: 's1', t: 'pen', c: '#000', s: 2, p: [120, 760, 0.5, 220, 770, 0.5] }],
      items: [{ id: 'tb', type: 'table', x: 100, y: 700, cw: [100, 100], cells: [['a', 'b'], ['c', 'd']], fs: 12 }] });
    await win.waitForTimeout(300);
    await ed(() => { const v = window.__app.active.viewer; v.zoomTo(0.8, undefined, undefined, false); });
    await win.waitForTimeout(300);
    await ed(() => { const v = window.__app.active.viewer; v.scroller.scrollTop = v.layout[0].y + 500 * v.zoom; });
    await win.waitForTimeout(300);
    await ed(() => { const e = window.__app.active; e.setTool('select'); e.tools.select(0, e.pages[0].id, new Set(['s1']), new Set(), new Set(['tb'])); });
    await win.waitForTimeout(200);
    const [x0, y0] = await at(150, 765);
    await win.mouse.move(x0, y0); await win.mouse.down();
    const [x1, y1] = await at(150, 760 + 300);
    await win.mouse.move(x1, y1, { steps: 8 });
    const front = await ed(() => !!document.querySelector('.page.drag-front'));
    await win.mouse.up();
    await win.waitForTimeout(400);
    const d = await ed((ids) => { const e = window.__app.active; return [e.pageData(ids[0]), e.pageData(ids[1])]; }, pid);
    const moved = d[0].items.length === 0 && d[0].strokes.length === 0 && d[1].items.length === 1 && d[1].strokes.length === 1;
    const onTop = moved && d[1].items[0].z >= 1;
    await ed(() => window.__app.active.undo());
    const u = await ed((ids) => { const e = window.__app.active; return [e.pageData(ids[0]).items.length, e.pageData(ids[1]).items.length]; }, pid);
    check('B: dragged onto the next page: stays in front while dragging, moves to that page on top, one undo', front && moved && onTop && u[0] === 1 && u[1] === 0,
      JSON.stringify({ front, p0: [d[0].items.length, d[0].strokes.length], p1: [d[1].items.length, d[1].strokes.length], z: d[1].items[0] && d[1].items[0].z, y: d[1].items[0] && d[1].items[0].y, u }));
    await ed(() => window.__app.active.tools.clearSelection());
  }

  // ===================================================================== C. eyedropper
  if (sections.includes('C')) {
    await ed(() => { const v = window.__app.active.viewer; v.fitWidth(); v.scrollToPage(0); });
    await win.waitForTimeout(300);
    await setData({ strokes: [
      { id: 'r', t: 'pen', ps: 'marker', c: '#d62828', s: 30, p: [150, 150, 0.5, 250, 150, 0.5], np: 1 },
      { id: 'b', t: 'pen', ps: 'marker', c: '#1a4fd6', s: 30, p: [150, 260, 0.5, 250, 260, 0.5], np: 1 },
    ] });
    await win.waitForTimeout(400);
    await ed(() => { window.__app.toolState.pen.color = '#000000'; window.__app.active.setTool('pen'); });
    await win.mouse.move(5, 5);
    await win.keyboard.press('i');
    const tool1 = await ed(() => (window.__app.active.picking ? 'picking' : window.__app.toolState.tool));
    let [x, y] = await at(200, 150);
    await win.mouse.click(x, y);
    await win.waitForTimeout(400);
    const a = await ed(() => ({ c: window.__app.toolState.pen.color, tool: window.__app.toolState.tool }));
    // Alt + click with the highlighter: picks for the highlighter, no switch
    await ed(() => window.__app.active.setTool('hl'));
    [x, y] = await at(200, 260);
    await win.keyboard.down('Alt');
    const altCursor = await ed(() => document.querySelector('.editor').classList.contains('alt-pick'));
    await win.mouse.click(x, y);
    await win.keyboard.up('Alt');
    await win.waitForTimeout(400);
    const b = await ed(() => ({ c: window.__app.toolState.hl.color, tool: window.__app.toolState.tool, n: window.__app.active.pageData(window.__app.active.pages[0].id).strokes.length }));
    // the eyedropper button next to the colours (tool options)
    await ed(() => { window.__app.toolState.pen.color = '#000000'; window.__app.active.setTool('pen'); });
    await win.locator('.opt-swatch.pick').first().click();
    [x, y] = await at(200, 150);
    await win.mouse.click(x, y);
    await win.waitForTimeout(400);
    const viaBtn = await ed(() => window.__app.toolState.pen.color);
    check('C: eyedropper button in the colour options', viaBtn === '#d62828', viaBtn);
    // empty paper: the pixel on screen
    await ed(() => window.__app.active.setTool('pen'));
    await win.keyboard.press('i');
    [x, y] = await at(420, 300);
    await win.mouse.click(x, y);
    await win.waitForTimeout(500);
    const paper = await ed(() => window.__app.toolState.pen.color);
    check('C: eyedropper on empty paper takes the screen colour', /^#[0-9a-f]{6}$/.test(paper) && paper !== '#d62828' && parseInt(paper.slice(1, 3), 16) > 200, paper);
    check('C: eyedropper: I + click picks for the pen and goes back to it; Alt + click picks for the highlighter',
      tool1 === 'picking' && a.c === '#d62828' && a.tool === 'pen' && altCursor && b.c === '#1a4fd6' && b.tool === 'hl' && b.n === 2, JSON.stringify({ tool1, a, altCursor, b }));
  }

  // ===================================================================== D. scan → editable text
  if (sections.includes('D')) {
    await ed(() => { const v = window.__app.active.viewer; v.fitWidth(); v.scrollToPage(0); window.__app.active.setTool('select'); });
    // a "scan": paper-coloured picture with printed text in three fonts
    await ed(async () => {
      const e = window.__app.active;
      const S = 2.5, W = 500, H = 260;
      const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#f1ece0'; ctx.fillRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < 9000; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; ctx.fillRect(Math.random() * cv.width, Math.random() * cv.height, 2, 2); }
      await document.fonts.load('700 30px "SN Sans"'); await document.fonts.load('400 30px "SN Serif"'); await document.fonts.load('400 30px "SN Sans"');
      ctx.fillStyle = '#1a1a1a'; ctx.font = `700 ${22 * S}px "SN Sans"`; ctx.fillText('Rental Agreement', 20 * S, 40 * S);
      ctx.fillStyle = '#222'; ctx.font = `400 ${14 * S}px "SN Serif"`;
      ctx.fillText('The tenant agrees to pay the monthly rent of 650 euros', 20 * S, 85 * S);
      ctx.fillText('before the third working day of each month.', 20 * S, 108 * S);
      ctx.fillStyle = '#123a8a'; ctx.font = `400 ${13 * S}px "SN Sans"`; ctx.fillText('Der Mieter zahlt die Kaution in drei Raten.', 20 * S, 150 * S);
      ctx.fillStyle = '#222'; ctx.fillText('Арендатор обязуется бережно относиться к квартире.', 20 * S, 185 * S);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const src = await window.api.writeAsset(e.rel, new Uint8Array(await blob.arrayBuffer()), 'png');
      e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'scan', type: 'img', x: 40, y: 60, w: W, h: H, src }] });
    });
    await win.waitForTimeout(500);
    await win.waitForTimeout(300);
    const r0 = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const z0 = await ed(() => window.__app.active.viewer.zoom);
    const ph = await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).items[0].h);
    const clipZ = { x: r0.left + 25 * z0, y: r0.top + 55 * z0, width: 530 * z0, height: Math.min(ph + 10, 760) * z0 };
    const tag = process.env.SN_TAG || 'real';
    await win.screenshot({ path: path.join(out, `v17-${tag}-before.png`), clip: clipZ });
    const t0 = Date.now();
    await ed(() => { window.__mk = window.__app.active.makePageEditable(0); });
    await win.locator('.modal-actions .btn', { hasText: 'Download' }).click();
    await ed(() => window.__mk);
    const d = await pageData();
    const texts = d.texts.map((t) => ({ text: t.text, ff: t.ff, b: !!t.b, c: t.c, fs: t.fs, x: t.x, y: t.y }));
    const patch = d.items.find((it) => it.id !== 'scan');
    const want = ['Rental Agreement', 'The tenant agrees to pay the monthly rent of 650 euros', 'before the third working day of each month.', 'Der Mieter zahlt die Kaution in drei Raten.', 'Арендатор обязуется бережно относиться к квартире.'];
    const okText = want.every((w, k) => texts[k] && texts[k].text === w);
    const okFont = texts.length === 5 && texts[0].ff === 'sans' && texts[0].b && texts[1].ff === 'serif' && texts[3].ff === 'sans';
    const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
    const near = (a, b) => hex(a).every((v, k) => Math.abs(v - hex(b)[k]) < 40);
    const okColor = texts.length === 5 && near(texts[3].c, '#123a8a') && near(texts[1].c, '#222222');
    const okSize = texts.length === 5 && Math.abs(texts[0].fs - 22) < 2.5 && Math.abs(texts[1].fs - 14) < 1.6;
    // where the text was, the cleaned picture is paper now
    const darkest = patch ? await ed(async (it) => {
      const e = window.__app.active;
      const img = await createImageBitmap(await (await fetch(e.assetUrl(it.src))).blob());
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let min = 255;
      for (let i = 0; i < px.length; i += 4) min = Math.min(min, 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      return Math.round(min);
    }, patch) : 0;
    check('D: scan → text: all lines recognised (EN, DE, RU)', okText, JSON.stringify(texts.map((t) => t.text)));
    check('D: scan → text: matching font, size and colour', okFont && okSize && okColor, JSON.stringify(texts.map((t) => [t.ff, t.b, t.fs, t.c])));
    check('D: scan → text: the printed text is gone from the picture (no dark leftovers)', !!patch && darkest > 150, `darkest ${darkest}`);
    await win.waitForTimeout(500);
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const z = await ed(() => window.__app.active.viewer.zoom);
    await win.screenshot({ path: path.join(out, 'v17-scan.png'), clip: { x: r.left + 30 * z, y: r.top + 50 * z, width: 520 * z, height: 280 * z } });
    // undo removes everything in one step
    await ed(() => window.__app.active.undo());
    const u = await pageData();
    check('D: one undo step', u.texts.length === 0 && u.items.length === 1, JSON.stringify([u.texts.length, u.items.length]));
  }

  // ===================================================================== E. handwriting → text (fake recognizer outside Windows)
  if (sections.includes('E')) {
    await setData({ strokes: [
      { id: 'w1', t: 'pen', c: '#1a4fd6', s: 2, p: [100, 400, 0.5, 130, 390, 0.5, 160, 405, 0.5] },
      { id: 'w2', t: 'pen', c: '#1a4fd6', s: 2, p: [180, 400, 0.5, 210, 392, 0.5, 240, 404, 0.5] },
    ] });
    await ed(() => { const e = window.__app.active; e.setTool('select'); e.tools.select(0, e.pages[0].id, new Set(['w1', 'w2']), new Set()); });
    await win.waitForTimeout(200);
    await win.locator('.sel-toolbar button, .chip', { hasText: 'Copy as text' }).first().click();
    await win.waitForTimeout(600);
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    await win.locator('.chip', { hasText: 'To text' }).first().click();
    await win.waitForTimeout(600);
    const d = await pageData();
    check('E: handwriting → "Copy as text" and "To text" (text box in the ink colour, ink removed, one undo)',
      clip === 'word1 word2' && d.strokes.length === 0 && d.texts.length === 1 && d.texts[0].text === 'word1 word2' && d.texts[0].c === '#1a4fd6',
      JSON.stringify({ clip, s: d.strokes.length, t: d.texts.map((q) => [q.text, q.c, q.fs]) }));
    await ed(() => window.__app.active.undo());
    const u = await pageData();
    check('E: undo brings the handwriting back', u.strokes.length === 2 && u.texts.length === 0);
  }

  // ===================================================================== F. lasso around part of a scan → only those lines
  if (sections.includes('F')) {
    await ed(async () => {
      const e = window.__app.active;
      const S = 2.5, W = 400, H = 120;
      const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#111'; ctx.font = `400 ${14 * S}px "SN Serif"`;
      ctx.fillText('First line stays a picture', 10 * S, 30 * S);
      ctx.fillText('Second line becomes text', 10 * S, 80 * S);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const src = await window.api.writeAsset(e.rel, new Uint8Array(await blob.arrayBuffer()), 'png');
      e.viewer.fitWidth(); e.viewer.scrollToPage(0);
      e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'scan2', type: 'img', x: 60, y: 120, w: W, h: H, src }] });
      e.setTool('lasso');
    });
    await win.waitForTimeout(400);
    // lasso option "Text area", rectangle around the second line only (page y 120+55 … 120+90)
    await win.locator('.opt-chip', { hasText: 'Text area' }).click();
    const offered = await ed(() => window.__app.toolState.lasso.mode === 'text' ? 1 : 0);
    await draw([[55, 170], [470, 215]], { steps: 6 });
    await win.waitForTimeout(400);
    if (await win.locator('.modal-actions .btn', { hasText: 'Download' }).count()) await win.locator('.modal-actions .btn', { hasText: 'Download' }).click();
    await win.waitForFunction(() => window.__app.active.pageData(window.__app.active.pages[0].id).texts.length > 0, null, { timeout: 60000 }).catch(() => {});
    const d = await pageData();
    check('F: lasso option "Text area": rectangle on a scan converts only that line', offered > 0 && d.texts.length === 1 && d.texts[0].text === 'Second line becomes text',
      JSON.stringify({ offered, t: d.texts.map((q) => q.text) }));
  }

  // ===================================================================== G. PDF page: lasso on printed text → editable (only that part is rendered)
  if (sections.includes('G')) {
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const doc = await PDFDocument.create();
    const pg = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    pg.drawText('Invoice number 4711', { x: 60, y: 760, size: 18, font });
    pg.drawText('Total amount due: 120 EUR', { x: 60, y: 720, size: 14, font });
    const pdfFile = path.join(tmp, 'Invoice.pdf');
    fs.writeFileSync(pdfFile, await doc.save());
    await ed(async (f) => { const [r] = await window.api.importFiles('', [f]); await window.__app.openNotebook(r); }, pdfFile);
    await win.waitForTimeout(1200);
    await ed(() => { const e = window.__app.active; e.viewer.fitWidth(); e.viewer.scrollToPage(0); window.__app.toolState.lasso = { mode: 'text' }; e.setTool('lasso'); });
    await win.waitForTimeout(500);
    // around the first line only (PDF y 760 → page y ≈ 842-760-18)
    await draw([[50, 55], [330, 90]], { steps: 6 });
    const offered = 1;
    await win.waitForTimeout(300);
    if (await win.locator('.modal-actions .btn', { hasText: 'Download' }).count()) await win.locator('.modal-actions .btn', { hasText: 'Download' }).click();
    await win.waitForFunction(() => window.__app.active.pageData(window.__app.active.pages[0].id).texts.length > 0, null, { timeout: 60000 }).catch(() => {});
    const d = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });
    check('G: PDF page: text-area rectangle → that line becomes a serif text box at its place',
      offered > 0 && d.texts.length === 1 && d.texts[0].text === 'Invoice number 4711' && d.texts[0].ff === 'serif' && Math.abs(d.texts[0].fs - 18) < 1.5 && Math.abs(d.texts[0].x - 60) < 3,
      JSON.stringify({ offered, t: d.texts.map((q) => [q.text, q.ff, q.fs, q.x, q.y]) }));
  }

  // ===================================================================== H. screenshot-like text: big letters, umlauts, one typeface
  if (sections.includes('H')) {
    await ed(async () => {
      const e = window.__app.active;
      const S = 5, W = 520, H = 120;
      const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await document.fonts.load('700 30px "SN Sans"'); await document.fonts.load('400 30px "SN Sans"');
      ctx.fillStyle = '#111'; ctx.font = `700 ${16 * S}px "SN Sans"`; ctx.fillText('Grundlagen pn-Übergang', 10 * S, 25 * S);
      ctx.font = `400 ${11 * S}px "SN Sans"`;
      ctx.fillText('(a) Zeichen Sie für einen pn-Übergang die Raumladung', 18 * S, 55 * S);
      ctx.fillText('und den Feldstärkeverlauf bei thermischem Gleichgewicht.', 18 * S, 75 * S);
      ctx.fillText('Wo lässt sich an den Diagrammen die Spannung ablesen?', 18 * S, 95 * S);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const src = await window.api.writeAsset(e.rel, new Uint8Array(await blob.arrayBuffer()), 'png');
      const id = e.pages.find((p) => p.kind !== 'pdf') ? e.pages.find((p) => p.kind !== 'pdf').id : e.pages[0].id;
      e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'shot', type: 'img', x: 30, y: 60, w: W, h: H, src }] });
      void id;
    });
    await win.waitForTimeout(400);
    await ed(() => { window.__mk = window.__app.active.makePageEditable(0, { poly: [[25, 55], [560, 55], [560, 185], [25, 185]] }); });
    await win.waitForTimeout(300);
    if (await win.locator('.modal-actions .btn', { hasText: 'Download' }).count()) await win.locator('.modal-actions .btn', { hasText: 'Download' }).click();
    await ed(() => window.__mk);
    const d = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });
    const t = d.texts.slice().sort((a, b) => a.y - b.y);
    const want = ['Grundlagen pn-Übergang', '(a) Zeichen Sie für einen pn-Übergang die Raumladung', 'und den Feldstärkeverlauf bei thermischem Gleichgewicht.', 'Wo lässt sich an den Diagrammen die Spannung ablesen?'];
    check('H: big screenshot text with umlauts is read exactly', want.every((w, k) => t[k] && t[k].text === w), JSON.stringify(t.map((q) => q.text)));
    check('H: one typeface for all lines, only the heading bold', t.length === 4 && t.every((q) => q.ff === t[0].ff) && t[0].ff === 'sans' && !!t[0].b && t.slice(1).every((q) => !q.b && !q.i),
      JSON.stringify(t.map((q) => [q.ff, !!q.b, !!q.i, q.fs])));
  }

  // ===================================================================== I. match the document
  if (sections.includes('I')) {
    await ed(() => {
      const e = window.__app.active;
      e.setPageData(e.pages[0].id, { strokes: [], items: [], texts: [
        { id: 'scan', x: 80, y: 80, w: 200, fs: 14, c: '#333333', ff: 'opensans', text: 'From the scan', look: 0.42, fx: 0.42, aw: true },
        { id: 'new', x: 80, y: 200, w: 200, fs: 14, c: '#333333', ff: 'opensans', text: 'Typed later' },
      ] });
    });
    await win.waitForTimeout(250);
    const filterOf = (id) => ed((id) => getComputedStyle(document.querySelector(`.textbox[data-id="${id}"]`)).filter, id);
    check('I: scanned text is drawn as soft as the scan', /blur\(0\.42px\)/.test(await filterOf('scan')), await filterOf('scan'));
    await ed(() => { const e = window.__app.active; e.setTool('select'); e.tools.select(0, e.pages[0].id, new Set(), new Set(['new'])); });
    await win.waitForSelector('.text-bar .tb-btn[title^="Match the document"]');
    await win.click('.text-bar .tb-btn[title^="Match the document"]');
    await win.waitForTimeout(250);
    const t1 = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).texts.find((t) => t.id === 'new'); });
    check('I: the button gives typed text the look of the scan next to it', t1.fx === 0.42 && /blur/.test(await filterOf('new')), JSON.stringify(t1));
    await ed(() => { const e = window.__app.active; e.editText(e.pages[0].id, 'new'); });
    await win.waitForTimeout(150);
    check('I: sharp while editing', !/blur/.test(await filterOf('new')), await filterOf('new'));
    await ed(() => { const e = window.__app.active; document.activeElement.blur(); e.setTool('select'); e.tools.select(0, e.pages[0].id, new Set(), new Set(['new'])); });
    await win.waitForSelector('.text-bar .tb-btn[title^="Matched to the document"]');
    await win.click('.text-bar .tb-btn[title^="Matched to the document"]');
    await win.waitForTimeout(250);
    const t2 = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).texts.find((t) => t.id === 'new'); });
    check('I: clicked again: sharp text', !t2.fx && !/blur/.test(await filterOf('new')), JSON.stringify(t2));
  }

  // ===================================================================== Z. (local only) a real screenshot
  if (sections.includes('Z') && process.env.SN_IMG) {
    const bytes = [...fs.readFileSync(process.env.SN_IMG)];
    await ed(async (b) => {
      const e = window.__app.active;
      const src = await window.api.writeAsset(e.rel, new Uint8Array(b), 'png');
      const bmp = await createImageBitmap(await (await fetch(e.assetUrl(src))).blob());
      const w = 520, h = w * bmp.height / bmp.width;
      e.viewer.fitWidth(); e.viewer.scrollToPage(0);
      e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'real', type: 'img', x: 30, y: 60, w, h, src }] });
    }, bytes);
    await win.waitForTimeout(400);
    await win.waitForTimeout(300);
    const r0 = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const z0 = await ed(() => window.__app.active.viewer.zoom);
    const ph = await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).items[0].h);
    const clipZ = { x: r0.left + 25 * z0, y: r0.top + 55 * z0, width: 530 * z0, height: Math.min(ph + 10, 760) * z0 };
    const tag = process.env.SN_TAG || 'real';
    await win.screenshot({ path: path.join(out, `v17-${tag}-before.png`), clip: clipZ });
    const t0 = Date.now();
    await ed(() => { window.__mk = window.__app.active.makePageEditable(0); });
    await win.waitForTimeout(300);
    if (await win.locator('.modal-actions .btn', { hasText: 'Download' }).count()) await win.locator('.modal-actions .btn', { hasText: 'Download' }).click();
    await ed(() => window.__mk);
    const d = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });
    console.log(`time ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const q of d.texts) console.log(JSON.stringify([q.text, q.ff, !!q.b, !!q.i, q.fs, q.c, q.r || 0, q.fx || 0]));
    await win.waitForTimeout(800);
    await win.screenshot({ path: path.join(out, `v17-${tag}-after.png`), clip: clipZ });
  }

  await app.close();
  const real = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
