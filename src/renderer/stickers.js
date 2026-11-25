// Telegram stickers, the way Telegram shows them: a panel with "Recently
// used" and every pack below each other, and a strip of pack icons (the
// pack's first sticker) to jump between them – the mouse wheel scrolls the
// strip sideways. "+" adds a pack by its link. Packs are kept on this
// computer (settings.stickerPacks: names; settings.stickerRecent: last used).
import { h, toast, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { t as tr } from './i18n.js';

const RECENT = 24;
const urls = new Map(); // file id -> object URL (kept while the app runs)

function picture(file) {
  if (!urls.has(file)) {
    urls.set(file, window.api.stickerPicture(file).then((p) => URL.createObjectURL(new Blob([p.bytes], { type: p.mime }))));
    urls.get(file).catch(() => urls.delete(file));
  }
  return urls.get(file);
}

let open = null;

export function stickerPanel(editor, anchor) {
  if (open) { open.close(); return; }
  const app = editor.app;
  const s = app.settings;
  s.stickerPacks ||= [];
  s.stickerRecent ||= [];
  const packs = new Map(); // name -> pack

  const grid = h('div', { class: 'stk-grid-wrap' });
  const strip = h('div', { class: 'stk-strip', role: 'tablist', 'aria-label': tr('Sticker packs') });
  const adder = h('div', { class: 'stk-add', hidden: true });
  const link = h('input', { class: 'input', type: 'text', placeholder: 't.me/addstickers/…', 'aria-label': 'Sticker pack link' });
  const status = h('small', { class: 'hint' }, '');
  adder.append(h('div', { class: 'row' }, link, h('button', { class: 'btn small', onclick: () => add() }, 'Add pack')), status);
  const panel = h('div', { class: 'stk-panel', role: 'dialog', 'aria-label': tr('Stickers') }, adder, grid, strip);

  const cell = (st, pack) => {
    const img = h('img', { alt: st.emoji || 'sticker', draggable: false });
    const b = h('button', { class: 'stk', title: st.emoji || '', onclick: () => put(st, pack) }, img);
    picture(st.file).then((u) => { img.src = u; }, () => b.classList.add('bad'));
    return b;
  };
  const section = (key, title, list, pack) => h('section', { class: 'stk-sec', dataset: { key } },
    h('div', { class: 'stk-sec-title no-i18n' }, title), h('div', { class: 'stk-grid' }, ...list.map((st) => cell(st, pack))));

  const draw = () => {
    const recent = s.stickerRecent.filter((r) => packs.has(r.pack)).map((r) => ({ ...(packs.get(r.pack).stickers.find((x) => x.file === r.file) || { file: r.file }), pack: r.pack }));
    grid.replaceChildren(
      ...(recent.length ? [section('recent', tr('Recently used'), recent, null)] : []),
      ...s.stickerPacks.filter((n) => packs.has(n)).map((n) => section(n, packs.get(n).title, packs.get(n).stickers, n)));
    if (!s.stickerPacks.length) grid.append(h('div', { class: 'stk-empty hint' }, tr('Add a Telegram sticker pack with "+": paste its link, like t.me/addstickers/…')));
    const tab = (key, label, inner) => h('button', { class: 'stk-tab', role: 'tab', title: label, 'aria-label': label, dataset: { key }, onclick: () => jump(key),
      oncontextmenu: key === 'recent' ? null : (e) => { e.preventDefault(); remove(key); } }, inner);
    strip.replaceChildren(
      ...(recent.length ? [tab('recent', tr('Recently used'), h('span', { html: icon('history', 18) }))] : []),
      ...s.stickerPacks.filter((n) => packs.has(n)).map((n) => {
        const img = h('img', { alt: '', draggable: false });
        const first = packs.get(n).stickers[0];
        if (first) picture(first.file).then((u) => { img.src = u; }, () => {});
        return tab(n, packs.get(n).title, img);
      }),
      h('button', { class: 'stk-tab stk-plus', title: tr('Add a sticker pack'), 'aria-label': tr('Add a sticker pack'), html: icon('plus', 18), onclick: () => { adder.hidden = !adder.hidden; if (!adder.hidden) link.focus(); } }));
    mark();
  };
  const jump = (key) => { const sec = grid.querySelector(`.stk-sec[data-key="${CSS.escape(key)}"]`); if (sec) grid.scrollTo({ top: sec.offsetTop - grid.offsetTop, behavior: 'smooth' }); };
  // the strip shows which section is in view
  const mark = () => {
    let cur = null;
    for (const sec of grid.querySelectorAll('.stk-sec')) if (sec.offsetTop - grid.offsetTop - 8 <= grid.scrollTop) cur = sec.dataset.key;
    cur ||= grid.querySelector('.stk-sec')?.dataset.key;
    for (const t of strip.querySelectorAll('.stk-tab[data-key]')) t.setAttribute('aria-selected', String(t.dataset.key === cur));
  };
  grid.addEventListener('scroll', mark, { passive: true });
  // like Telegram: the wheel scrolls the strip sideways
  strip.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); strip.scrollLeft += e.deltaY; } }, { passive: false });

  const load = async () => {
    await Promise.all(s.stickerPacks.map((n) => window.api.stickerPack(n).then((p) => packs.set(n, p), () => {})));
    draw();
  };
  const add = async () => {
    status.textContent = tr('Loading…');
    try {
      const pack = await window.api.stickerPack(link.value);
      packs.set(pack.name, pack);
      if (!s.stickerPacks.includes(pack.name)) { s.stickerPacks.push(pack.name); app.saveSettings(); }
      link.value = ''; adder.hidden = true;
      status.textContent = '';
      toast(`${pack.title} · ${pack.stickers.length} ${tr('stickers')}`);
      draw();
      jump(pack.name);
    } catch (err) { status.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  };
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } if (e.key === 'Escape') { e.stopPropagation(); adder.hidden = true; } });
  const remove = async (name) => {
    if (!(await confirmDialog(tr('Remove pack'), `Remove the sticker pack "${packs.get(name)?.title || name}"?`, { okLabel: 'Remove' }))) return;
    s.stickerPacks = s.stickerPacks.filter((x) => x !== name);
    s.stickerRecent = s.stickerRecent.filter((r) => r.pack !== name);
    app.saveSettings();
    await window.api.stickerRemove(name).catch(() => {});
    packs.delete(name);
    draw();
  };
  const put = async (st, pack) => {
    try {
      const p = await window.api.stickerPicture(st.file);
      const point = editor.tools.basePastePoint();
      const it = await editor.insertImageBytes(p.bytes, p.mime, point);
      // stickers come at 512 px: a sticker-like size on the page
      const k = Math.min(1, 110 / Math.max(it.w, it.h));
      it.w = Math.round(it.w * k * 100) / 100; it.h = Math.round(it.h * k * 100) / 100;
      it.x = Math.round((point.x - it.w / 2) * 100) / 100; it.y = Math.round((point.y - it.h / 2) * 100) / 100;
      editor.tools.placeObjects(point.index, { items: [it] });
      const from = pack || st.pack;
      s.stickerRecent = [{ file: st.file, pack: from }, ...s.stickerRecent.filter((r) => r.file !== st.file)].slice(0, RECENT);
      app.saveSettings();
      close();
    } catch (err) { toast(String(err.message || err), { error: true }); }
  };

  const outside = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target) && !e.target.closest('.modal-backdrop')) close(); };
  const key = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) close(); };
  const close = () => { panel.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key); anchor.setAttribute('aria-expanded', 'false'); open = null; };
  document.body.append(panel);
  const r = anchor.getBoundingClientRect();
  panel.style.top = r.bottom + 8 + 'px';
  panel.style.left = Math.max(8, Math.min(r.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 8)) + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key); });
  anchor.setAttribute('aria-expanded', 'true');
  open = { close };
  draw();
  load();
}
