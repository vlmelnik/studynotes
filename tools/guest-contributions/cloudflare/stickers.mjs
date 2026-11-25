// Telegram sticker packs for StudyNotes: the bot token stays here (secret
// TELEGRAM_BOT_TOKEN), the app only asks for a pack by name and for its files.
//   GET /stickers/set?name=<pack>  → { name, title, stickers: [{ file, emoji, kind, w, h }] }
//   GET /stickers/file?id=<file>   → the picture (WebP / WebM / TGS; animated ones come as their still thumbnail)
const NAME = /^[A-Za-z0-9_]{1,64}$/;
const FILE = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_FILE = 2 * 1024 * 1024;

const reply = (status, value, cache = 'no-store') => Response.json(value, { status, headers: { 'cache-control': cache, 'access-control-allow-origin': '*' } });

export async function stickers(url, env, fetchImpl = fetch) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) return reply(503, { error: 'Stickers are not set up.' });
  const api = async (method, params) => {
    const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}?${new URLSearchParams(params)}`);
    const j = await r.json().catch(() => null);
    return j && j.ok ? j.result : null;
  };
  if (url.pathname === '/stickers/set') {
    const name = url.searchParams.get('name') || '';
    if (!NAME.test(name)) return reply(400, { error: 'Not a sticker pack name.' });
    const set = await api('getStickerSet', { name });
    if (!set) return reply(404, { error: 'No sticker pack with this name.' });
    const out = (set.stickers || []).map((s) => {
      const still = !s.is_animated && !s.is_video;
      const pic = still ? s : (s.thumbnail || s.thumb);
      return pic && { file: pic.file_id, emoji: s.emoji || '', kind: still ? 'static' : 'still', w: pic.width || s.width, h: pic.height || s.height };
    }).filter(Boolean);
    return reply(200, { name: set.name, title: set.title, stickers: out }, 'public, max-age=3600');
  }
  if (url.pathname === '/stickers/file') {
    const id = url.searchParams.get('id') || '';
    if (!FILE.test(id)) return reply(400, { error: 'Not a file id.' });
    const f = await api('getFile', { file_id: id });
    if (!f || !f.file_path || (f.file_size && f.file_size > MAX_FILE)) return reply(404, { error: 'No such file.' });
    const r = await fetchImpl(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
    if (!r.ok) return reply(502, { error: 'Telegram did not send the file.' });
    const ext = f.file_path.split('.').pop().toLowerCase();
    const type = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext];
    if (!type) return reply(415, { error: 'Not a picture.' });
    return new Response(r.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' } });
  }
  return new Response(null, { status: 404 });
}
