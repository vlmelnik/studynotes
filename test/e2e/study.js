// Study session: the bar over everything, copied text and pictures collected,
// region (snip) / screen captures, own notes, then the review in the main
// window – laid out without AI, and filed by Claude (fake Claude Code) with
// the pictures as attachments.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/study.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { check, errors, finish } = require('./harness/report');
const { launch, root } = require('./harness/app');

function png(w, hh) {
  const raw = Buffer.alloc((w * 3 + 1) * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) raw.set([(x * 255 / w) | 0, (y * 255 / hh) | 0, 160], y * (w * 3 + 1) + 1 + x * 3);
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hh, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-study-'));
  const screenPng = path.join(tmp, 'screen.png');
  fs.writeFileSync(screenPng, png(1600, 1000));
  const clipPng = path.join(tmp, 'clip.png');
  fs.writeFileSync(clipPng, png(300, 200));
  const pipe = path.join(tmp, 'mcp.sock');
  // the real clipboard (Electron's async ClipboardItem API)
  let setClip;
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_STUDY_FAKE_SCREEN: screenPng, STUDYNOTES_MCP_PIPE: pipe, STUDYNOTES_CLAUDE_BIN: path.join(root, 'test', 'e2e', 'fixtures', 'fake-claude.js') } });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  setClip = (v) => app.evaluate(async ({ clipboard, ClipboardItem }, [text, b64]) => {
    const items = { 'text/plain': text };
    if (b64) items['image/png'] = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' });
    await clipboard.write([new ClipboardItem(items)]);
  }, [v.text || '', v.image ? fs.readFileSync(v.image).toString('base64') : '']);
  await setClip({ text: 'this was on the clipboard before' });
  if (process.env.DEBUG) { win.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 3000))); win.on('pageerror', (e) => console.log('STACK', e.stack)); }
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'Semiconductors', paper: 'lined', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);

  const start = async (topic, wish) => {
    await win.locator('.editor').getByRole('button', { name: 'More', exact: true }).click();
    await win.getByRole('menuitem', { name: 'Study session…' }).click();
    await win.locator('.modal').getByLabel('Topic').fill(topic);
    if (wish) await win.locator('.modal').getByLabel(/What the notes should be like/).fill(wish);
    const [bar] = await Promise.all([app.waitForEvent('window'), win.locator('.modal').getByRole('button', { name: 'Start' }).click()]);
    await bar.waitForSelector('.sb-bar');
    return bar;
  };
  const count = (bar) => bar.evaluate(() => Number(document.querySelector('.sb-count').textContent));
  const waitCount = (bar, n) => bar.waitForFunction((k) => Number(document.querySelector('.sb-count').textContent) === k, n, { timeout: 10000 });

  // ---- session 1: everything, then laid out without AI ----
  const bar = await start('Doping');
  check('the bar: on top, with the topic, nothing collected yet (old clipboard ignored)', (await bar.locator('.sb-topic').textContent()) === 'Doping' && await count(bar) === 0
    && await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => /#sub=study/.test(w.webContents.getURL())).isAlwaysOnTop()));
  await setClip({ text: 'Donors add free electrons to the crystal.' });
  await waitCount(bar, 1);
  await setClip({ text: 'Donors add free electrons to the crystal.', image: clipPng });
  await waitCount(bar, 2);
  check('copied text and a copied picture are collected', true);
  await bar.getByRole('button', { name: 'Screen' }).click();
  await waitCount(bar, 3);
  const [snip] = await Promise.all([app.waitForEvent('window'), bar.getByRole('button', { name: 'Region' }).click()]);
  await snip.waitForSelector('.snip-img[src^="data:"]');
  await snip.mouse.move(100, 100); await snip.mouse.down(); await snip.mouse.move(400, 300, { steps: 4 }); await snip.mouse.up().catch(() => {}); // the snip window closes on release
  await waitCount(bar, 4);
  check('Screen and Region (drawn on the screenshot) are collected', true);
  await bar.getByRole('button', { name: 'Note' }).click();
  await bar.getByLabel('Your note').fill('ask about the p-n junction');
  await bar.getByLabel('Your note').press('Enter');
  await waitCount(bar, 5);
  await setClip({ text: '  Donors add free electrons to the  crystal. ' });
  await bar.waitForTimeout(1200);
  check('the same text again within minutes is not added twice', await count(bar) === 5);
  if (process.env.SHOT) { fs.mkdirSync(process.env.SHOT, { recursive: true }); await bar.screenshot({ path: path.join(process.env.SHOT, 'study-bar.png') }); }
  await bar.getByRole('button', { name: 'Finish' }).click();
  await win.locator('.study-review').waitFor({ timeout: 10000 });
  if (process.env.SHOT) { await win.waitForTimeout(800); await win.screenshot({ path: path.join(process.env.SHOT, 'study-review.png') }); }
  const shown = await win.locator('.study-item').count();
  check('Finish: the main window shows what was collected', shown === 5, String(shown));
  await win.waitForFunction(() => [...document.querySelectorAll('.study-item.pic img')].every((i) => i.src.startsWith('blob:')) && document.querySelectorAll('.study-item.pic img').length === 3);
  await win.locator('.study-item.note .study-rm').click();
  check('an item can be left out', await win.locator('.study-item').count() === 4);
  check('without Claude Code set up only "Lay out without AI" is offered', await win.locator('.modal').getByRole('button', { name: 'Claude writes the notes' }).count() === 0);
  await win.locator('.modal').getByRole('button', { name: 'Lay out without AI' }).click();
  await win.waitForFunction(() => window.__app.active.pages.length >= 2, null, { timeout: 10000 }).catch(async (e) => { console.log('TOASTS', await win.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent))); throw e; });
  const laid = await ed(() => { const e = window.__app.active; const ds = e.pages.slice(1).map((p) => e.pageData(p.id)); return { texts: ds.flatMap((d) => d.texts.map((t) => t.text)), pics: ds.reduce((n, d) => n + d.items.filter((i) => i.type === 'img').length, 0), page1: e.pageData(e.pages[0].id).texts.length }; });
  check('laid out on new pages after the open one: topic, the text, three pictures, not the left-out note', laid.texts[0] === 'Doping' && laid.texts.some((t) => /Donors add free electrons/.test(t)) && laid.pics === 3 && !laid.texts.some((t) => /p-n junction/.test(t)) && laid.page1 === 0, JSON.stringify(laid));
  if (process.env.SHOT) { await ed(() => window.__app.active.viewer.scrollToPage(1)); await win.waitForTimeout(800); await win.screenshot({ path: path.join(process.env.SHOT, 'study-laid.png') }); }
  await ed(() => { window.__app.active.tools.clearSelection(true); window.__app.active.undo(); });
  check('one Ctrl+Z undoes it', await ed(() => window.__app.active.pages.length === 1));

  // ---- session 2: Claude files it ----
  await ed(() => { window.__app.settings.ai = { enabled: true, via: 'claudecode' }; });
  const bar2 = await start('Doping 2', 'focus on formulas');
  await setClip({ text: 'n-type: more electrons than holes.' });
  await waitCount(bar2, 1);
  await bar2.getByRole('button', { name: 'Screen' }).click();
  await waitCount(bar2, 2);
  await bar2.getByRole('button', { name: 'Finish' }).click();
  await win.locator('.study-review').waitFor({ timeout: 10000 });
  await win.locator('.modal').getByRole('button', { name: 'Claude writes the notes' }).click();
  await win.waitForFunction(() => /study: images=/.test(document.querySelector('.chat-msg.assistant')?.textContent || '') && !document.querySelector('.chat-msg.assistant .ai-wait'), null, { timeout: 30000 });
  const reply = await win.locator('.chat-msg.assistant').last().textContent();
  check('Claude gets the picture as an attachment, the material and the wishes', /study: images=1 lines=2 wishes=true/.test(reply), reply);
  const filed = await ed(() => { const e = window.__app.active; return e.pages.map((p) => e.pageData(p.id).items.filter((i) => i.type === 'img').length); });
  check('Claude placed the captured picture in the notebook', filed.reduce((a, b) => a + b, 0) === 1 && filed[0] === 0, JSON.stringify(filed));

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
