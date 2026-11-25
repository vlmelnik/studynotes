// Study session in the main window: the start dialog, and at the end the
// review of what was collected – then Claude files it into the notebook as
// nicely laid-out notes, or StudyNotes lays it out itself (no AI).
import { h, modal, toast } from './ui.js';
import { icon } from './icons.js';
import { t as tr } from './i18n.js';
import { uid } from './tools.js';
import { groups, forPrompt, removeItem } from '../shared/capture-session.js';
import { layoutNotes, notesStyle } from '../shared/notes-layout.js';
import { FONTS, DEFAULT_FONT } from '../shared/fonts.js';

export function startStudy(editor) {
  const topic = h('input', { class: 'input', type: 'text', value: editor.doc.nb.title, 'aria-label': 'Topic' });
  const prompt = h('textarea', { class: 'ai-prompt', rows: 3, 'aria-label': 'What the notes should be like (optional)', placeholder: tr('For example: focus on the formulas and add exam questions at the end.') });
  modal({
    title: 'Study session', width: 520,
    body: h('div', { class: 'study-start' },
      h('p', { class: 'hint wrap' }, 'StudyNotes steps aside and a small bar stays on top of every app. Read, scroll and open other documents as usual:'),
      h('ul', { class: 'study-how' },
        h('li', {}, h('b', {}, 'Ctrl+C'), ' – copied text and pictures are collected'),
        h('li', {}, h('b', {}, 'Ctrl+Shift+1'), ' – a region of the screen'),
        h('li', {}, h('b', {}, 'Ctrl+Shift+2'), ' – a window'),
        h('li', {}, h('b', {}, 'Ctrl+Shift+3'), ' – the whole screen')),
      h('p', { class: 'hint wrap' }, 'Finish on the bar: Claude turns everything into notes in this notebook.'),
      h('label', { class: 'field' }, h('span', {}, 'Topic'), topic),
      h('label', { class: 'field' }, h('span', {}, 'What the notes should be like (optional)'), prompt)),
    actions: [{ label: 'Cancel', result: null }, { label: 'Start', primary: true, value: () => {
      window.api.studyStart({ topic: topic.value.trim(), prompt: prompt.value.trim(), rel: editor.rel }).catch((err) => toast(String(err.message || err), { error: true }));
      return true;
    } }],
  });
}

const fileName = (it) => `${it.kind}-${it.id}.png`;

/** The session came back: show what was collected, then file it. */
export async function reviewStudy(app, st) {
  let session = { topic: st.topic, prompt: st.prompt, startedAt: Date.now() - st.summary.minutes * 60000, items: st.items };
  const urls = [];
  const bytes = new Map(); // hash -> Uint8Array
  const pic = async (hash) => { if (!bytes.has(hash)) bytes.set(hash, new Uint8Array(await window.api.studyImage(hash))); return bytes.get(hash); };
  const topic = h('input', { class: 'input', type: 'text', value: st.topic, 'aria-label': 'Topic' });
  const prompt = h('textarea', { class: 'ai-prompt', rows: 2, 'aria-label': 'What the notes should be like', placeholder: tr('For example: focus on the formulas and add exam questions at the end.') });
  prompt.value = st.prompt || '';
  const list = h('div', { class: 'study-items' });
  const draw = () => {
    list.replaceChildren(...groups(session).map((g) => h('div', { class: 'study-group' },
      h('div', { class: 'study-group-title no-i18n' }, g.label),
      h('div', { class: 'study-group-items' }, ...g.items.map((it) => {
        const rm = h('button', { class: 'icon-btn study-rm', title: tr('Leave out'), 'aria-label': `${tr('Leave out')} ${it.id}`, html: icon('close', 12), onclick: () => { session = removeItem(session, it.id); draw(); } });
        if (it.image) {
          const img = h('img', { alt: it.kind });
          pic(it.image.hash).then((b) => { const u = URL.createObjectURL(new Blob([b], { type: 'image/png' })); urls.push(u); img.src = u; }, () => {});
          return h('div', { class: 'study-item pic', dataset: { id: it.id } }, img, rm);
        }
        return h('div', { class: `study-item txt${it.kind === 'note' ? ' note' : ''} no-i18n`, dataset: { id: it.id } }, h('span', {}, (it.text || '').slice(0, 280)), rm);
      })))));
    if (!session.items.length) list.append(h('div', { class: 'hint' }, 'Nothing was collected.'));
  };
  draw();
  const ed = await openFor(app, st.rel);
  const canAI = !!(ed && ed.aiPanel.ready() && ed.aiPanel.isChat);
  const dlg = modal({
    title: 'Study session – file into the notebook', width: 760,
    body: h('div', { class: 'study-review' },
      h('div', { class: 'hint' }, `${session.items.length} ${tr('items')} · ${st.summary.minutes} min`),
      h('label', { class: 'field' }, h('span', {}, 'Topic'), topic),
      h('label', { class: 'field' }, h('span', {}, 'What the notes should be like'), prompt),
      list,
      canAI ? null : h('small', { class: 'hint wrap' }, 'For notes written by Claude, set up the AI assistant with Claude Code (Settings → AI assistant). Without it StudyNotes lays the material out as it is.')),
    actions: [
      { label: 'Discard', result: null },
      { label: 'Lay out without AI', value: () => { file(app, ed, session, topic.value, null, pic); return true; } },
      ...(canAI ? [{ label: 'Claude writes the notes', primary: true, value: () => { file(app, ed, session, topic.value, prompt.value, pic); return true; } }] : []),
    ],
    onClose: () => setTimeout(() => { for (const u of urls) URL.revokeObjectURL(u); }, 60000),
  });
  return dlg;
}

