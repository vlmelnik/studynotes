// The AI panel (1.9, docs/ROADMAP-1.9.md): ask about the notebook, a page or
// the selected text boxes, or let the AI change them. Shows before sending
// what goes out; the AI answers with an edit plan (src/shared/ai-plan.js)
// that is checked and previewed, and applied as one undo step.
import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { t as tr } from './i18n.js';
import { buildContext, buildRequest, estimateTokens } from '../shared/ai-context.js';
import { checkPlan, applyPlan, describePlan, parsePlan } from '../shared/ai-plan.js';
import { uid } from './tools.js';
import { escHtml } from '../shared/util.js';
import { notesStyleEditor } from './notes-style.js';
import { speechSettings, transcribe } from './speech.js';
import { micButton } from './dictation.js';

const newChat = () => ({ id: 'ch' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), title: '', sessionId: null, messages: [] });

// saved without the screen elements and the "working" state
function saveChat(chat) {
  const messages = chat.messages.map(({ el, pending, ...m }) => m);
  window.api.chatSave({ id: chat.id, title: chat.title, notebook: chat.notebook, sessionId: chat.sessionId, messages }).catch((err) => console.warn('chat not saved', err));
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// a picture Claude cannot take as it is (too big, or not PNG/JPEG/GIF/WebP) → a JPEG of at most 2000 px
async function shrinkImage(bytes, mime) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
}

