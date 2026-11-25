'use strict';
// A study session: what the user collected from the whole screen (regions,
// windows, whole screens, copied text, own notes) until the AI or the layout
// files it into the notebook. Pure: pictures are referenced by hash only.

const KINDS = ['region', 'window', 'page', 'text', 'note'];
const MERGE_MS = 10 * 60 * 1000;
const BROWSERS = [[/^(.*) - Google Chrome$/, 'Chrome'], [/^(.*) [—-] Mozilla Firefox$/, 'Firefox'], [/^(.*) - (?:Personal - )?Microsoft[\s​]*Edge$/, 'Edge']];

function newSession({ id, topic = '', prompt = '', startedAt = 0 } = {}) {
  return { id: String(id || ''), topic: String(topic), prompt: String(prompt), startedAt: Number(startedAt) || 0, items: [] };
}

/** "<page title> - Google Chrome" → { app, title, url } (url only when the title looks like an address). */
function parseTitle(win = '', app = '') {
  for (const [re, name] of BROWSERS) {
    const m = re.exec(String(win));
    if (m) {
      const t = m[1].trim();
      const url = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(t) && !/\s/.test(t) ? (/^https?:\/\//.test(t) ? t : 'https://' + t) : null;
      return { app: name, title: t, url };
    }
  }
  return { app: app || '', title: String(win || ''), url: null };
}

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();

function addItem(session, raw) {
  if (!KINDS.includes(raw.kind)) throw new Error(`Unknown kind "${raw.kind}"`);
  const src = raw.app || raw.title ? parseTitle(raw.title, raw.app) : { app: '', title: '', url: null };
  const item = {
    id: String(raw.id), kind: raw.kind, at: Number(raw.at) || 0, app: src.app, title: src.title, url: raw.url || src.url,
    text: raw.text != null ? String(raw.text) : null, image: raw.image ? { hash: String(raw.image.hash), width: raw.image.width | 0, height: raw.image.height | 0 } : null, count: 1,
  };
  // the same picture, or the same text within ten minutes: counted, not added again
  const dup = session.items.findIndex((x) => (item.image && x.image && x.image.hash === item.image.hash)
    || (!item.image && !x.image && item.text && norm(x.text) === norm(item.text) && Math.abs(item.at - x.at) <= MERGE_MS));
  if (dup >= 0) {
    const items = session.items.slice();
    items[dup] = { ...items[dup], count: items[dup].count + 1 };
    return { ...session, items };
  }
  return { ...session, items: [...session.items, item] };
}

function removeItem(session, id) { return { ...session, items: session.items.filter((x) => x.id !== id) }; }

/** Items by source (same app and page) in the order they first came, with a short label. */
function groups(session) {
  const out = [];
  const by = new Map();
  for (const it of [...session.items].sort((a, b) => a.at - b.at)) {
    const key = it.kind === 'note' ? 'note' : `${it.app}\u0000${it.url || it.title}`;
    let g = by.get(key);
    if (!g) {
      const label = it.kind === 'note' ? 'Own notes' : [it.app, it.title].filter(Boolean).join(': ') || 'Collected';
      g = { key, label: label.length > 80 ? label.slice(0, 77) + '…' : label, app: it.app, title: it.title, url: it.url, items: [] };
      by.set(key, g); out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

/** The session for the AI: '[c7] (window, Chrome: <title>) <text>' per item, within a character budget. */
function forPrompt(session, { budget = 60000 } = {}) {
  const lines = [];
  const refs = {};
  let used = 0, cut = 0;
  for (const g of groups(session)) {
    for (const it of g.items) {
      const where = it.kind === 'note' ? 'own note' : `${it.kind}${g.label && g.label !== 'Screen' ? ', ' + g.label : ''}`;
      const body = it.image ? `picture ${it.image.width}x${it.image.height}` + (it.text ? ` – ${norm(it.text)}` : '') : norm(it.text);
      const line = `[${it.id}] (${where}) ${body}`;
      if (used + line.length + 1 > budget) { cut++; continue; }
      used += line.length + 1;
      lines.push(line);
      if (it.image) refs[it.id] = it.image.hash;
    }
  }
  if (cut) lines.push(`(${cut} more item${cut === 1 ? '' : 's'} left out: too long)`);
  return { text: lines.join('\n'), refs };
}

function summary(session, now = 0) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const it of session.items) counts[it.kind]++;
  const last = session.items.reduce((m, it) => Math.max(m, it.at), session.startedAt);
  return { counts, total: session.items.length, minutes: Math.round(((now || last) - session.startedAt) / 60000) };
}

module.exports = { KINDS, newSession, addItem, removeItem, parseTitle, groups, forPrompt, summary };
