// Telegram stickers: paste a pack link once, then pick stickers to put on the
// page. Packs are kept on this computer (settings.stickerPacks: names).
import { h, modal, toast } from './ui.js';
import { icon } from './icons.js';
import { t as tr } from './i18n.js';

export function stickerPicker(editor) {
  const app = editor.app;
  const s = app.settings;
  s.stickerPacks ||= [];
  const tabs = h('div', { class: 'stk-tabs', role: 'tablist' });
  const grid = h('div', { class: 'stk-grid' });
  const link = h('input', { class: 'input', type: 'text', placeholder: 't.me/addstickers/…', 'aria-label': 'Sticker pack link' });
  const status = h('small', { class: 'hint' }, '');
  let current = null;
  const urls = [];

  const show = async (name) => {
    current = name;
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.name === name));
    grid.replaceChildren(h('div', { class: 'hint' }, tr('Loading…')));
    let pack;
    try { pack = await window.api.stickerPack(name); } catch (err) { grid.replaceChildren(h('div', { class: 'ai-error' }, String(err.message || err))); return; }
    if (current !== name) return;
    grid.replaceChildren(...pack.stickers.map((st) => {
      const img = h('img', { alt: st.emoji || 'sticker', loading: 'lazy' });
      const b = h('button', { class: 'stk', title: st.emoji || '', onclick: () => put(st) }, img);
      window.api.stickerPicture(st.file).then((p) => { const u = URL.createObjectURL(new Blob([p.bytes], { type: p.mime })); urls.push(u); img.src = u; }, () => b.classList.add('bad'));
      return b;
    }));
  };
  const drawTabs = () => {
    tabs.replaceChildren(...s.stickerPacks.map((n) => h('span', { class: 'stk-tab-wrap' },
      h('button', { class: 'chip stk-tab no-i18n', role: 'tab', dataset: { name: n }, onclick: () => show(n) }, n),
      h('button', { class: 'icon-btn', title: tr('Remove pack'), 'aria-label': `${tr('Remove pack')} ${n}`, html: icon('close', 11), onclick: async () => {
        s.stickerPacks = s.stickerPacks.filter((x) => x !== n); app.saveSettings(); await window.api.stickerRemove(n).catch(() => {});
        drawTabs(); if (current === n) { grid.replaceChildren(); current = null; if (s.stickerPacks[0]) show(s.stickerPacks[0]); }
      } }))));
  };
  const add = async () => {
    status.textContent = tr('Loading…');
    try {
      const pack = await window.api.stickerPack(link.value);
      if (!s.stickerPacks.includes(pack.name)) { s.stickerPacks.push(pack.name); app.saveSettings(); }
      link.value = '';
      status.textContent = `${pack.title} · ${pack.stickers.length} ${tr('stickers')}`;
      drawTabs();
      show(pack.name);
    } catch (err) { status.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  };
  const put = async (st) => {
    try {
      const p = await window.api.stickerPicture(st.file);
      const point = editor.tools.basePastePoint();
      const it = await editor.insertImageBytes(p.bytes, p.mime, point);
      // stickers come at 512 px: a sticker-like size on the page
      const k = Math.min(1, 110 / Math.max(it.w, it.h));
      it.w = Math.round(it.w * k * 100) / 100; it.h = Math.round(it.h * k * 100) / 100;
      it.x = Math.round((point.x - it.w / 2) * 100) / 100; it.y = Math.round((point.y - it.h / 2) * 100) / 100;
      editor.tools.placeObjects(point.index, { items: [it] });
      dlg.close(null);
    } catch (err) { toast(String(err.message || err), { error: true }); }
  };
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } });
  const dlg = modal({
    title: 'Telegram stickers', width: 560,
    body: h('div', { class: 'stk-body' },
      h('div', { class: 'row' }, link, h('button', { class: 'btn', onclick: add }, 'Add pack')), status, tabs, grid),
    actions: [{ label: 'Close', result: null }],
    onClose: () => { for (const u of urls) URL.revokeObjectURL(u); },
  });
  drawTabs();
  if (s.stickerPacks[0]) show(s.stickerPacks[0]);
}
