// The reference reader: a PDF in its own small always-on-top window (pages,
// selectable text, zoom), docked into the main window next to the notes
// (divider, swap), and out again.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/reader.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { check, errors, finish } = require('./harness/report');
const { launch, root } = require('./harness/app');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-rd-'));
  const pdf = path.join(tmp, 'Power electronics.pdf');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '4'], { stdio: 'ignore' });
  const { app, win, ed } = await launch({ tmp });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  const rel = await ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf);
  await ed((r) => window.__app.openNotebook(r), rel);
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);
  await ed(() => window.__app.active.viewer.scrollToPage(1));
  await win.waitForTimeout(500);

  // ---- floating window ----
  const more = () => win.locator('.editor').getByRole('button', { name: 'More', exact: true }).click();
  await more();
  const [rw] = await Promise.all([app.waitForEvent('window'), win.getByRole('menuitem', { name: 'Reader: this PDF in its own window' }).click()]);
  await rw.waitForLoadState('domcontentloaded');
  await rw.waitForFunction(() => document.querySelectorAll('.rd-page canvas').length >= 1 && document.querySelector('.rd-text span'), null, { timeout: 20000 });
  const props = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /#sub=reader/.test(x.webContents.getURL())); return { top: w.isAlwaysOnTop(), b: w.getBounds() }; });
  check('its own window, always on top, small', props.top && props.b.width < 900, JSON.stringify(props));
  check('it opens at the page the notes show (page 2)', /^2 \/ 4$/.test(await rw.locator('.rd-pageno').textContent()));
  const text = await rw.evaluate(() => [...document.querySelectorAll('.rd-text')].map((l) => l.textContent).join(' '));
  check('the text can be selected (text layer)', /Lecture page 2/.test(text), text.slice(0, 120));
  const sel = await rw.evaluate(() => { const span = [...document.querySelectorAll('.rd-text span')].find((s) => /Lecture page/.test(s.textContent)); const r = document.createRange(); r.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); });
  check('selecting gives the words', /Lecture page/.test(sel), sel);
  if (process.env.SHOT) { fs.mkdirSync(process.env.SHOT, { recursive: true }); await rw.screenshot({ path: path.join(process.env.SHOT, 'reader-float.png') }); }
  const w0 = await rw.evaluate(() => document.querySelector('.rd-page').offsetWidth);
  await rw.getByRole('button', { name: 'Zoom in' }).click();
  await rw.waitForTimeout(300);
  check('zoom in makes the pages bigger', (await rw.evaluate(() => document.querySelector('.rd-page').offsetWidth)) > w0 * 1.05);

  // ---- dock ----
  await rw.getByRole('button', { name: 'Dock' }).click();
  await win.locator('.rd-pane .rd-page canvas').first().waitFor({ timeout: 20000 });
  await win.waitForTimeout(600);
  const docked = await win.evaluate(() => ({ pane: document.querySelector('.rd-pane').offsetWidth, body: document.querySelector('.editor-body').offsetWidth, zoom: window.__app.reader.view.zoom, page: window.__app.reader.view.current }));
  const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  check('Dock: the reader is now half of the main window, the floating window is gone', Math.abs(docked.pane - (docked.body - 6) / 2) < 3 && wins === 1, JSON.stringify({ docked, wins }));
  check('Dock keeps the page and the zoom', docked.zoom > 1 && docked.page === 2, JSON.stringify(docked));
  if (process.env.SHOT) await win.screenshot({ path: path.join(process.env.SHOT, 'reader-docked.png') });
  const dv = await win.locator('.rd-divider').boundingBox();
  await win.mouse.move(dv.x + 3, dv.y + 300); await win.mouse.down(); await win.mouse.move(dv.x - 200, dv.y + 300, { steps: 5 }); await win.mouse.up();
  const wider = await win.evaluate(() => ({ pane: document.querySelector('.rd-pane').offsetWidth, ratio: window.__app.settings.readerSplit.ratio }));
  check('the divider makes the reader wider and is remembered', wider.pane > docked.pane + 150 && wider.ratio < 0.4, JSON.stringify(wider));
  await win.locator('.rd-pane').getByRole('button', { name: 'Swap sides' }).click();
  const swapped = await win.evaluate(() => document.querySelector('.rd-pane').getBoundingClientRect().left < document.querySelector('.viewer, .editor-body > :first-child').getBoundingClientRect().left + 5);
  check('Swap puts the reader on the left', swapped && await ed(() => window.__app.settings.readerSplit.notesSide === 'right'));

  // ---- undock ----
  const [rw2] = await Promise.all([app.waitForEvent('window'), win.locator('.rd-pane').getByRole('button', { name: 'Undock' }).click()]);
  await rw2.waitForFunction(() => document.querySelectorAll('.rd-page canvas').length >= 1, null, { timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('.rd-pane'));
  check('Undock: its own window again, the pane is gone, same page', /^2 \/ 4$/.test(await rw2.locator('.rd-pageno').textContent()));
  await rw2.getByRole('button', { name: 'Close the reader' }).click();
  await win.waitForTimeout(500);
  check('Close closes the reader window', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) === 1);

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
