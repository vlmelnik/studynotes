// 1.9 feedback: tables on dark paper, bars that do not fit get "⋯", the rotate
// spot at the bottom-right corner, Ctrl+X takes the text bar with it, Ctrl+C
// copies selected PDF text, SVG code pastes as a picture.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v19.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { check, errors, finish } = require('./harness/report');
const { launch, root } = require('./harness/app');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v19-'));
  const { app, win, ed } = await launch({ tmp });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  if (process.env.DEBUG) win.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 2000)));
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'Dark', paper: 'grid', pageCount: 1, pc: 'dark' }); await window.__app.openNotebook(r); });
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);

  // ---- a table on dark paper is dark too ----
  await ed(() => {
    const e = window.__app.active;
    const p = e.pages[0];
    const t = e.makeTable([['Art', 'Ursache', 'Verhalten'], ['Zeitweilig', 'Erdschluss', 'lange'], ['Schnell', 'Blitz', 'steil']], { index: 0, x: 80, y: 120 });
    t.hdr = true;
    e.tools.placeObjects(0, { items: [t] });
    return p.id;
  });
  await win.waitForTimeout(300);
  const tbl = await win.evaluate(() => { const t = document.querySelector('.table-item table'); const cs = getComputedStyle(t); const td = getComputedStyle(t.querySelector('td')); return { bg: cs.backgroundColor, color: cs.color, head: td.backgroundColor }; });
  check('a table on dark paper: no white background, light text, dark header', !/255, 255, 255/.test(tbl.bg) && /230, 231, 234/.test(tbl.color) && !/238, 242, 247/.test(tbl.head), JSON.stringify(tbl));

  // ---- narrow window: the table bar keeps inside, the rest behind "⋯" ----
  // (a narrower window: the page's own width, the test window cannot shrink under xvfb)
  await ed(() => { document.body.style.width = '620px'; });
  await win.waitForTimeout(500);
  await ed(() => { const e = window.__app.active; const p = e.pages[0]; const it = e.pageData(p.id).items[0]; e.setTool && e.setTool('select'); e.tools.select(0, p.id, new Set(), new Set(), new Set([it.id])); });
  await win.waitForTimeout(300);
  const bar = await win.evaluate(() => { const b = document.querySelector('.sel-toolbar').getBoundingClientRect(); const host = document.querySelector('.viewer-host').getBoundingClientRect(); return { right: b.right, hostRight: host.right, more: !!document.querySelector('.sel-toolbar .bar-more') }; });
  check('the selection bar stays inside the window and has "⋯"', bar.right <= bar.hostRight + 1 && bar.more, JSON.stringify(bar));
  await win.locator('.sel-toolbar .bar-more').click();
  check('"⋯" opens the rest (e.g. Header)', await win.locator('.sel-toolbar .bar-more-pop.open').getByRole('button', { name: 'Header' }).count() === 1 || await win.locator('.sel-toolbar .bar-more-pop.open button').count() > 0);
  await ed(() => window.__app.active.setTool('pen'));
  await win.waitForTimeout(200);
  const opts = await win.evaluate(() => { const b = document.querySelector('.tool-options'); const host = document.querySelector('.viewer-host'); return { w: b.scrollWidth, max: host.clientWidth, more: !!b.querySelector('.bar-more') }; });
  check('the pen options strip fits (colours behind "⋯" when needed)', opts.w <= opts.max, JSON.stringify(opts));
  await ed(() => { document.body.style.width = ''; });
  await win.waitForTimeout(400);

  // ---- a text box: rotate spot at the bottom-right corner, Ctrl+X takes the text bar along ----
  const tid = await ed(() => {
    const e = window.__app.active;
    e.setTool('select');
    e.viewer.scroller.scrollTop = 0;
    const t = { id: 'tx1', x: 100, y: 260, w: 260, fs: 16, c: '#ffffff', text: 'Ferranti-Effekt bedeutet', ff: 'carlito', lines: 1 };
    e.tools.placeObjects(0, { texts: [t] });
    e.tools.select(0, e.pages[0].id, new Set(), new Set(['tx1']));
    return 'tx1';
  });
  await win.waitForTimeout(300);
  const rot = await win.evaluate(() => { const box = document.querySelector('.sel-box').getBoundingClientRect(); const r = document.querySelector('.sel-rotate').getBoundingClientRect(); const se = document.querySelector('.sel-handle.se').getBoundingClientRect(); const tb = document.querySelector('.text-bar.show'); return { right: r.left >= se.right - 1, below: r.top >= se.bottom - 1, nearCorner: r.left - box.right < 30, bar: tb ? (() => { const b = tb.getBoundingClientRect(); return b.top >= r.bottom - 1 || b.bottom <= r.top + 1 || b.right <= r.left || b.left >= r.right; })() : true }; });
  check('rotate spot just outside the bottom-right corner, not under the text bar', rot.right && rot.below && rot.nearCorner && rot.bar, JSON.stringify(rot));
  await win.locator('.viewer-host').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await ed(() => { const e = window.__app.active; e.tools.select(0, e.pages[0].id, new Set(), new Set(['tx1'])); });
  await win.keyboard.press('Control+X');
  await win.waitForTimeout(400);
  const cut = await ed((id) => ({ gone: !window.__app.active.pageData(window.__app.active.pages[0].id).texts.some((t) => t.id === id), bar: !!document.querySelector('.text-bar.show'), edit: !!window.__app.active.textEdit }), tid);
  check('Ctrl+X: the box is gone and so is its text bar', cut.gone && !cut.bar && !cut.edit, JSON.stringify(cut));

  // ---- SVG code (as ChatGPT copies it) pastes as a picture ----
  const svg = '<svg viewBox="0 0 100 60" width="100" height="60"><rect x="5" y="5" width="90" height="50" fill="#3b6fb6"/><circle cx="50" cy="30" r="12" fill="#fff"/></svg>';
  await ed((s) => window.__app.active.pasteData({ text: '```svg\n' + s + '\n```', html: '', files: [] }), svg);
  await win.waitForTimeout(800);
  const pic = await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).items.filter((i) => i.type === 'img').length);
  check('SVG code pastes as a picture', pic === 1, String(pic));
  await app.close();

  // ---- PDF text: Ctrl+C copies the selection ----
  const pdf = path.join(tmp, 'Lecture.pdf');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '2'], { stdio: 'ignore' });
  const b = await launch({ tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v19b-')) });
  await b.win.waitForFunction(() => window.__app && document.querySelector('.library'));
  const rel = await b.ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf);
  await b.ed((r) => window.__app.openNotebook(r), rel);
  await b.win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);
  await b.ed(() => window.__app.active.setTool('select'));
  await b.win.waitForTimeout(1500);
  // drag across the first line of page 1
  const line = await b.ed(() => { const e = window.__app.active; const r = e.viewer.viewById(e.pages[0].id).el.getBoundingClientRect(); return { x: r.left, y: r.top, z: e.viewer.zoom }; });
  // the test PDF has "Chapter 1 - Lecture page 1" near the top left
  const z = line.z;
  await b.win.mouse.move(line.x + 60 * z, line.y + 63 * z);
  await b.win.mouse.down();
  await b.win.mouse.move(line.x + 260 * z, line.y + 63 * z, { steps: 8 });
  await b.win.mouse.up();
  await b.win.waitForTimeout(300);
  const menu = await b.win.locator('.pdf-sel-menu').count();
  await b.app.evaluate(async ({ clipboard }) => clipboard.writeText('old'));
  await b.win.keyboard.press('Control+C');
  await b.win.waitForTimeout(300);
  const clip = await b.app.evaluate(async ({ clipboard }) => clipboard.readText());
  check('Ctrl+C copies selected PDF text', menu === 1 && clip !== 'old' && clip.length > 3, JSON.stringify({ menu, clip }));
  await b.app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