async function openFor(app, rel) {
  if (rel && (!app.active || app.active.rel !== rel)) {
    try { await app.openNotebook(rel); } catch { /* gone: use what is open */ }
  }
  return app.active;
}

async function file(app, ed, session, topic, prompt, pic) {
  if (!ed) { toast(tr('Open a notebook first.'), { error: true }); return; }
  if (!session.items.length) return;
  try {
    if (prompt != null) await withClaude(ed, session, topic, prompt, pic);
    else await layOut(ed, session, topic, pic);
  } catch (err) { console.error('study filing', err); toast(String(err.message || err), { error: true }); }
}

// Claude gets the pictures as attachments and the text as material
async function withClaude(ed, session, topic, prompt, pic) {
  const panel = ed.aiPanel;
  if (!panel.el) panel.open();
  if (panel.chatView !== 'chat') panel.showChatView('chat');
  const pics = session.items.filter((it) => it.image);
  const before = (panel.files || []).length;
  await panel.addFiles(await Promise.all(pics.map(async (it) => new File([await pic(it.image.hash)], fileName(it), { type: 'image/png' }))));
  const added = panel.files.slice(before);
  const ids = new Map(pics.map((it, i) => [it.id, added[i] && added[i].id]));
  let material = forPrompt(session).text;
  for (const [cid, aid] of ids) if (aid) material = material.replace(new RegExp(`^\\[${cid}\\]`, 'm'), `[${aid}]`);
  panel.input.value = `Study session "${topic || ed.doc.nb.title}" – turn the material below into well-structured, nicely laid-out study notes in this notebook with write_notes, `
    + 'starting on the next empty page (place "next_page"). Order it by theme, not by where it came from: a level-1 heading with the topic, sections, key terms in bold, definitions, '
    + 'formulas as formula blocks, the pictures where they belong (image blocks with their ids, with a short caption), and a box with the main points at the end. '
    + 'Leave out repeats and things that do not belong to the topic.'
    + (prompt ? `\nThe user's wishes: ${prompt}` : '')
    + `\n\nMaterial (${session.items.length} items; [id] (kind, source) content):\n${material}`;
  await panel.sendChat();
}

// No AI: the material as it is, grouped by source, laid out on the lines
async function layOut(ed, session, topic, pic) {
  const images = {};
  const index = ed.viewer.currentIndex;
  for (const it of session.items.filter((x) => x.image)) {
    const item = await ed.insertImageBytes(await pic(it.image.hash), 'image/png', { index, x: 0, y: 0 });
    images[it.id] = { src: item.src, w: item.w, h: item.h };
  }
  const blocks = [{ type: 'heading', level: 1, text: topic || ed.doc.nb.title }];
  for (const g of groups(session)) {
    blocks.push({ type: 'heading', level: 2, text: g.label });
    for (const it of g.items) {
      if (it.image) blocks.push({ type: 'image', ref: it.id, size: it.kind === 'region' ? 'medium' : 'full', caption: it.url || '' });
      else if (it.kind === 'note') blocks.push({ type: 'paragraph', tone: 'note', text: it.text });
      else blocks.push({ type: 'paragraph', text: it.text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n') });
    }
  }
  const canvas = document.createElement('canvas').getContext('2d');
  const measure = (t, r) => { const f = FONTS[r.ff] || FONTS[DEFAULT_FONT]; canvas.font = `${r.i ? 'italic ' : ''}${r.b ? '700' : '400'} ${r.fs || 15}px "${f.css}", sans-serif`; return canvas.measureText(t).width; };
  const style = notesStyle(ed.app.settings.notesStyle, ed.doc.nb.notesStyle);
  const r = layoutNotes(blocks.filter((b) => b.type !== 'paragraph' || String(b.text || '').trim()), index, {
    pages: ed.pages, data: (id) => ed.pageData(id), style, measure, newId: uid, images, place: 'next',
    newPage: (ref) => { const s = ed.styleOf(ref); return { id: uid(), kind: 'paper', paper: ref.kind === 'pdf' || s.paper === 'blank' || ref.paper === 'cover' ? 'lined' : s.paper, ...(s.pc && s.pc !== 'cream' ? { pc: s.pc } : {}), w: s.w, h: s.h }; },
  });
  ed.commitPlan(r);
  if (r.placed[0]) ed.viewer.scrollToPage(r.placed[0].index);
  toast(tr('The study session is in the notebook – Ctrl+Z undoes it'));
}
