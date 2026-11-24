// Extension host (docs/EXTENSIONS.md, API version 1). Extensions live in
// src/extensions/<id>/ and reach the app only through the `host` object handed
// to activate(): paste transforms, inline elements in text boxes, menu items,
// a pass over rendered PDF pages, an ink colour filter, settings and a few UI
// helpers. Everything an extension registers is removed when it is switched
// off, and one broken extension never stops the app.
import builtIn from 'studynotes:extensions';
import { toast, promptDialog, confirmDialog } from './ui.js';
import { buildContext } from '../shared/ai-context.js';
import { checkPlan, applyPlan, describePlan, PLAN_SCHEMA } from '../shared/ai-plan.js';
import { uid } from './tools.js';
import { t as tr } from './i18n.js';
import { inlineKey } from '../shared/richtext.js';

const API_VERSION = 2; // 1: paste, inline, menus, view, settings, ui; 2: + ai, notebook
const API_VERSIONS = new Set([1, 2]);
const ID = /^[a-z0-9-]+$/;
const KIND = /^[a-z0-9-]+(?::[a-z0-9-]+)?$/;
const WHERE = new Set(['textbox-more', 'page-more', 'view']);

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function notebookSettings(id, getEditor, writable = false) {
  const get = (key, fallback) => {
    const value = getEditor()?.doc?.nb?.ext?.[id]?.[key];
    return value === undefined ? fallback : clone(value);
  };
  if (!writable) return Object.freeze({ get });
  return Object.freeze({ get, set(key, value) {
    const editor = getEditor();
    const nb = editor?.doc?.nb;
    if (!nb || editor.closing) return;
    ((nb.ext ||= {})[id] ||= {})[key] = clone(value);
    editor.nbDirty = true;
    editor.saveSoon();
  } });
}

class ExtensionHost {
  constructor() {
    this.app = null;
    this.entries = new Map(); // id -> { def, enabled, error, off: [] }
    this.transforms = []; // { id, fn, priority }
    this.inline = new Map(); // kind -> { id, def }
    this.menus = { 'textbox-more': [], 'page-more': [], view: [] }; // { id, item }
    this.passes = []; // { id, fn, when }
    this.ink = null; // { id, fn }
    this.blend = null; // { id, fn }
    this.pageEffects = new WeakMap(); // rendered bitmap -> effect state per extension
    this.classes = new Map(); // id -> Set(class names on the editor roots)
    this.watchers = []; // { id, key, fn }
    this.imageCache = new Map(); // export images by kind | value | style
  }

  // ---------- life cycle ----------
  init(app) {
    this.app = app;
    for (const def of builtIn) this.add(def);
  }

  add(def, { enabled } = {}) {
    const id = def && def.id;
    if (!id || !ID.test(id) || !API_VERSIONS.has(def.apiVersion) || typeof def.activate !== 'function') {
      console.warn('[extensions] skipped an extension with a missing id, apiVersion or activate()', def && def.id);
      return false;
    }
    if (this.entries.has(id)) this.setEnabled(id, false);
    this.entries.set(id, { def, enabled: false, error: null, off: [] });
    const on = enabled ?? this.store().enabled[id] ?? !!def.defaultEnabled;
    if (on) this.activate(id);
    return true;
  }

  list() {
    return [...this.entries.values()].map((e) => ({ id: e.def.id, name: e.def.name || e.def.id, description: e.def.description || '', icon: typeof e.def.icon === 'string' ? e.def.icon : null, enabled: e.enabled, error: e.error }));
  }

  isEnabled(id) { const e = this.entries.get(id); return !!(e && e.enabled); }

  setEnabled(id, on) {
    const e = this.entries.get(id);
    if (!e) return;
    const s = this.store();
    s.enabled[id] = !!on;
    this.save();
    if (on && !e.enabled) this.activate(id);
    if (!on && e.enabled) this.deactivate(id);
  }

