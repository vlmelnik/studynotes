// Small extra windows of the app (index.html#sub=…): the floating reference
// reader. They share the bundle with the main window but none of its state.
import { h } from './ui.js';
import { icon } from './icons.js';
import { dictation } from './dictation.js';
import { setLang } from './i18n.js';
import { ReaderView } from './reader-view.js';

export async function bootSub(kind) {
  const info = await window.api.info();
  const s = info.settings || {};
  const pref = s.theme || 'light';
  document.documentElement.dataset.theme = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  setLang(s.lang || 'en');
  document.body.classList.add('sub', 'sub-' + kind);
  window.__app = { settings: s, sub: kind };
  if (kind === 'reader') return readerWindow();
  if (kind === 'study') return studyBar();
  if (kind === 'snip') return snipWindow();
  if (kind === 'sniplive') return snipLive();
}

function readerWindow() {
  const root = document.getElementById('app');
  let view = null;
  const show = async (state) => {
    if (view) view.destroy();
    const dock = h('button', { class: 'icon-btn rd-dock', title: 'Put the reader into the main window', 'aria-label': 'Dock', html: icon('sidebar', 16),
      onclick: () => window.api.readerDock(view.state) });
    const close = h('button', { class: 'icon-btn', title: 'Close the reader', 'aria-label': 'Close the reader', html: icon('close', 16), onclick: () => window.close() });
    view = new ReaderView({ ...state, buttons: [dock, close], onState: (st) => window.api.readerReport(st).catch(() => {}) });
    window.__reader = view;
    root.replaceChildren(view.el);
    await view.open();
  };
  window.api.onReaderState((st) => show(st));
}

// ---------- study session bar ----------
// small and half see-through: time, how much was collected, a mic for spoken notes, Finish
const KIND_LABEL = { region: 'Region', window: 'Window', page: 'Screen', text: 'Text', note: 'Note' };

function studyBar() {
  const root = document.getElementById('app');
  let st = null;
  const clock = h('span', { class: 'sb-clock no-i18n' }, '0:00');
  const count = h('span', { class: 'sb-count', title: 'Collected' }, '0');
  const msg = h('div', { class: 'sb-msg' }, '');
  const size = () => window.api.studyBarHeight(44 + (msg.textContent ? 24 : 0));
  const say = (m) => { msg.textContent = m || ''; size(); if (m) setTimeout(() => { if (msg.textContent === m) { msg.textContent = ''; size(); } }, 4000); };
  // spoken note: everything said until the second click becomes one note
  let spoken = [];
  const mic = h('button', { class: 'icon-btn sb-btn sb-mic', title: 'Spoken note', 'aria-label': 'Spoken note', 'aria-pressed': 'false', html: icon('mic', 17) });
  mic.addEventListener('click', async () => {
    if (dictation.on) { await dictation.stop(); return; }
    const sp = (st && st.speech) || {};
    if (!sp.enabled) { say('Set up dictation once with the mic in StudyNotes'); return; }
    spoken = [];
    try {
      await dictation.start({ settings: { speech: sp }, onText: (t) => { spoken.push(t); say(spoken.join(' ').slice(-80)); },
        onState: (x) => {
          if ('on' in x) { mic.classList.toggle('on', x.on); mic.setAttribute('aria-pressed', String(x.on)); if (!x.on && spoken.length) { window.api.studyNote(spoken.join(' ')); spoken = []; } }
          if ('level' in x) mic.style.setProperty('--level', String(Math.min(1, x.level * 12)));
        } });
    } catch (err) { say(String(err.message || err)); }
  });
  const bar = h('div', { class: 'sb-bar' },
    h('span', { class: 'sb-dot' }), clock, count,
    h('span', { class: 'sb-sep' }), mic,
    h('button', { class: 'btn btn-primary small sb-finish', onclick: () => window.api.studyFinish(false) }, 'Finish'),
    h('button', { class: 'icon-btn sb-btn', title: 'Stop without filing', 'aria-label': 'Stop without filing', html: icon('close', 15), onclick: () => window.api.studyFinish(true) }));
  bar.title = 'Select text or copy a picture · Ctrl + drag: a region · Alt + click: a window · Alt+S: the screen · Ctrl+E: pause';
  root.replaceChildren(bar, msg);
  const draw = () => {
    if (!st) return;
    count.textContent = String(st.items.length);
    count.title = Object.entries(st.summary.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${KIND_LABEL[k]}`).join(', ') || 'Nothing yet';
  };
  setInterval(() => { if (!st) return; const s = Math.floor((Date.now() - st.startedAt) / 1000); clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
  window.api.onStudyState((x) => { const before = st ? st.items.length : 0; st = x; draw(); if (x.items.length > before) { count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump'); } });
  window.api.onStudyError(say);
  window.api.studyState().then((x) => { st = x; draw(); });
}

// ---------- region snip (full screen over the screenshot) ----------
function snipWindow() {
  const root = document.getElementById('app');
  const img = h('img', { class: 'snip-img', alt: '', draggable: false });
  const box = h('div', { class: 'snip-box', hidden: true });
  const hint = h('div', { class: 'snip-hint' }, 'Drag around what you want to keep · Esc cancels');
  root.replaceChildren(img, h('div', { class: 'snip-shade' }), box, hint);
  window.api.onSnipImage((url) => { img.src = url; });
  let a = null;
  addEventListener('pointerdown', (e) => { a = { x: e.clientX, y: e.clientY }; box.hidden = false; Object.assign(box.style, { left: a.x + 'px', top: a.y + 'px', width: '0px', height: '0px' }); hint.hidden = true; });
  addEventListener('pointermove', (e) => {
    if (!a) return;
    Object.assign(box.style, { left: Math.min(a.x, e.clientX) + 'px', top: Math.min(a.y, e.clientY) + 'px', width: Math.abs(e.clientX - a.x) + 'px', height: Math.abs(e.clientY - a.y) + 'px' });
  });
  addEventListener('pointerup', (e) => {
    if (!a) return;
    const r = { x: Math.min(a.x, e.clientX), y: Math.min(a.y, e.clientY), width: Math.abs(e.clientX - a.x), height: Math.abs(e.clientY - a.y) };
    a = null;
    window.api.snipDone(r.width > 4 && r.height > 4 ? r : null);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.snipDone(null); });
}

// Ctrl + drag anywhere: a dark veil over the screen with the rectangle being drawn (the mouse goes through)
function snipLive() {
  const box = h('div', { class: 'snip-box live', hidden: true });
  document.getElementById('app').replaceChildren(h('div', { class: 'snip-veil' }), box);
  window.api.onSnipRect((r) => {
    if (!r) { box.hidden = true; document.body.classList.remove('drawing'); return; }
    box.hidden = false;
    Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.classList.add('drawing');
  });
}
