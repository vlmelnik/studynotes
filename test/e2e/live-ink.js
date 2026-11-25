// "Handwriting becomes text" (live) with the fake recognizer (every stroke is
// a word "wordN"): off by default, Ctrl+Shift+H / ⋯ menu switch it on; after
// a pause the ink turns into text on the first free ruled line, later words
// continue the same paragraph, one Ctrl+Z brings the ink back, off = ink stays.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/live-ink.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { check, errors, finish } = require('./harness/report');
const { launch } = require('./harness/app');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-live-'));
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_FAKE_INK: '1' } });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  await ed(async () => { window.__app.settings.mouseDraws = true; const r = await window.api.createNotebook('', { title: 'Live', paper: 'lined', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);
  await ed(() => window.__app.active.setTool('pen'));
  check('off by default', await ed(() => !window.__app.settings.liveInk));
  await win.keyboard.press('Control+Shift+H');
  check('Ctrl+Shift+H switches it on', await ed(() => window.__app.settings.liveInk === true));

  const box = await win.locator('.page').first().boundingBox();
  const stroke = async (x, y, w, hh) => {
    await win.mouse.move(box.x + x, box.y + y); await win.mouse.down();
    for (let k = 1; k <= 8; k++) await win.mouse.move(box.x + x + (w * k) / 8, box.y + y + (k % 2 ? hh : 0));
    await win.mouse.up();
  };
  const data = () => ed(() => { const e = window.__app.active; const d = e.pageData(e.pages[0].id); return { strokes: d.strokes.length, texts: d.texts.map((t) => ({ text: t.text, y: t.y, x: t.x, c: t.c })) }; });

  // big words in the middle of the page
  await stroke(300, 500, 120, 60);
  await stroke(460, 500, 120, 60);
  await win.waitForFunction(() => { const e = window.__app.active; const d = e.pageData(e.pages[0].id); return d.texts.length === 1 && !d.strokes.length; }, null, { timeout: 8000 });
  const one = await data();
  check('after a pause the ink becomes text on the first free ruled line', one.strokes === 0 && one.texts[0].text === 'word1 word2' && one.texts[0].y < 80 && one.texts[0].x >= 68, JSON.stringify(one));
  await stroke(300, 650, 100, 50);
  await win.waitForFunction(() => { const e = window.__app.active; const d = e.pageData(e.pages[0].id); return !d.strokes.length && /word1 word2 word1/.test(d.texts[0].text); }, null, { timeout: 8000 });
  const two = await data();
  check('the next words continue the same line / paragraph', two.texts.length === 1 && two.texts[0].text === 'word1 word2 word1', JSON.stringify(two));
  await ed(() => { window.__app.active.tools.clearSelection(true); window.__app.active.undo(); });
  const undone = await data();
  check('one Ctrl+Z brings the last ink back', undone.strokes === 1 && undone.texts[0].text === 'word1 word2', JSON.stringify(undone));

  // ⋯ menu: off; the ink stays ink
  await win.locator('.editor').getByRole('button', { name: 'More', exact: true }).click();
  await win.getByRole('menuitem', { name: /Handwriting becomes text: on/ }).click();
  await stroke(300, 760, 80, 40);
  await win.waitForTimeout(1600);
  const off = await data();
  check('⋯ menu switches it off; then ink stays ink', await ed(() => !window.__app.settings.liveInk) && off.strokes === 2, JSON.stringify(off));

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
