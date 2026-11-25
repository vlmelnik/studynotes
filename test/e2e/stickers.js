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

  const openPicker = async () => {
    await win.locator('.editor').getByRole('button', { name: /Insert picture, table/ }).click();
    await win.getByRole('menuitem', { name: 'Telegram stickers…' }).click();
    await win.locator('.stk-body').waitFor();
  };
  await openPicker();
  await win.getByLabel('Sticker pack link').fill('t.me/addstickers/Nope');
  await win.getByRole('button', { name: 'Add pack' }).click();
  await win.waitForFunction(() => /No sticker pack/.test(document.querySelector('.stk-body .hint').textContent));
  check('an unknown pack is explained', true);
  await win.getByLabel('Sticker pack link').fill('https://t.me/addstickers/Study_Cats');
  await win.getByLabel('Sticker pack link').press('Enter');
  await win.waitForFunction(() => document.querySelectorAll('.stk img[src^="blob:"]').length === 3);
  check('the pack is added: title, three stickers, a tab', /Study cats · 3/.test(await win.locator('.stk-body .hint').first().textContent()) && await win.locator('.stk-tab', { hasText: 'Study_Cats' }).count() === 1);
  await win.locator('.stk').first().click();
  await win.locator('.stk-body').waitFor({ state: 'detached' });
  const items = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).items.map((it) => ({ type: it.type, w: it.w, h: it.h, src: it.src })); });
  check('a sticker on the page at sticker size, stored in the notebook', items.length === 1 && items[0].type === 'img' && Math.abs(items[0].w - 110) < 0.5 && /\.png$/.test(items[0].src), JSON.stringify(items));
  check('the bot token is never in the requests', !seen.some((u) => /bot\d+:/.test(u)));

  // kept on this computer: works without the service
  server.close();
  await openPicker();
  await win.waitForFunction(() => document.querySelectorAll('.stk img[src^="blob:"]').length === 3, null, { timeout: 10000 });
  check('the pack is remembered and works offline', await ed(() => window.__app.settings.stickerPacks.join()) === 'Study_Cats');
  await win.getByRole('button', { name: 'Remove pack Study_Cats' }).click();
  check('a pack can be removed', await ed(() => window.__app.settings.stickerPacks.length === 0));
  await win.getByRole('button', { name: 'Close', exact: true }).click();

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