// Claude's answers: a little Markdown (bold, italic, code, headings, lists) without raw HTML
export function mdHtml(text) {
  const inline = (s) => escHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>');
  const out = [];
  let list = null;
  for (const line of String(text || '').split('\n')) {
    const li = /^\s*(?:[-*•]|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      const tag = li[1] ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { if (list) out.push(`</${list.tag}>`); list = { tag }; out.push(`<${tag}>`); }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list.tag}>`); list = null; }
    const hd = /^#{1,4}\s+(.*)$/.exec(line);
    if (hd) out.push(`<p class="md-h">${inline(hd[1])}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list.tag}>`);
  return out.join('');
}

// chat events from the main process, by message id (one listener for all editors)
const chatHandlers = new Map();
if (window.api && window.api.onChatEvent) window.api.onChatEvent((id, ev) => { const f = chatHandlers.get(id); if (f) f(ev); });

const ACTIONS = [
  { label: 'Summarise', mode: 'edit', prompt: 'Summarise this in short points. Put the summary on a new page right after the last page shown, titled "Summary". Keep formulas.' },
  { label: 'Explain', mode: 'ask', prompt: 'Explain this simply, step by step, as for an exam. Answer only, change nothing.' },
  { label: 'Glossary', mode: 'edit', prompt: 'List the key terms with a one-line definition each. Put them on a new page right after the last page shown, titled "Glossary".' },
  { label: 'Underline key terms', mode: 'edit', prompt: 'Underline the key terms in the text boxes (only "underline" changes, nothing else).' },
  { label: 'Exam questions', mode: 'edit', prompt: 'Write 5 to 10 exam questions with short answers about this. Put them on a new page right after the last page shown, titled "Questions".' },
];

export class AiPanel {
  constructor(editor) {
    this.editor = editor;
    this.el = null;
    this.busy = false;
  }

  get settings() { return this.editor.app.settings; }
  get cfg() { return this.settings.ai || {}; }

  toggle() { if (this.el) this.close(); else this.open(); }

  close() { if (this.el) { this.el.remove(); this.el = null; this.editor.el.classList.remove('ai-open'); this.editor.viewer.scheduleUpdate(); } }

  // Claude Code (the user's subscription) needs no provider or model here
  ready() { return !!(this.cfg.enabled && (this.cfg.via === 'claudecode' || (this.cfg.provider && this.cfg.model))); }

  get isChat() { return this.cfg.via === 'claudecode'; }

  open() {
    const ed = this.editor;
    this.close();
    const sel = ed.tools.sel && ed.tools.sel.textIds && ed.tools.sel.textIds.size ? { page: ed.tools.sel.index + 1, ids: [...ed.tools.sel.textIds] } : null;
    this.scope = sel ? 'selection' : 'page';
    this.selection = sel;
    const body = h('div', { class: 'ai-body' });
    // a panel on the right like search: the page gets narrower, nothing is covered
    this.el = h('aside', { class: 'ai-panel', role: 'complementary', 'aria-label': tr('AI assistant') },
      h('div', { class: 'ai-head' }, h('span', { class: 'ai-head-ic', html: icon('ai', 18) }), h('b', { class: 'ai-title' }, 'AI assistant'),
        h('small', { class: 'ai-model no-i18n' }, !this.ready() ? '' : this.isChat ? `Claude Code${this.cfg.ccModel ? ' · ' + this.cfg.ccModel : ''}` : `${this.cfg.provider} · ${this.cfg.model}`),
        ...(this.isChat && this.ready() ? this.chatHeadButtons() : []),
        h('button', { class: 'icon-btn', title: 'Close (Ctrl+J)', html: icon('close', 16), onclick: () => this.close() })),
      body);
    // drag the left edge to make the panel wider or narrower (remembered)
    const W = (v) => Math.max(280, Math.min(Math.round(v), Math.max(320, ed.body.clientWidth - 360)));
    this.el.style.width = W(this.settings.aiPanelWidth || 360) + 'px';
    const grip = h('div', { class: 'ai-resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': tr('Resize the AI panel'), title: tr('Drag to resize') });
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = this.el.offsetWidth;
      const move = (ev) => { this.el.style.width = W(w0 + x0 - ev.clientX) + 'px'; ed.viewer.scheduleUpdate(); };
      const up = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
        this.settings.aiPanelWidth = this.el.offsetWidth; ed.app.saveSettings(); ed.viewer.scheduleUpdate();
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });
    this.el.prepend(grip);
    if (ed.el.classList.contains('searching')) ed.searchPanel.close?.();
    ed.body.append(this.el);
    ed.el.classList.add('ai-open');
    ed.viewer.scheduleUpdate();
    if (!this.ready()) {
      const claude = !!ed.app.settings.mcp && (this.cfg.via === 'claude');
      body.append(h('div', { class: 'ai-empty' },
        h('span', { class: 'ai-empty-ic', html: icon('ai', 34) }),
        h('b', {}, claude ? 'You use the Claude app' : 'Set up the AI assistant'),
        h('p', {}, claude
          ? 'Ask Claude in the Claude app – it can read this notebook and change it. For this panel, add an API key or a local model.'
          : 'Choose how to connect: the Claude app with your subscription, an API key (Anthropic, OpenAI, Gemini) or a model on this computer.'),
        h('button', { class: 'btn primary', onclick: () => { this.close(); ed.app.showSettings('ai'); } }, 'Open AI settings')));
      return;
    }
    if (this.isChat) { this.openChat(body); return; }
    const chip = (key, label, enabled = true) => h('button', { class: `btn small ai-chip${this.scope === key ? ' active' : ''}`, disabled: !enabled, onclick: (e) => {
      this.scope = key;
      for (const b of e.currentTarget.parentNode.children) b.classList.toggle('active', b === e.currentTarget);
      this.updateInfo();
    } }, label);
    this.prompt = h('textarea', { class: 'ai-prompt', rows: 3, placeholder: tr('Ask or tell the AI what to do…'), oninput: () => this.updateInfo(),
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send('edit'); } } });
    this.allowRemove = h('input', { type: 'checkbox' });
    this.info = h('small', { class: 'hint ai-info' });
    this.result = h('div', { class: 'ai-result' });
    body.append(
      h('div', { class: 'ai-scope' }, chip('selection', 'Selection', !!sel), chip('page', 'This page'), chip('notebook', 'Notebook')),
      h('div', { class: 'ai-actions' }, ...ACTIONS.map((a) => h('button', { class: 'btn small', onclick: () => this.send(a.mode, a.prompt) }, a.label))),
      this.prompt,
      h('label', { class: 'ai-check' }, this.allowRemove, h('span', {}, 'Allow removing text')),
      h('div', { class: 'ai-send' }, this.info, h('button', { class: 'btn primary', onclick: () => this.send('edit') }, 'Send')),
      this.result);
    this.updateInfo();
    this.prompt.focus();
  }

  // ---------- chat with Claude Code (the user's subscription) ----------
  openChat(body) {
    const ed = this.editor;
    this.chatBody = body;
    body.classList.add('chat-body');
    this.chat ||= newChat();
    this.files ||= [];
    // drop files anywhere on the panel
    this.el.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); this.el.classList.add('drop'); } });
    this.el.addEventListener('dragleave', (e) => { if (e.target === this.el) this.el.classList.remove('drop'); });
    this.el.addEventListener('drop', (e) => { this.el.classList.remove('drop'); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); this.addFiles(e.dataTransfer.files); } });
    if (!ed.app.settings.mcp) ed.app.mcp.setEnabled(true).catch((err) => toast(String(err.message || err), { error: true }));
    this.showChatView(this.chatView || 'chat');
  }

  // the header buttons of the chat: history, settings, new chat
  chatHeadButtons() {
    const b = (ic, title, view) => h('button', { class: `icon-btn${this.chatView === view ? ' active' : ''}`, title, 'aria-label': title, html: icon(ic, 16), onclick: () => this.showChatView(this.chatView === view ? 'chat' : view) });
    return [b('history', 'Chat history', 'history'), b('settings', 'Chat settings', 'settings'),
      h('button', { class: 'icon-btn', title: 'New chat', 'aria-label': 'New chat', html: icon('plus', 16), onclick: () => { this.stopChat(); this.chat = newChat(); this.files = []; this.chatView = 'chat'; this.open(); } })];
  }

  showChatView(view) {
    this.chatView = view;
    const body = this.chatBody;
    if (!body) return;
    for (const btn of this.el.querySelectorAll('.ai-head .icon-btn[aria-label]')) {
      const v = { 'Chat history': 'history', 'Chat settings': 'settings' }[btn.getAttribute('aria-label')];
      if (v) btn.classList.toggle('active', v === view);
    }
    body.replaceChildren();
    if (view === 'history') this.historyView(body);
    else if (view === 'settings') this.settingsView(body);
    else this.chatMain(body);
  }

  chatMain(body) {
    this.msgs = h('div', { class: 'chat-msgs', role: 'log', 'aria-live': 'polite' });
    for (const m of this.chat.messages) this.msgs.append(this.bubble(m));
    if (!this.chat.messages.length) this.msgs.append(h('div', { class: 'chat-hello' }, h('span', { html: icon('ai', 28) }),
      h('p', {}, 'Ask Claude about this notebook or tell it what to do: "Summarise page 3 on a new page", "Make a glossary of the terms", "Underline the key terms on this page".'),
      h('small', { class: 'hint wrap' }, 'Runs your Claude Code with your Claude plan. Claude reads and changes notes only through StudyNotes; Ctrl+Z undoes every change.'),
      h('small', { class: 'hint wrap' }, 'Attach pictures, PDFs, text files or recordings with the paper clip, by dragging them here or with Ctrl+V.')));
    this.input = h('textarea', { class: 'ai-prompt chat-input', rows: 2, placeholder: tr('Message Claude…'), 'aria-label': tr('Message Claude'),
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.sendChat(); } },
      onpaste: (e) => { const f = e.clipboardData && e.clipboardData.files; if (f && f.length) { e.preventDefault(); this.addFiles(f); } } });
    const picker = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,audio/*,.pdf,.txt,.md,.csv,.json,.tex,.m4a,.mp3,.wav,.ogg,.webm,.opus', onchange: (e) => { this.addFiles(e.target.files); e.target.value = ''; } });
    this.fileChips = h('div', { class: 'chat-files' });
    this.sendBtn = h('button', { class: 'btn primary', onclick: () => (this.running ? this.stopChat() : this.sendChat()) }, this.running ? 'Stop' : 'Send');
    body.append(this.msgs, this.fileChips,
      h('div', { class: 'chat-compose' }, picker,
        h('button', { class: 'icon-btn chat-attach', title: 'Attach files', 'aria-label': 'Attach files', html: icon('attach', 18), onclick: () => picker.click() }),
        micButton(this.editor.app, { className: 'icon-btn chat-mic', target: () => ({ insert: (text) => {
          const v = this.input.value;
          this.input.value = v + (v && !/\s$/.test(v) ? ' ' : '') + text;
          this.input.scrollTop = this.input.scrollHeight;
        } }) }),
        this.input, this.sendBtn));
    this.drawFiles();
    this.msgs.scrollTop = this.msgs.scrollHeight;
    this.input.focus();
  }

  // ---------- attachments ----------
  async addFiles(list) {
    const app = this.editor.app;
    app.chatFiles ||= new Map();
    for (const f of [...list]) {
      const mime = f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : /\.(txt|md|csv|json|tex)$/i.test(f.name) ? 'text/plain' : /\.(m4a|mp3|wav|ogg|opus|webm|flac|aac)$/i.test(f.name) ? 'audio/' + f.name.split('.').pop().toLowerCase() : '');
      const kind = mime.startsWith('image/') ? 'picture' : mime === 'application/pdf' ? 'pdf' : mime.startsWith('text/') || /json/.test(mime) ? 'text' : mime.startsWith('audio/') ? 'audio' : '';
      if (!kind) { toast(`${tr('Cannot attach')} "${f.name}": ${tr('only pictures, PDFs, text files and recordings')}`, { error: true }); continue; }
      if (kind === 'audio') { this.addAudio(f); continue; }
      if (f.size > (kind === 'pdf' ? 30e6 : kind === 'text' ? 2e6 : 40e6)) { toast(`"${f.name}" ${tr('is too large')}`, { error: true }); continue; }
      let bytes = new Uint8Array(await f.arrayBuffer());
      let type = mime;
      if (kind === 'picture' && (bytes.length > 3.5e6 || !/^image\/(png|jpeg|gif|webp)$/.test(mime))) ({ bytes, mime: type } = await shrinkImage(bytes, mime));
      const id = 'a' + (app.chatFiles.size + 1);
      const file = { id, name: f.name || `${kind}.${type.split('/')[1]}`, mime: type, kind, bytes };
      app.chatFiles.set(id, file);
      this.files.push(file);
    }
    this.drawFiles();
  }

  // audio becomes text on this computer first (add-on "Speech to text"); Claude gets the transcript
  async addAudio(f) {
    const ed = this.editor;
    const cfg = speechSettings(this.settings);
    if (!cfg.enabled) {
      toast(tr('Switch on "Speech to text" in Settings → Add-ons to attach recordings.'), { error: true });
      return;
    }
    if (f.size > 500e6) { toast(`"${f.name}" ${tr('is too large')}`, { error: true }); return; }
    const app = ed.app;
    const id = 'a' + (app.chatFiles.size + 1);
    const file = { id, name: f.name.replace(/\.[^.]+$/, '') + ' (transcript).txt', mime: 'text/plain', kind: 'text', busy: 0, from: f.name };
    app.chatFiles.set(id, file);
    this.files.push(file);
    this.drawFiles();
    try {
      const text = await transcribe(new Uint8Array(await f.arrayBuffer()), cfg, (p) => { file.busy = p; this.drawFiles(); });
      file.bytes = new TextEncoder().encode(`Transcript of the recording "${f.name}" (${cfg.language}, made on this computer):\n${text}`);
      file.busy = null;
    } catch (err) {
      this.files = this.files.filter((x) => x !== file);
      app.chatFiles.delete(id);
      toast(`${tr('Could not transcribe')} "${f.name}": ${err.message || err}`, { error: true });
    }
    this.drawFiles();
  }

  drawFiles() {
    if (!this.fileChips) return;
    this.fileChips.replaceChildren(...this.files.map((f) => h('span', { class: 'chat-file no-i18n', title: f.name },
      h('span', { html: icon(f.from ? 'mic' : f.kind === 'picture' ? 'image' : 'page', 13) }), h('span', { class: 'chat-file-name' }, f.name),
      f.busy != null ? h('span', { class: 'chat-file-busy' }, h('span', { class: 'spinner small' }), f.busy > 0 && f.busy < 1 ? `${Math.round(f.busy * 100)}%` : tr('Transcribing…')) : null,
      h('button', { class: 'icon-btn', title: tr('Remove'), 'aria-label': `${tr('Remove')} ${f.name}`, html: icon('close', 11), onclick: () => { this.files = this.files.filter((x) => x !== f); this.drawFiles(); } }))));
    this.fileChips.hidden = !this.files.length;
  }

  bubble(m) {
    const el = h('div', { class: `chat-msg ${m.role}` });
    if (m.role === 'user') {
      if (m.files && m.files.length) el.append(h('div', { class: 'chat-files in-msg no-i18n' }, ...m.files.map((f) => h('span', { class: 'chat-file' }, h('span', { html: icon(f.kind === 'picture' ? 'image' : 'page', 13) }), h('span', { class: 'chat-file-name' }, f.name)))));
      el.append(h('div', { class: 'chat-text' }, m.text));
    } else {
      for (const part of m.parts) {
        if (part.tool) el.append(h('div', { class: 'chat-tool no-i18n' }, h('span', { html: icon(/^(read|search|list)/.test(part.tool) ? 'search' : 'pen', 12) }), part.tool.replace(/_/g, ' ')));
        else el.append(h('div', { class: 'chat-text md no-i18n', html: mdHtml(part.text) }));
      }
      if (m.error) el.append(h('div', { class: 'ai-error' }, m.error));
      if (m.pending) el.append(h('div', { class: 'ai-wait' }, h('div', { class: 'spinner small' }), h('span', {}, 'Claude is working…')));
    }
    m.el = el;
    return el;
  }

  redraw(m) { const old = m.el; const nu = this.bubble(m); if (old && old.parentNode) old.replaceWith(nu); if (this.msgs) this.msgs.scrollTop = this.msgs.scrollHeight; }

  // what Claude needs to know about where the user is
  chatContext(files) {
    const ed = this.editor;
    const sel = ed.tools.sel && ed.tools.sel.textIds && ed.tools.sel.textIds.size ? [...ed.tools.sel.textIds] : [];
    const mine = String(this.cfg.ccInstructions || '').trim();
    return `[StudyNotes: the user has the notebook "${ed.doc.nb.title}" (path: ${ed.rel}) open at page ${ed.viewer.currentIndex + 1} of ${ed.pages.length}`
      + (sel.length ? `; selected text boxes on that page: ${sel.join(', ')}` : '')
      + (files.length ? `; attached to this message: ${files.map((f) => `${f.id} = "${f.name}" (${f.kind})`).join(', ')}`
        + (files.some((f) => f.kind === 'picture') ? ' – to put a picture into the notes use a write_notes image block with its id as "ref"' : '') : '')
      + '. Read and change notes only with the StudyNotes tools; the user sees changes at once and can undo them with Ctrl+Z. Answer in the language of the message.]'
      + (mine ? `\n[The user's standing instructions: ${mine}]` : '');
  }

  async sendChat() {
    const text = this.input.value.trim();
    if (this.files.some((f) => f.busy != null)) { toast(tr('Wait until the recording is transcribed.')); return; }
    const files = this.files.slice();
    if ((!text && !files.length) || this.running) return;
    this.input.value = '';
    this.files = [];
    this.drawFiles();
    if (this.msgs.querySelector('.chat-hello')) this.msgs.replaceChildren();
    const chat = this.chat;
    if (!chat.title) chat.title = (text || files[0].name).replace(/\s+/g, ' ').slice(0, 80);
    chat.notebook = { path: this.editor.rel, title: this.editor.doc.nb.title };
    const user = { role: 'user', text, files: files.map(({ id, name, kind }) => ({ id, name, kind })) };
    const reply = { role: 'assistant', parts: [], pending: true };
    chat.messages.push(user, reply);
    this.msgs.append(this.bubble(user), this.bubble(reply));
    this.msgs.scrollTop = this.msgs.scrollHeight;
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.running = id;
    this.sendBtn.textContent = tr('Stop');
    chatHandlers.set(id, (ev) => {
      if (ev.kind === 'session') chat.sessionId = ev.sessionId;
      else if (ev.kind === 'text') reply.parts.push({ text: ev.text });
      else if (ev.kind === 'tool') reply.parts.push({ tool: ev.name });
      else if (ev.kind === 'done') {
        chatHandlers.delete(id);
        if (ev.sessionId) chat.sessionId = ev.sessionId;
        reply.pending = false;
        if (ev.error) reply.error = ev.error;
        else if (!reply.parts.some((x) => x.text)) reply.parts.push({ text: tr('(done)') });
        this.running = null;
        if (this.sendBtn && this.sendBtn.isConnected) this.sendBtn.textContent = tr('Send');
        saveChat(chat);
      }
      if (this.el && this.chat === chat && this.chatView === 'chat') this.redraw(reply);
    });
    if (!this.editor.app.settings.mcp) await this.editor.app.mcp.setEnabled(true).catch(() => {});
    await this.editor.flush?.();
    // text files go into the message, pictures and PDFs as attachments Claude sees
    let prompt = `${this.chatContext(files)}\n\n${text}`;
    for (const f of files.filter((x) => x.kind === 'text')) prompt += `\n\n--- ${f.name} ---\n${new TextDecoder().decode(f.bytes).slice(0, 200000)}`;
    const attachments = files.filter((x) => x.kind !== 'text').map((f) => ({ name: f.name, mime: f.mime, data: toBase64(f.bytes) }));
    window.api.chatSend(id, { prompt, attachments, sessionId: chat.sessionId, model: this.cfg.ccModel || '', bin: this.cfg.ccPath || '' });
  }

  stopChat() {
    if (!this.running) return;
    window.api.chatStop(this.running);
  }

  // ---------- history (all chats, on this computer) ----------
  async historyView(body) {
    const list = h('div', { class: 'chat-history' }, h('div', { class: 'hint' }, 'Loading…'));
    body.append(h('div', { class: 'chat-sub' }, h('b', {}, 'Chat history'), h('small', { class: 'hint' }, 'All chats, saved on this computer.')), list);
    const chats = await window.api.chatList().catch(() => []);
    if (!chats.length) { list.replaceChildren(h('div', { class: 'hint' }, 'No chats yet.')); return; }
    list.replaceChildren(...chats.map((c) => h('div', { class: `chat-hist-row${this.chat && this.chat.id === c.id ? ' current' : ''}` },
      h('button', { class: 'chat-hist-open', onclick: async () => {
        const full = await window.api.chatGet(c.id);
        if (!full) return;
        this.stopChat();
        this.chat = { ...newChat(), ...full, messages: (full.messages || []).map((m) => ({ ...m, pending: false })) };
        this.showChatView('chat');
      } }, h('b', { class: 'no-i18n' }, c.title || tr('Untitled chat')),
        h('small', { class: 'hint no-i18n' }, `${c.notebook && c.notebook.title ? c.notebook.title + ' · ' : ''}${new Date(c.updated).toLocaleString()}`)),
      h('button', { class: 'icon-btn', title: tr('Delete chat'), 'aria-label': `${tr('Delete chat')} ${c.title || ''}`, html: icon('trash', 14), onclick: async (e) => {
        e.stopPropagation();
        await window.api.chatDelete(c.id);
        if (this.chat && this.chat.id === c.id) this.chat = newChat();
        this.showChatView('history');
      } }))));
  }

  // ---------- chat settings ----------
  settingsView(body) {
    const ed = this.editor;
    const cfg = this.settings.ai;
    const save = () => ed.app.saveSettings();
    const model = h('select', { class: 'rec-select', 'aria-label': 'Claude Code model', onchange: (e) => { cfg.ccModel = e.target.value; save(); } },
      ...[['', 'Default'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']].map(([v, l]) => h('option', { value: v, selected: (cfg.ccModel || '') === v }, l)));
    const mine = h('textarea', { class: 'ai-prompt', rows: 4, 'aria-label': 'Your instructions for Claude', placeholder: tr('For example: answer in German; keep summaries short; always add exam questions at the end.'),
      onchange: (e) => { cfg.ccInstructions = e.target.value.trim(); save(); } });
    mine.value = cfg.ccInstructions || '';
    body.append(h('div', { class: 'chat-settings' },
      h('div', { class: 'chat-sub' }, h('b', {}, 'Chat settings')),
      h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Model'), model),
      h('div', { class: 'settings-h3' }, 'Your instructions for Claude'),
      h('small', { class: 'hint wrap' }, 'Sent with every message.'), mine,
      h('div', { class: 'settings-h3' }, 'Notes style of this notebook'),
      h('small', { class: 'hint wrap' }, 'Changes here apply to this notebook only. The style for all notebooks is in Settings → AI assistant.'),
      notesStyleEditor(ed.doc.nb.notesStyle, (v) => { ed.doc.nb.notesStyle = Object.keys(v).length ? v : undefined; ed.nbDirty = true; ed.saveSoon(); },
        { base: this.settings.notesStyle, resetLabel: 'Use the app style' })));
  }

  context() {
    const ed = this.editor;
    const pages = ed.pages;
    const pageData = Object.fromEntries(pages.map((p) => [p.id, ed.pageData(p.id)]));
    const budget = Number(this.cfg.budget) || 60000;
    return buildContext({ title: ed.doc.nb.title, pages }, pageData, ed.doc.textIndexes || {}, {
      current: ed.viewer.currentIndex + 1, selection: this.selection, scope: this.scope, budget,
    });
  }

  // what goes out, before it goes out
  updateInfo() {
    if (!this.info) return;
    const c = this.context();
    const pagesText = c.pagesSent.length === 0 ? 'no pages' : c.pagesSent.length === 1 ? `page ${c.pagesSent[0]}` : `${c.pagesSent.length} pages`;
    this.info.textContent = `${tr('Sends')} ${pagesText}, ~${c.used.toLocaleString()} ${tr('characters')} (~${estimateTokens(c.text).toLocaleString()} tokens) ${tr('to')} ${this.cfg.provider}${c.dropped.length ? ` · ${c.dropped.length} ${tr('pages left out (size limit)')}` : ''}`;
  }

  async send(mode, preset) {
    if (this.busy) return;
    const prompt = preset || this.prompt.value.trim();
    if (!prompt) { this.prompt.focus(); return; }
    const ed = this.editor;
    const ctx = this.context();
    const req = buildRequest({ prompt, context: ctx.text, mode, custom: this.cfg.custom || '' });
    this.busy = true;
    this.result.replaceChildren(h('div', { class: 'ai-wait' }, h('div', { class: 'spinner small' }), h('span', {}, 'The AI is working…')));
    let answer;
    try {
      answer = await window.api.aiRequest({ provider: this.cfg.provider, model: this.cfg.model, baseUrl: this.cfg.baseUrl, monthlyLimit: this.cfg.monthlyLimit ?? 200 }, req);
    } catch (err) {
      this.busy = false;
      this.result.replaceChildren(h('p', { class: 'ai-error' }, String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
      return;
    }
    this.busy = false;
    if (!this.el) return;
    const plan = parsePlan(answer.text);
    if (!plan) { this.showAnswer(answer.text, null); return; }
    const notebook = { pages: ed.pages, data: (id) => ed.pageData(id) };
    const checked = checkPlan(mode === 'ask' ? { ...plan, ops: [] } : plan, notebook, { allowRemove: this.allowRemove.checked });
    this.showAnswer(plan.answer || plan.summary || '', checked);
  }

  showAnswer(text, checked) {
    const ed = this.editor;
    const out = [];
    if (text && text.trim()) out.push(h('div', { class: 'ai-answer' }, text.trim()));
    if (checked && (checked.ops.length || checked.problems.length)) {
      const lines = describePlan(checked.ops, ed.pages);
      const boxes = lines.map(() => h('input', { type: 'checkbox', checked: true }));
      out.push(h('div', { class: 'ai-plan' },
        h('b', {}, 'Proposed changes'),
        ...lines.map((l, i) => h('label', { class: 'ai-op' }, boxes[i], h('span', { class: 'no-i18n' }, l))),
        ...checked.problems.map((p) => h('div', { class: 'ai-problem' }, `${tr('Left out')}: ${p.reason}`)),
        checked.ops.length ? h('div', { class: 'ai-plan-btns' },
          h('button', { class: 'btn primary', onclick: () => {
            // a page left out also drops the changes on that page
            const keep = checked.ops.filter((_, i) => boxes[i].checked);
            const dropped = new Set(checked.ops.filter((op, i) => op.op === 'addPage' && !boxes[i].checked).map((op) => op.pageId));
            const ops = keep.filter((op) => !dropped.has(op.pageId) && !dropped.has(op.toId));
            if (!ops.length) return;
            this.apply(ops);
          } }, 'Apply'),
          h('button', { class: 'btn', onclick: () => this.result.replaceChildren() }, 'Discard')) : null));
    }
    if (!out.length) out.push(h('p', { class: 'hint' }, 'The AI had nothing to add.'));
    this.result.replaceChildren(...out);
  }

  apply(ops) {
    const ed = this.editor;
    const r = applyPlan({ pages: ed.pages, data: (id) => ed.pageData(id) }, ops, {
      newId: uid, fontSize: ed.toolState.text.size || 14, color: ed.toolState.pen.color || '#1c1c1e', font: ed.toolState.text.ff,
    });
    ed.commitPlan(r);
    const first = r.added[0] || (r.changes[0] && r.changes[0].pageId);
    const idx = ed.pages.findIndex((p) => p.id === first);
    if (idx >= 0) ed.viewer.scrollToPage(idx);
    this.result.replaceChildren(h('p', { class: 'hint' }, `${tr('Applied')}: ${ops.length} ${tr('changes')}. Ctrl+Z ${tr('undoes them')}.`));
    toast('AI changes applied – Ctrl+Z undoes them');
    this.updateInfo();
  }
}
