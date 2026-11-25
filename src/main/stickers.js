'use strict';
// Telegram sticker packs through the StudyNotes worker (the bot token stays
// there, see tools/guest-contributions/cloudflare/stickers.mjs). Packs and
// pictures are kept in userData/stickers, so a pack works offline afterwards.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const BASE = process.env.STUDYNOTES_STICKER_URL || 'https://studynotes-contributions.studynotes-vlmelnik.workers.dev';

/** "t.me/addstickers/Name", "https://telegram.me/addstickers/Name" or just "Name" → Name */
function packName(link) {
  const s = String(link || '').trim();
  const m = /(?:t(?:elegram)?\.me\/addstickers\/|tg:\/\/addstickers\?set=)([A-Za-z0-9_]{1,64})/.exec(s) || /^([A-Za-z0-9_]{1,64})$/.exec(s);
  return m ? m[1] : null;
}

class Stickers {
  constructor(dir) { this.dir = dir; }

  async get(url) {
    const r = await fetch(BASE + url);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(r.status === 404 ? 'No sticker pack with this name.' : r.status === 429 ? 'Too many requests – try again in a minute.' : j.error || `Sticker service error (${r.status})`);
    }
    return r;
  }

  async pack(link) {
    const name = packName(link);
    if (!name) throw new Error('Paste a link like t.me/addstickers/PackName.');
    const file = path.join(this.dir, name + '.json');
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* not kept yet */ }
    const j = await (await this.get('/stickers/set?name=' + encodeURIComponent(name))).json();
    const pack = { name: j.name, title: j.title, stickers: (j.stickers || []).slice(0, 200) };
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(pack));
    return pack;
  }

  async picture(id) {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(id))) throw new Error('bad sticker');
    const file = path.join(this.dir, 'files', id + '.img');
    try { return { bytes: await fsp.readFile(file), mime: 'image/webp' }; } catch { /* download */ }
    const r = await this.get('/stickers/file?id=' + id);
    const bytes = Buffer.from(await r.arrayBuffer());
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, bytes);
    return { bytes, mime: r.headers.get('content-type') || 'image/webp' };
  }

  async remove(name) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) return;
    await fsp.rm(path.join(this.dir, name + '.json'), { force: true });
  }
}

module.exports = { Stickers, packName };
