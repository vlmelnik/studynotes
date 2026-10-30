// End-to-end checks for the v1.1 features, through the real UI and the real
// system clipboard. usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v11.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, { recursive: true });
const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v11-'));
  const libDir = path.join(tmp, 'Library');
  const env = { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: libDir, STUDYNOTES_USERDATA: path.join(tmp, 'u') };
  const launch = () => electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: process.env.STUDYNOTES_EXE ? ['--no-sandbox'] : [root, '--no-sandbox'],
    env,
  });
  let app = await launch();
  let win = await app.firstWindow();
  const errors = [];
  const watch = (w) => {
    w.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    w.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };
  watch(win);
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app);

  const ed = (fn, arg) => win.evaluate(fn, arg);
  const pageData = (i = 0) => ed((k) => { const e = window.__app.active; return e.pageData(e.pages[k].id); }, i);

  const rel = await ed(async () => {
    const r = await window.api.createNotebook('', { title: 'Feature test', paper: 'lined' });
    await window.__app.openNotebook(r);
    return r;
  });
  await win.waitForTimeout(500);
  const focusViewer = () => ed(() => window.__app.active.viewer.scroller.focus());

  // ---------- 1. paste a picture from the system clipboard ----------
  // Electron 44+: async ClipboardItem API
  const setClip = (data) => app.evaluate(async ({ clipboard, ClipboardItem }, d) => {
    const map = {};
    for (const [k, v] of Object.entries(d)) map[k] = k.startsWith('image/') ? new Blob([Uint8Array.from(atob(v), (c) => c.charCodeAt(0))], { type: k }) : v;
    await clipboard.write([new ClipboardItem(map)]);
  }, data);
  await setClip({ 'image/png': fs.readFileSync(path.join(root, 'assets', 'icon-256.png')).toString('base64') });
  await focusViewer();
  await win.keyboard.press('Control+v');
  await win.waitForFunction(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).items.length === 1; }, null, { timeout: 8000 }).catch(() => {});
  let d = await pageData();
  const img = d.items.find((i) => i.type === 'img');
  const afterImg = await ed(() => ({ tool: window.__app.active.toolState.tool, sel: !!window.__app.active.tools.sel }));
  check('paste picture from clipboard', !!img, img ? `${Math.round(img.w)}×${Math.round(img.h)} pt` : '');
  check('after pasting, select tool is active with the picture selected', afterImg.tool === 'select' && afterImg.sel, JSON.stringify(afterImg));
  check('picture file stored in the notebook', img && fs.existsSync(path.join(libDir, rel, img.src)), img && img.src);

  // ---------- 2. paste text ----------
  await win.keyboard.press('Escape');
  await setClip({ 'text/plain': 'Halbleiter: Bandlücke 1,12 eV\nПривет' });
  await focusViewer();
  await win.keyboard.press('Control+v');
  await win.waitForTimeout(400);
  d = await pageData();
  check('paste text creates a text box', d.texts.some((t) => t.text.includes('Привет') && t.text.includes('Bandlücke')), d.texts.map((t) => t.text).join(' | '));

  // ---------- 3. paste a table (as from Excel / Word) ----------
  await win.keyboard.press('Escape');
  await setClip({
    'text/plain': 'U\tI\n5 V\t2 A\n12 V\t0,5 A',
    'text/html': '<table><tr><td><b>U</b></td><td><b>I</b></td></tr><tr><td>5 V</td><td>2 A</td></tr><tr><td>12 V</td><td>0,5 A</td></tr></table>',
  });
  await focusViewer();
  await win.keyboard.press('Control+v');
  await win.waitForTimeout(500);
  d = await pageData();
  const table = d.items.find((i) => i.type === 'table');
  check('paste table becomes an editable table', table && table.cells.length === 3 && table.cells[0].length === 2 && table.hdr, table && JSON.stringify(table.cells.map((r) => r.map((c) => c.t))));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(out, 'v11-01-paste.png') });

  // ---------- 4. select tool: click the picture, drag it ----------
  await win.keyboard.press('v');
  const imgRect = await ed((id) => {
    const e = window.__app.active;
    const it = e.pageData(e.pages[0].id).items.find((x) => x.id === id);
    const r = e.viewer.pageClientRect(0), z = e.viewer.zoom;
    // A visible (not transparent) spot of the picture that nothing else covers.
    // (Since 1.3, clicks on transparent parts of a picture go through it.)
    let px = it.x + 8, py = it.y + 8;
    find: for (let k = 4; k < it.w / 2; k += 4) {
      for (const [dx, dy] of [[k, k], [it.w / 2, k], [k, it.h / 2]]) {
        const o = e.tools.objectAt(e.pages[0].id, it.x + dx, it.y + dy);
        if (o && o.id === it.id) { px = it.x + dx; py = it.y + dy; break find; }
      }
    }
    return { x: r.left + px * z, y: r.top + py * z, ix: it.x, iy: it.y, z };
  }, img.id);
  await win.mouse.move(imgRect.x, imgRect.y);
  await win.mouse.down();
  await win.mouse.move(imgRect.x + 80, imgRect.y + 40, { steps: 6 });
  await win.mouse.up();
  d = await pageData();
  const moved = d.items.find((i) => i.id === img.id);
  check('select tool: click + drag moves a picture', Math.abs(moved.x - imgRect.ix - 80 / imgRect.z) < 1.5 && Math.abs(moved.y - imgRect.iy - 40 / imgRect.z) < 1.5,
    `${imgRect.ix.toFixed(1)},${imgRect.iy.toFixed(1)} → ${moved.x},${moved.y}`);
  const selNow = await ed(() => { const s = window.__app.active.tools.sel; return s ? s.itemIds.size : 0; });
  check('picture stays selected after moving', selNow === 1);

  // resize with the corner handle
  const handle = await win.locator('.sel-handle.se').boundingBox().catch(() => null);
  if (handle) {
    await win.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await win.mouse.down();
    await win.mouse.move(handle.x + 60, handle.y + 60, { steps: 5 });
    await win.mouse.up();
  }
  d = await pageData();
  const resized = d.items.find((i) => i.id === img.id);
  check('corner handle resizes the picture', handle && resized.w > moved.w + 10, `${Math.round(moved.w)} → ${Math.round(resized.w)} pt`);
  await win.keyboard.press('Escape');

  // ---------- 5. text formatting: font, bold, italic, underline ----------
  await win.keyboard.press('t');
  const r0 = await ed(() => window.__app.active.viewer.pageClientRect(0));
  await win.mouse.click(r0.left + 120, r0.top + 600);
  await win.keyboard.press('Control+b');
  await win.keyboard.press('Control+u');
  await win.keyboard.type('Wichtig');
  await win.click('.tool-options .opt-chip.font');
  await win.click('.menu-item:has-text("Times style")');
  await win.keyboard.press('Escape');
  d = await pageData();
  const styled = d.texts.find((t) => t.text.includes('Wichtig'));
  check('text box: bold + underline + font', styled && (styled.b || /<b|<strong/.test(styled.html || '')) && (styled.u || /<u/.test(styled.html || '')) && styled.ff === 'serif',
    styled && JSON.stringify({ b: styled.b, u: styled.u, ff: styled.ff, html: styled.html }));

  // ---------- 6. shapes: line, arrow, rounded rectangle, star ----------
  await win.keyboard.press('s');
  const kinds = await ed(() => Object.keys(window.__app.active.constructor.SHAPE_KINDS || {}));
  const shapeKinds = ['line', 'arrow', 'roundrect', 'star'];
  const strokesBefore = (await pageData()).strokes.length;
  for (const [k, kind] of shapeKinds.entries()) {
    await ed((kk) => { window.__app.active.toolState.shape.kind = kk; }, kind);
    const y = r0.top + 470 + k * 45;
    await win.mouse.move(r0.left + 100 + k * 120, y);
    await win.mouse.down();
    await win.mouse.move(r0.left + 190 + k * 120, y + 35, { steps: 5 });
    await win.mouse.up();
  }
  d = await pageData();
  check('shapes tool: line, arrow, rounded rectangle, star all draw', d.strokes.length >= strokesBefore + 4, `${d.strokes.length - strokesBefore} new strokes ${kinds.length ? '' : ''}`);

  // draw & hold → rounded rectangle recognised from a rounded hand drawing
  await win.keyboard.press('p');
  const cdp = await win.context().newCDPSession(win);
  const pts = [];
  const cx = r0.left + 330, cy = r0.top + 400, W = 150, H = 90, R = 22;
  // rectangle with rounded corners, traced clockwise
  const path2 = [];
  const arc = (ax, ay, a0) => { for (let t = 0; t <= 8; t++) { const a = a0 + (t / 8) * Math.PI / 2; path2.push([ax + R * Math.cos(a), ay + R * Math.sin(a)]); } };
  const L = cx - W / 2, T = cy - H / 2, Rr = cx + W / 2, B = cy + H / 2;
  for (let x = L + R; x <= Rr - R; x += 6) path2.push([x, T]);
  arc(Rr - R, T + R, -Math.PI / 2);
  for (let y = T + R; y <= B - R; y += 6) path2.push([Rr, y]);
  arc(Rr - R, B - R, 0);
  for (let x = Rr - R; x >= L + R; x -= 6) path2.push([x, B]);
  arc(L + R, B - R, Math.PI / 2);
  for (let y = B - R; y >= T + R; y -= 6) path2.push([L, y]);
  arc(L + R, T + R, Math.PI);
  for (const p of path2) pts.push([p[0] + (Math.random() - 0.5) * 1.5, p[1] + (Math.random() - 0.5) * 1.5]);
  const base = { pointerType: 'pen', button: 'left', clickCount: 1 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], force: 0.5, buttons: 1, ...base });
  for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, force: 0.5, buttons: 1, ...base });
  await win.waitForTimeout(800);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], buttons: 0, ...base });
  d = await pageData();
  const last = d.strokes[d.strokes.length - 1];
  check('draw & hold recognises a rounded rectangle', last && last.sh === 1 && last.shape === 'roundrect', last && `shape=${last.shape}`);

  // ---------- 7. pen types + favourites ----------
  const styles = ['pencil', 'marker', 'brush', 'neon'];
  for (const [k, st] of styles.entries()) {
    await ed((s) => { window.__app.active.toolState.pen.style = s; window.__app.active.renderOptions(); }, st);
    const wave = [];
    for (let i = 0; i <= 40; i++) wave.push([r0.left + 520 + i * 5, r0.top + 120 + k * 50 + Math.sin(i / 4) * 12]);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wave[0][0], y: wave[0][1], force: 0.3, buttons: 1, ...base });
    for (const [i, [x, y]] of wave.slice(1).entries()) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, force: 0.2 + (i / 40) * 0.7, buttons: 1, ...base });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wave[40][0], y: wave[40][1], buttons: 0, ...base });
  }
  d = await pageData();
  const penStyles = new Set(d.strokes.map((s) => s.ps).filter(Boolean));
  check('pencil, marker, brush and neon strokes recorded', styles.every((s) => penStyles.has(s)), [...penStyles].join(','));
  const recent = await ed(() => (window.__app.settings.recentPens || []).length);
  check('recently used pens are remembered', recent >= 2, `${recent} recent pens`);
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(out, 'v11-02-tools.png') });

  // ---------- 8. more page templates ----------
  const papers = await ed(() => window.__app.active.constructor.PAPERS || null);
  await ed(() => window.__app.active.insertPage(0, 'cornell'));
  d = await ed(() => window.__app.active.pages.map((p) => p.paper || p.kind));
  check('insert a Cornell-notes page', d[1] === 'cornell', d.join(','));

  // ---------- 9. insert pages from a PDF (pages 2-3 only) ----------
  const pdfFile = path.join(tmp, 'skript.pdf');
  execFileSync('node', [path.join(root, 'scripts', 'make-test-pdf.js'), pdfFile, '5']);
  const pagesBefore = await ed(() => window.__app.active.pages.length);
  const insertP = ed((f) => window.__app.active.insertPdfFile(f, 0), pdfFile);
  await win.waitForSelector('.modal', { timeout: 10000 });
  await win.click('.modal input[type=radio] >> nth=1');
  await win.fill('.modal input.input[type=text]', '2-3');
  await win.click('.modal .btn-primary');
  await insertP;
  await win.waitForTimeout(800);
  const pagesNow = await ed(() => window.__app.active.pages.map((p) => (p.kind === 'pdf' ? `pdf${p.pdfPage}` : p.paper)));
  check('insert only pages 2–3 of another PDF after page 1', pagesNow.length === pagesBefore + 2 && pagesNow[1] === 'pdf2' && pagesNow[2] === 'pdf3', pagesNow.join(','));
  await win.waitForFunction(() => { const v = window.__app.active.viewer; const pv = v.view(1); return pv && pv.bgScale > 0; }, null, { timeout: 15000 }).catch(() => {});
  await win.screenshot({ path: path.join(out, 'v11-03-inserted-pdf.png') });

  // ---------- 10. export with pictures, tables, styled text ----------
  await ed(() => window.__app.active.flush());
  const exp = path.join(tmp, 'export.pdf');
  await ed(([a, b]) => window.api.exportTo(a, null, b), [rel, exp]);
  const info = execFileSync('pdfinfo', [exp]).toString();
  const text = execFileSync('pdftotext', ['-f', '1', '-l', '1', exp, '-']).toString();
  check('export contains pasted text, table cells and styled text', /Привет/.test(text) && /12 V/.test(text) && /Wichtig/.test(text), `${/Pages:\s+(\d+)/.exec(info)[1]} pages`);
  execFileSync('pdftoppm', ['-r', '60', '-png', '-f', '1', '-l', '1', exp, path.join(out, 'v11-04-export')]);

  // ---------- 11. endless board ----------
  const boardRel = await ed(async () => {
    const r = await window.api.createNotebook('', { title: 'Board', kind: 'board' });
    await window.__app.openNotebook(r);
    return r;
  });
  await win.waitForTimeout(500);
  await win.keyboard.press('p');
  const vb = await win.locator('.viewer').boundingBox();
  // draw near the right edge, then scroll right and draw again → board grows
  const strokeAt = async (x, y) => {
    await win.mouse.move(x, y); await win.mouse.down();
    await win.mouse.move(x + 60, y + 20, { steps: 5 }); await win.mouse.up();
  };
  await strokeAt(vb.x + vb.width - 120, vb.y + 200);
  const before = await ed(() => { const p = window.__app.active.pages[0]; return { ox: p.ox, w: p.w }; });
  await ed(() => { const s = window.__app.active.viewer.scroller; s.scrollLeft = s.scrollWidth; });
  await win.waitForTimeout(300);
  await strokeAt(vb.x + vb.width - 120, vb.y + 300);
  await win.waitForTimeout(300);
  const after = await ed(() => { const p = window.__app.active.pages[0]; return { ox: p.ox, w: p.w }; });
  check('endless board grows when drawing near the edge', after.ox + after.w > before.ox + before.w, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  await win.screenshot({ path: path.join(out, 'v11-05-board.png') });
  await ed(() => window.__app.active.flush());
  const bexp = path.join(tmp, 'board.pdf');
  await ed(([a, b]) => window.api.exportTo(a, null, b), [boardRel, bexp]);
  const bsize = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(execFileSync('pdfinfo', [bexp]).toString());
  const bbox = await ed(() => {
    const e = window.__app.active;
    const ss = e.pageData(e.pages[0].id).strokes;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s2 of ss) for (let i = 0; i < s2.p.length; i += 3) { x0 = Math.min(x0, s2.p[i]); x1 = Math.max(x1, s2.p[i]); y0 = Math.min(y0, s2.p[i + 1]); y1 = Math.max(y1, s2.p[i + 1]); }
    return { w: x1 - x0, h: y1 - y0, board: e.pages[0].w + ' x ' + e.pages[0].h };
  });
  check('board export is cropped to the content (+ margin), not the whole board', bsize && +bsize[1] >= bbox.w && +bsize[1] < bbox.w + 300 && +bsize[2] < bbox.h + 300,
    bsize && `pdf ${bsize[1]} × ${bsize[2]} pt, content ${Math.round(bbox.w)} × ${Math.round(bbox.h)}, board ${bbox.board}`);

  // ---------- 12. smooth zoom ----------
  const zs = await ed(async () => {
    const v = window.__app.active.viewer;
    const r = v.scroller.getBoundingClientRect();
    const seen = [];
    const z0 = v.zoom;
    v.zoomTo(z0 * 2, r.left + r.width / 2, r.top + r.height / 2, true);
    const t0 = performance.now();
    await new Promise((res) => { const tick = () => { seen.push(v.zoom); if (performance.now() - t0 < 600) requestAnimationFrame(tick); else res(); }; tick(); });
    return { z0, z1: v.zoom, steps: new Set(seen.map((z) => z.toFixed(3))).size };
  });
  check('zoom animates in several steps', zs.steps >= 4 && Math.abs(zs.z1 - zs.z0 * 2) < 0.02, JSON.stringify(zs));

  // ---------- 13. backup: export everything, import into an empty library ----------
  const backup = path.join(tmp, 'all-notes.studynotes');
  await ed((f) => window.api.testExportBackup(f), backup);
  check('export all notes to one backup file', fs.existsSync(backup) && fs.statSync(backup).size > 1000, `${(fs.statSync(backup).size / 1024).toFixed(0)} KB`);
  await app.close();

  const lib2 = path.join(tmp, 'Library2');
  env.STUDYNOTES_LIBRARY = lib2;
  env.STUDYNOTES_USERDATA = path.join(tmp, 'u2');
  app = await launch();
  win = await app.firstWindow();
  watch(win);
  await win.waitForFunction(() => window.__app);
  const imported = await win.evaluate((f) => window.api.testImportBackup(f), backup);
  await win.evaluate((f) => window.__app.library.load(f), imported.rel);
  await win.waitForTimeout(500);
  const cards = await win.evaluate(() => [...document.querySelectorAll('.nb-card .card-title')].map((e) => e.textContent));
  check('import backup restores the notebooks (into an "Imported …" folder)', cards.includes('Feature test') && cards.includes('Board'), `${JSON.stringify(imported)} → ${cards.join(', ')}`);
  const reopened = await win.evaluate(async (folder) => {
    const list = await window.api.list(folder);
    const nb = list.notebooks.find((n) => n.title === 'Feature test');
    const e = await window.__app.openNotebook(nb.path);
    const d0 = e.pageData(e.pages[0].id);
    return { items: d0.items.length, texts: d0.texts.length, strokes: d0.strokes.length };
  }, imported.rel);
  check('restored notebook has its pictures, tables, text and ink', reopened.items === 2 && reopened.texts >= 2 && reopened.strokes >= 8, JSON.stringify(reopened));
  await win.waitForTimeout(800);
  const imgLoaded = await win.evaluate(() => [...document.querySelectorAll('.page img')].every((i) => i.complete && i.naturalWidth > 0));
  check('restored picture loads', imgLoaded);

  // settings export / import keeps tool state
  await app.close();
  const realErrors = errors.filter((e) => !/Autofill|DevTools/.test(e));
  check('no console / page errors', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
