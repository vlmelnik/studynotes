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
  await rw.evaluate(() => document.querySelector('.rd-pages').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
  await rw.waitForFunction(() => !document.querySelector('.rd-copied').hidden, null, { timeout: 3000 }).catch(() => {});
  const clip = await app.evaluate(async ({ clipboard }) => clipboard.readText());
  check('selecting copies it at once, "Copied" shows', /Lecture page/.test(clip) && await rw.evaluate(() => !document.querySelector('.rd-copied').hidden), clip);
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
  // dragging the window to an edge of the main window: a blue strip, then it pours in on that side
  const send = (ch, arg) => app.evaluate(({ BrowserWindow }, [c, a]) => BrowserWindow.getAllWindows().find((w) => !/#sub=/.test(w.webContents.getURL())).webContents.send(c, a), [ch, arg]);
  await send('reader:zone', 'right');
  const strip = await win.evaluate(() => { const s = document.querySelector('.rd-zone'); const r = s.getBoundingClientRect(); return { shown: !s.hidden, right: r.right, w: window.innerWidth }; });
  await send('reader:zone', null);
  check('a blue strip shows at the edge while the reader is dragged there', strip.shown && Math.abs(strip.right - strip.w) < 3 && await win.evaluate(() => document.querySelector('.rd-zone').hidden), JSON.stringify(strip));
  await send('reader:docked', { rel: await ed(() => window.__app.active.rel), file: 'source.pdf', title: 'x', page: 2, side: 'right' });
  await win.locator('.rd-pane .rd-page canvas').first().waitFor({ timeout: 20000 });
  check('dropped on the right edge: docked on the right, with the pour-in', await ed(() => window.__app.settings.readerSplit.notesSide === 'left') && await win.evaluate(() => document.querySelector('.rd-pane').getBoundingClientRect().right >= document.querySelector('.editor-body').getBoundingClientRect().right - 2));
  // pulled out by the header like a Chrome tab (after the pour-in has finished)
  await win.waitForFunction(() => !document.querySelector('.rd-pane.rd-in'));
  check('the pen options strip stays over the notes, not over the docked reader', await win.evaluate(() => document.querySelector('.tool-options').getBoundingClientRect().right <= document.querySelector('.viewer-host').getBoundingClientRect().right + 1));
  const bar = await win.locator('.rd-pane .rd-title').boundingBox();
  const [rw3] = await Promise.all([app.waitForEvent('window'), (async () => { await win.mouse.move(bar.x + 10, bar.y + 5); await win.mouse.down(); await win.mouse.move(bar.x - 60, bar.y + 40, { steps: 6 }); await win.mouse.up(); })()]);
  await rw3.waitForFunction(() => document.querySelectorAll('.rd-page canvas').length >= 1, null, { timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('.rd-pane'));
  check('dragging the docked header out makes it a window again', true);
  await rw3.getByRole('button', { name: 'Close the reader' }).click();
  await win.waitForTimeout(500);
  check('Close closes the reader window', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) === 1);

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