  activate(id) {
    const e = this.entries.get(id);
    e.error = null;
    e.enabled = true;
    try {
      const undo = e.def.activate(this.hostFor(id));
      if (typeof undo === 'function') e.off.push(undo);
    } catch (err) {
      console.warn(`[extensions] ${id} failed to start`, err); // (the extension's fault: a warning, not an app error)
      this.deactivate(id);
      e.error = String((err && err.message) || err);
      toast(`${tr('Extension')} "${tr(e.def.name || id)}": ${tr('could not start and was switched off')}`, { error: true });
      return;
    }
    this.changed();
  }

  deactivate(id) {
    const e = this.entries.get(id);
    if (!e) return;
    e.enabled = false;
    for (const undo of e.off.splice(0).reverse()) { try { undo(); } catch (err) { console.error(`[extensions] ${id}: stopping`, err); } }
    this.transforms = this.transforms.filter((x) => x.id !== id);
    for (const [kind, x] of this.inline) if (x.id === id) this.inline.delete(kind);
    for (const k of Object.keys(this.menus)) this.menus[k] = this.menus[k].filter((x) => x.id !== id);
    this.passes = this.passes.filter((x) => x.id !== id);
    if (this.ink && this.ink.id === id) this.ink = null;
    if (this.blend && this.blend.id === id) this.blend = null;
    this.watchers = this.watchers.filter((x) => x.id !== id);
    this.classes.delete(id);
    for (const key of [...this.imageCache.keys()]) if (key.startsWith(id + ':') || key.startsWith(id + '|')) this.imageCache.delete(key);
    this.changed();
  }

  // Something visible changed: text boxes show their inline elements again,
  // PDF pages and ink are drawn again.
  changed() {
    if (!this.app) return;
    for (const { editor } of this.app.editors || []) {
      try {
        this.applyClasses(editor.el);
        if (editor.viewer) {
          this.refreshView(editor);
          for (const v of editor.viewer.views.values()) editor.renderObjects(v);
        }
      } catch (err) { console.error('[extensions] refresh', err); }
    }
  }

  refreshView(editor) {
    editor.viewer?.invalidateDisplayEffects();
    editor.tools?.refreshDisplayInk();
  }

  applyClasses(root) {
    if (!root) return;
    for (const c of [...root.classList]) if (c.startsWith('ext-')) root.classList.remove(c);
    for (const [id, set] of this.classes) for (const c of set) root.classList.add(`ext-${id}-${c}`);
  }

  // ---------- settings ----------
  store() {
    const s = (this.app && this.app.settings) || (this._mem ||= {});
    s.extensions ||= {};
    s.extensions.enabled ||= {};
    s.extensions.data ||= {};
    return s.extensions;
  }

  save() { if (this.app && this.app.saveSettings) this.app.saveSettings(); }

