import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stickers } from './cloudflare/stickers.mjs';

const env = { TELEGRAM_BOT_TOKEN: '123456:' + 'A'.repeat(30) };
const tg = (calls) => async (u) => {
  calls.push(String(u).replace(env.TELEGRAM_BOT_TOKEN, 'TOKEN'));
  if (u.includes('/getStickerSet')) return Response.json(u.includes('name=Pack1') ? { ok: true, result: { name: 'Pack1', title: 'Pack', stickers: [
    { file_id: 'static-file-0001', emoji: '😀', width: 512, height: 512, is_animated: false, is_video: false },
    { file_id: 'anim-file-00002', emoji: '🎉', is_animated: true, thumbnail: { file_id: 'thumb-file-0002', width: 128, height: 128 } },
    { file_id: 'video-no-thumb-3', is_video: true },
  ] } } : { ok: false });
  if (u.includes('/getFile')) return Response.json({ ok: true, result: { file_path: u.includes('static') ? 'stickers/a.webp' : 'stickers/a.tgs' } });
  if (u.includes('/file/bot')) return new Response(new Uint8Array([1, 2, 3]));
  return new Response('?', { status: 500 });
};

test('stickers: a pack by name, animated ones as their still picture, the token never leaves', async () => {
  const calls = [];
  const r = await stickers(new URL('https://w.dev/stickers/set?name=Pack1'), env, tg(calls));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.stickers.map((s) => [s.file, s.kind]), [['static-file-0001', 'static'], ['thumb-file-0002', 'still']]);
  assert.ok(!JSON.stringify(j).includes(env.TELEGRAM_BOT_TOKEN));
  const f = await stickers(new URL('https://w.dev/stickers/file?id=static-file-0001'), env, tg(calls));
  assert.equal(f.headers.get('content-type'), 'image/webp');
  assert.deepEqual([...new Uint8Array(await f.arrayBuffer())], [1, 2, 3]);
  assert.equal((await stickers(new URL('https://w.dev/stickers/file?id=anim-file-00002'), env, tg(calls))).status, 415);
});

test('stickers: bad names and ids, unknown packs, missing token', async () => {
  const calls = [];
  assert.equal((await stickers(new URL('https://w.dev/stickers/set?name=../x'), env, tg(calls))).status, 400);
  assert.equal((await stickers(new URL('https://w.dev/stickers/file?id=a/b'), env, tg(calls))).status, 400);
  assert.equal((await stickers(new URL('https://w.dev/stickers/set?name=Nope'), env, tg(calls))).status, 404);
  assert.equal((await stickers(new URL('https://w.dev/stickers/set?name=Pack1'), {}, tg(calls))).status, 503);
  assert.equal(calls.length, 1);
});
