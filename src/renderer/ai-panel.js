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
      h('div', { class: 'ai-head' }, h('span', { class: 'ai-head-ic', html: icon('ai', 18) }), h('b', {}, 'AI assistant'),
        h('small', { class: 'ai-model no-i18n' }, !this.ready() ? '' : this.isChat ? `Claude Code${this.cfg.ccModel ? ' · ' + this.cfg.ccModel : ''}` : `${this.cfg.provider} · ${this.cfg.model}`),
        this.isChat && this.ready() ? h('button', { class: 'btn ghost small', title: 'Start a new conversation', onclick: () => { this.stopChat(); this.chat = null; this.open(); } }, 'New chat') : null,
        h('button', { class: 'icon-btn', title: 'Close (Ctrl+J)', html: icon('close', 16), onclick: () => this.close() })),
      body);
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
    this.chat ||= { sessionId: null, messages: [] };
    this.msgs = h('div', { class: 'chat-msgs', role: 'log', 'aria-live': 'polite' });
    for (const m of this.chat.messages) this.msgs.append(this.bubble(m));
    if (!this.chat.messages.length) this.msgs.append(h('div', { class: 'chat-hello' }, h('span', { html: icon('ai', 28) }),
      h('p', {}, 'Ask Claude about this notebook or tell it what to do: "Summarise page 3 on a new page", "Make a glossary of the terms", "Underline the key terms on this page".'),
      h('small', { class: 'hint wrap' }, 'Runs your Claude Code with your Claude plan. Claude reads and changes notes only through StudyNotes; Ctrl+Z undoes every change.')));
    this.input = h('textarea', { class: 'ai-prompt chat-input', rows: 2, placeholder: tr('Message Claude…'), 'aria-label': tr('Message Claude'),
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.sendChat(); } } });
    this.sendBtn = h('button', { class: 'btn primary', onclick: () => (this.running ? this.stopChat() : this.sendChat()) }, this.running ? 'Stop' : 'Send');
    body.classList.add('chat-body');
    body.append(this.msgs, h('div', { class: 'chat-compose' }, this.input, this.sendBtn));
    this.msgs.scrollTop = this.msgs.scrollHeight;
    this.input.focus();
    if (!ed.app.settings.mcp) ed.app.mcp.setEnabled(true).catch((err) => toast(String(err.message || err), { error: true }));
  }

  bubble(m) {
    const el = h('div', { class: `chat-msg ${m.role}` });
    if (m.role === 'user') el.append(h('div', { class: 'chat-text' }, m.text));
    else {
      for (const part of m.parts) {
        if (part.tool) el.append(h('div', { class: 'chat-tool no-i18n' }, h('span', { html: icon(part.tool.startsWith('read') || part.tool.startsWith('search') || part.tool.startsWith('list') ? 'search' : 'pen', 12) }), part.tool.replace(/_/g, ' ')));
        else el.append(h('div', { class: 'chat-text' }, part.text));
      }
      if (m.error) el.append(h('div', { class: 'ai-error' }, m.error));
      if (m.pending) el.append(h('div', { class: 'ai-wait' }, h('div', { class: 'spinner small' }), h('span', {}, 'Claude is working…')));
    }
    m.el = el;
    return el;
  }

  redraw(m) { const old = m.el; const nu = this.bubble(m); if (old && old.parentNode) old.replaceWith(nu); this.msgs.scrollTop = this.msgs.scrollHeight; }

  // what Claude needs to know about where the user is
  chatContext() {
    const ed = this.editor;
    const sel = ed.tools.sel && ed.tools.sel.textIds && ed.tools.sel.textIds.size ? [...ed.tools.sel.textIds] : [];
    return `[StudyNotes: the user has the notebook "${ed.doc.nb.title}" (path: ${ed.rel}) open at page ${ed.viewer.currentIndex + 1} of ${ed.pages.length}`
      + (sel.length ? `; selected text boxes on that page: ${sel.join(', ')}` : '')
      + '. Read and change notes only with the StudyNotes tools; the user sees changes at once and can undo them with Ctrl+Z. Answer in the language of the message.]';
  }

  async sendChat() {
    const text = this.input.value.trim();
    if (!text || this.running) return;
    this.input.value = '';
    if (this.msgs.querySelector('.chat-hello')) this.msgs.replaceChildren();
    const user = { role: 'user', text };
    const reply = { role: 'assistant', parts: [], pending: true };
    this.chat.messages.push(user, reply);
    this.msgs.append(this.bubble(user), this.bubble(reply));
    this.msgs.scrollTop = this.msgs.scrollHeight;
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.running = id;
    this.sendBtn.textContent = tr('Stop');
    chatHandlers.set(id, (ev) => {
      if (ev.kind === 'session') this.chat.sessionId = ev.sessionId;
      else if (ev.kind === 'text') reply.parts.push({ text: ev.text });
      else if (ev.kind === 'tool') reply.parts.push({ tool: ev.name });
      else if (ev.kind === 'done') {
        chatHandlers.delete(id);
        if (ev.sessionId) this.chat.sessionId = ev.sessionId;
        reply.pending = false;
        if (ev.error) reply.error = ev.error;
        else if (!reply.parts.some((x) => x.text)) reply.parts.push({ text: tr('(done)') });
        this.running = null;
        if (this.sendBtn) this.sendBtn.textContent = tr('Send');
      }
      if (this.el) this.redraw(reply);
    });
    if (!this.editor.app.settings.mcp) await this.editor.app.mcp.setEnabled(true).catch(() => {});
    await this.editor.flush?.();
    window.api.chatSend(id, { prompt: `${this.chatContext()}\n\n${text}`, sessionId: this.chat.sessionId, model: this.cfg.ccModel || '', bin: this.cfg.ccPath || '' });
  }

  stopChat() {
    if (!this.running) return;
    window.api.chatStop(this.running);
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