  // ---------- the object an extension gets ----------
  hostFor(id) {
    const host = this;
    const e = () => host.entries.get(id);
    const live = () => e() && e().enabled;
    const notify = (key, value) => { for (const w of host.watchers) if (w.id === id && w.key === key) { try { w.fn(value); } catch (err) { console.error(err); } } };
    return Object.freeze({
      id,
      apiVersion: API_VERSION,
      paste: Object.freeze({
        addTransform(fn, { priority = 0 } = {}) {
          if (typeof fn !== 'function' || !live()) return;
          host.transforms.push({ id, fn, priority: Number(priority) || 0 });
          host.transforms.sort((a, b) => b.priority - a.priority);
        },
      }),
      inline: Object.freeze({
        register(kind, def) {
          if (!live() || !KIND.test(kind) || (kind !== id && !kind.startsWith(id + ':'))) throw new Error(`inline kind "${kind}" must be "${id}" or "${id}:<name>"`);
          if (!def || typeof def.render !== 'function' || typeof def.toText !== 'function') throw new Error('inline.register needs render() and toText()');
          host.inline.set(kind, { id, def });
          host.changed();
        },
        // the stored element for a value (for transforms and menu actions)
        html(kind, value, { display = false } = {}) { return host.inlineHtml(kind, value, display); },
      }),
      menus: Object.freeze({
        add(where, item) {
          if (!live() || !WHERE.has(where) || !item || typeof item.run !== 'function' || !item.label) return;
          host.menus[where].push({ id, item });
        },
      }),
      view: Object.freeze({
        addPagePass(fn, { when } = {}) { if (live() && typeof fn === 'function') { host.passes.push({ id, fn, when }); host.changed(); } },
        setInkFilter(fn) { if (live()) { host.ink = typeof fn === 'function' ? { id, fn } : null; host.changed(); } },
        setHighlighterBlend(fn) { if (live()) { host.blend = typeof fn === 'function' ? { id, fn } : null; host.changed(); } },
        setClass(name, on) {
          if (!live() || !ID.test(name)) return;
          const set = host.classes.get(id) || new Set();
          if (on) set.add(name); else set.delete(name);
          host.classes.set(id, set);
          for (const { editor } of (host.app && host.app.editors) || []) host.applyClasses(editor.el);
        },
        refresh() { if (live()) host.changed(); },
      }),
      settings: Object.freeze({
        get(key, fallback) { const v = (host.store().data[id] || {})[key]; return v === undefined ? fallback : clone(v); },
        set(key, value) {
          const d = host.store().data;
          (d[id] ||= {})[key] = clone(value);
          host.save();
          notify(key, clone(value));
        },
        onChange(key, fn) { if (live() && typeof fn === 'function') host.watchers.push({ id, key, fn }); },
        notebook: notebookSettings(id, () => host.app?.active, true),
      }),
      ui: Object.freeze({
        toast: (text) => toast(String(text)),
        prompt: ({ title = '', value = '', multiline = false } = {}) => promptDialog(String(title), String(value), { multiline }),
        t: (text) => tr(String(text)),
      }),
      // API v2 (docs/ROADMAP-1.9.md): the user's AI provider and the open notebook
      ai: Object.freeze({
        ready: () => host.aiReady(),
        /** The user confirms what is sent; returns the model's text. */
        request: async ({ system = '', user = '', purpose = '' } = {}) => {
          if (!live()) throw new Error('extension is off');
          const cfg = host.aiConfig();
          if (!host.aiReady()) throw new Error(tr('Set up the AI assistant first (Settings → Add-ons).'));
          const chars = String(system).length + String(user).length;
          const name = tr(e().def.name || id);
          const ok = await confirmDialog(tr('Send to the AI?'), `${name}: ${String(purpose || tr('a request')).slice(0, 200)}\n~${chars.toLocaleString()} ${tr('characters')} → ${cfg.provider} · ${cfg.model}`, { okLabel: tr('Send') });
          if (!ok) throw new Error(tr('Cancelled'));
          const r = await window.api.aiRequest({ provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, monthlyLimit: cfg.monthlyLimit ?? 200 }, { system: String(system), user: String(user) });
          return r.text;
        },
        planSchema: () => JSON.parse(JSON.stringify(PLAN_SCHEMA)),
      }),
      notebook: Object.freeze({
        /** The open notebook's text with ids (as the AI panel sends it). */
        read: ({ scope = 'notebook', budget = 60000 } = {}) => {
          const ed = host.app && host.app.active;
          if (!ed || !live()) return null;
          const pageData = Object.fromEntries(ed.pages.map((p) => [p.id, ed.pageData(p.id)]));
          const c = buildContext({ title: ed.doc.nb.title, pages: ed.pages }, pageData, ed.doc.textIndexes || {}, { current: ed.viewer.currentIndex + 1, scope, budget });
          return { title: ed.doc.nb.title, pages: ed.pages.length, current: ed.viewer.currentIndex + 1, text: c.text, dropped: c.dropped };
        },
        preview: (plan, { allowRemove = false, refs = {} } = {}) => {
          const ed = host.app && host.app.active;
          if (!ed) return { ok: false, lines: [], problems: [{ index: -1, reason: 'no notebook is open' }] };
          const r = checkPlan(plan, { pages: ed.pages, data: (pid) => ed.pageData(pid) }, { allowRemove, refs });
          return { ok: r.ok, lines: describePlan(r.ops, ed.pages), problems: r.problems };
        },
        /** Applies the valid changes as one undo step: { applied, problems }. */
        apply: (plan, { allowRemove = false, refs = {} } = {}) => {
          const ed = host.app && host.app.active;
          if (!ed || !live()) throw new Error('no notebook is open');
          const r = checkPlan(plan, { pages: ed.pages, data: (pid) => ed.pageData(pid) }, { allowRemove, refs });
          if (r.ops.length) {
            ed.commitPlan(applyPlan({ pages: ed.pages, data: (pid) => ed.pageData(pid) }, r.ops, {
              newId: uid, fontSize: ed.toolState.text.size || 14, color: ed.toolState.pen.color || '#1c1c1e', font: ed.toolState.text.ff, refs,
            }));
          }
          return { applied: r.ops.length, problems: r.problems };
        },
      }),
      log: (...args) => console.log(`[${id}]`, ...args),
    });
  }

