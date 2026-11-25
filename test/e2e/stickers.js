// Telegram stickers through a fake StudyNotes worker: a pack by link, the
// grid, a sticker on the page at sticker size, the pack remembered and kept
// on this computer (works when the service is gone), bad links explained.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/stickers.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const zlib = require('zlib');
const { check, errors, finish } = require('./harness/report');
const { launch } = require('./harness/app');

function png(w, hh, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hh, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(u.pathname + u.search);
    if (u.pathname === '/stickers/set' && u.searchParams.get('name') === 'Study_Cats') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ name: 'Study_Cats', title: 'Study cats', stickers: [0, 1, 2].map((k) => ({ file: `cat-sticker-000${k}`, emoji: '🐱', kind: 'static', w: 512, h: 512 })) }));
    } else if (u.pathname === '/stickers/file' && /^cat-sticker-/.test(u.searchParams.get('id'))) {
      res.setHeader('content-type', 'image/png'); res.end(png(512, 512, [240, 160, 40]));
    } else { res.statusCode = 404; res.setHeader('content-type', 'application/json'); res.end('{"error":"No sticker pack with this name."}'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-stk-'));
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_STICKER_URL: `http://127.0.0.1:${server.address().port}` } });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'Stickers', paper: 'lined', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);

  const panel = win.locator('.stk-panel');
  await win.locator('.tb-right [aria-label="Stickers"]').click();
  await panel.waitFor();
  check('the sticker button on the bar opens the panel (empty: says how to add)', /Add a Telegram sticker pack/.test(await panel.textContent()));
  await panel.getByRole('button', { name: 'Add a sticker pack' }).click();
  await panel.getByLabel('Sticker pack link').fill('t.me/addstickers/Nope');
  await panel.getByRole('button', { name: 'Add pack' }).click();
  await win.waitForFunction(() => /No sticker pack/.test(document.querySelector('.stk-add .hint').textContent));
  check('an unknown pack is explained', true);
  await panel.getByLabel('Sticker pack link').fill('https://t.me/addstickers/Study_Cats');
  await panel.getByLabel('Sticker pack link').press('Enter');
  await win.waitForFunction(() => document.querySelectorAll('.stk-grid .stk img[src^="blob:"]').length === 3 && document.querySelector('.stk-tab img[src^="blob:"]'));
  check('the pack: its section with three stickers, its first sticker as the icon in the strip', await panel.locator('.stk-sec-title', { hasText: 'Study cats' }).count() === 1 && await panel.locator('.stk-tab[data-key="Study_Cats"] img').count() === 1);
  // a picture already on the page, then the sticker: the sticker lies on top
  await ed(() => { const e = window.__app.active; const d = e.pageData(e.pages[0].id); e.commit(e.pages[0].id, d, { ...d, texts: [{ id: 'old', x: 200, y: 300, w: 200, fs: 14, text: 'older text', z: 5, lay: 'f' }] }); });
  await panel.locator('.stk').first().click();
  await panel.waitFor({ state: 'detached' });
  const items = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).items.map((it) => ({ type: it.type, w: it.w, h: it.h, src: it.src, lay: it.lay, z: it.z })); });
  check('a sticker on the page at sticker size, on top of what was there', items.length === 1 && items[0].type === 'img' && Math.abs(items[0].w - 110) < 0.5 && /\.png$/.test(items[0].src) && items[0].lay === 'f' && items[0].z > 5, JSON.stringify(items));
  check('the bot token is never in the requests', !seen.some((u) => /bot\d+:/.test(u)));

  // kept on this computer: works without the service; recently used first
  server.close();
  await win.locator('.tb-right [aria-label="Stickers"]').click();
  await win.waitForFunction(() => document.querySelectorAll('.stk-grid .stk img[src^="blob:"]').length === 4, null, { timeout: 10000 });
  check('"Recently used" comes first, the pack works offline', (await panel.locator('.stk-sec-title').first().textContent()) === 'Recently used' && await panel.locator('.stk-tab[data-key="recent"]').count() === 1);
  const sl0 = await panel.locator('.stk-strip').evaluate((el) => el.scrollLeft);
  await panel.locator('.stk-strip').evaluate((el) => { el.style.width = '60px'; });
  await panel.locator('.stk-strip').hover();
  await win.mouse.wheel(0, 200);
  check('the wheel scrolls the strip sideways', (await panel.locator('.stk-strip').evaluate((el) => el.scrollLeft)) > sl0);
  await panel.locator('.stk-tab[data-key="Study_Cats"]').click({ button: 'right' });
  await win.locator('.modal').getByRole('button', { name: 'Remove' }).click();
  await win.waitForFunction(() => !document.querySelector('.stk-tab[data-key="Study_Cats"]'));
  check('right-click removes a pack (and its recent stickers)', await ed(() => window.__app.settings.stickerPacks.length === 0 && window.__app.settings.stickerRecent.length === 0));
  await win.keyboard.press('Escape');

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
