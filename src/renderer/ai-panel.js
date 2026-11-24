// The AI panel (1.9, docs/ROADMAP-1.9.md): ask about the notebook, a page or
// the selected text boxes, or let the AI change them. Shows before sending
// what goes out; the AI answers with an edit plan (src/shared/ai-plan.js)
// that is checked and previewed, and applied as one undo step.
import { h, toast } from './ui.js';
import { t as tr } from './i18n.js';
import { buildContext, buildRequest, estimateTokens } from '../shared/ai-context.js';
import { checkPlan, applyPlan, describePlan, parsePlan } from '../shared/ai-plan.js';
import { uid } from './tools.js';

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

  close() { if (this.el) { this.el.remove(); this.el = null; } }

  ready() { return !!(this.cfg.enabled && this.cfg.provider && this.cfg.model); }

  open() {
    const ed = this.editor;
    this.close();
    const sel = ed.tools.sel && ed.tools.sel.textIds && ed.tools.sel.textIds.size ? { page: ed.tools.sel.index + 1, ids: [...ed.tools.sel.textIds] } : null;
    this.scope = sel ? 'selection' : 'page';
    this.selection = sel;
    const body = h('div', { class: 'ai-body' });
    this.el = h('div', { class: 'ai-panel', role: 'dialog', 'aria-label': tr('AI assistant') },
      h('div', { class: 'ai-head' }, h('b', {}, 'AI assistant'), h('small', { class: 'ai-model no-i18n' }, this.ready() ? `${this.cfg.provider} · ${this.cfg.model}` : ''),
        h('button', { class: 'btn ghost small', title: 'Close', onclick: () => this.close() }, '×')),
      body);
    ed.el.append(this.el);
    if (!this.ready()) {
      body.append(h('p', { class: 'hint' }, 'Choose an AI provider and model first (Settings → Add-ons → AI assistant). With a Claude subscription, use "Claude (MCP)" there instead.'),
        h('button', { class: 'btn', onclick: () => { this.close(); ed.app.showSettings('addons'); } }, 'Open settings'));
      return;
    }
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