  aiConfig() { return (this.app && this.app.settings && this.app.settings.ai) || {}; }

  aiReady() { const c = this.aiConfig(); return !!(c.enabled && c.provider && c.model); }

  // ---------- used by the app ----------
  /** Paste: the first transform that claims the clipboard, or null. */
  pasteTransform({ html = '', text = '', target }) {
    for (const x of this.transforms) {
      try {
        const r = x.fn({ html: String(html || ''), text: String(text || ''), target });
        if (r && typeof r.html === 'string') return { html: r.html, by: x.id };
      } catch (err) { console.error(`[extensions] ${x.id}: paste`, err); }
    }
    return null;
  }

  fallbackText(kind, value, display, el) {
    const x = this.inline.get(kind);
    if (x) { try { return String(x.def.toText(value, { display })); } catch (err) { console.error(err); } }
    return el ? el.textContent : String(value);
  }

  inlineHtml(kind, value, display) {
    return `<span data-x="${escAttr(kind)}" data-v="${escAttr(value)}"${display ? ' data-display="1"' : ''}>${escText(this.fallbackText(kind, value, display))}</span>`;
  }

  /** Shows the inline elements inside a text box element (after its innerHTML was set). */
  renderInline(root, { color, fontSize } = {}) {
    if (!root || !root.querySelectorAll) return;
    for (const el of root.querySelectorAll('span[data-x]')) {
      const x = this.inline.get(el.dataset.x);
      if (!x) continue; // extension off: the fallback text stays
      el.contentEditable = 'false';
      el.classList.add('ext-inline');
      const display = el.dataset.display === '1';
      try {
        el.textContent = '';
        x.def.render(el, el.dataset.v || '', { display, color: color || getComputedStyle(root).color, fontSize: fontSize || parseFloat(getComputedStyle(root).fontSize) });
        el.dataset.rendered = '1';
      } catch (err) {
        console.error(`[extensions] ${x.id}: render`, err);
        el.textContent = this.fallbackText(el.dataset.x, el.dataset.v || '', display, null);
      }
    }
  }

  /** Double-click on a rendered element: ask its extension for a new value. */
  async editInline(el) {
    const x = this.inline.get(el.dataset.x);
    if (!x || typeof x.def.edit !== 'function') return null;
    try {
      const v = await x.def.edit(el.dataset.v || '', { display: el.dataset.display === '1' });
      return typeof v === 'string' ? v : null;
    } catch (err) { console.error(`[extensions] ${x.id}: edit`, err); return null; }
  }

  inlineToHtml(kind, value, display) {
    const x = this.inline.get(kind);
    if (x && typeof x.def.toHtml === 'function') { try { return String(x.def.toHtml(value, { display })); } catch (err) { console.error(err); } }
    return escText(this.fallbackText(kind, value, display));
  }

  /**
   * Pictures of the inline elements in `htmls` for the PDF export:
   * { 'kind|value|display|fontSize|color': { png: Uint8Array, width, height, baseline } }.
   */
  async exportImages(boxes) {
    const out = {};
    for (const { html, fs, color } of boxes) {
      if (!html || !html.includes('data-x')) continue;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      for (const el of tmp.querySelectorAll('span[data-x]')) {
        const kind = el.dataset.x, value = el.dataset.v || '', display = el.dataset.display === '1';
        const x = this.inline.get(kind);
        if (!x || typeof x.def.exportImage !== 'function') continue;
        const st = el.closest('span[data-fs], span[data-c]');
        const fontSize = parseFloat(st && st.dataset.fs) || fs;
        const c = (st && st.dataset.c) || color;
        const key = inlineKey(kind, value, display, fontSize, c);
        if (out[key]) continue;
        let img = this.imageCache.get(key);
        if (!img) {
          try {
            const r = await x.def.exportImage(value, { display, color: c, fontSize, scale: 4 });
            if (r && r.png && r.width > 0 && r.height > 0) img = { png: new Uint8Array(r.png), width: +r.width, height: +r.height, baseline: +r.baseline || +r.height };
          } catch (err) { console.error(`[extensions] ${x.id}: exportImage`, err); }
          if (img) { if (this.imageCache.size > 500) this.imageCache.clear(); this.imageCache.set(key, img); }
        }
        if (img) out[key] = img;
      }
    }
    return out;
  }

  menuItems(where, ctx, editor) {
    const items = [];
    for (const { id, item } of this.menus[where] || []) {
      const target = editor ? Object.freeze({ ...ctx,
        isExternal: !!editor.isExternal,
        notebookSettings: notebookSettings(id, () => editor, true), refreshView: () => this.refreshView(editor),
      }) : ctx;
      try {
        if (item.when && !item.when(target)) continue;
        items.push({ label: tr(item.label), icon: item.icon || 'more', checked: item.checked?.(target), onClick: () => {
          if (!this.isEnabled(id) || editor?.closing) return;
          try { const r = item.run(target); if (r && r.catch) r.catch((err) => console.error(`[extensions] ${id}: menu`, err)); }
          catch (err) { console.error(`[extensions] ${id}: menu`, err); }
        } });
      } catch (err) { console.error(err); }
    }
    return items;
  }

  /** After a PDF page was drawn into `canvas` (screen only). */
  async pagePass(canvas, { editor, page, scale, viewport, cancelled }) {
    if (!this.passes.length) return;
    let regions = null;
    const ctx = canvas.getContext('2d');
    for (const x of this.passes) {
      if (cancelled()) return;
      if (!this.isEnabled(x.id)) continue;
      try {
        const view = this.viewContext(x.id, editor, 'pdf');
        if (x.when && !x.when(view)) continue;
        // A failed lookup is not evidence that this page contains no pictures.
        regions ??= await page.imageRects(viewport).catch(() => null);
        if (!regions || cancelled()) return;
        const effect = await x.fn({ ...view, canvas, ctx, page: page.index, scale, imageRegions: regions });
        if (effect !== undefined && !cancelled()) {
          const effects = this.pageEffects.get(canvas) || new Map();
          effects.set(x.id, clone(effect));
          this.pageEffects.set(canvas, effects);
        }
      } catch (err) { console.error(`[extensions] ${x.id}: page pass`, err); }
    }
  }

  viewContext(id, editor, pageKind, effects) {
    return Object.freeze({ pageKind, isExternal: !!editor?.isExternal,
      settings: notebookSettings(id, () => editor), effect: clone(effects?.get(id)),
    });
  }

  inkColor(c, editor, pageKind, effects) {
    const ink = this.ink;
    if (!ink || !c) return c;
    try { const v = ink.fn(c, this.viewContext(ink.id, editor, pageKind, effects)); return typeof v === 'string' ? v : c; } catch { return c; }
  }

  highlighterBlend(editor, pageKind, effects) {
    const blend = this.blend;
    if (blend) {
      try {
        const mode = blend.fn(this.viewContext(blend.id, editor, pageKind, effects));
        if (mode === 'screen' || mode === 'multiply') return mode;
      } catch { /* keep the default */ }
    }
    return null;
  }
}

export const extensions = new ExtensionHost();
