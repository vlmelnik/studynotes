'use strict';
// A host for extension unit tests (docs/EXTENSIONS.md, API versions 1 and 2). It does
// what the app's host does with what an extension registers, without a DOM or
// the app: tests call the recorded transforms, inline definitions and menu
// items directly. Maintainer-owned (outside the contributors' file scope).
//
//   const { fakeHost, load } = require('./fake-host');
//   const host = fakeHost('rich-paste');
//   (await load('rich-paste')).activate(host);
//   host.paste.run({ html: '', text: '$x^2$', target: 'textbox' })

const path = require('path');
const { pathToFileURL } = require('url');

const KIND = /^[a-z0-9-]+(?::[a-z0-9-]+)?$/;
const WHERE = new Set(['textbox-more', 'page-more', 'view']);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fakeHost(id, { settings = {}, notebook = {}, prompt = async () => null, ai = null, doc = null } = {}) {
  // API v2: ai(request) -> text (null: not set up); doc: { title, pages, data: { pageId: data } }
  const plan = require('../../../src/shared/ai-plan');
  const context = require('../../../src/shared/ai-context');
  const calls = { transforms: [], inline: new Map(), menus: [], passes: [], ink: null, blend: null, classes: new Set(), toasts: [], refreshes: 0, logs: [] };
  const passPredicates = new Map();
  const data = JSON.parse(JSON.stringify(settings));
  const nb = JSON.parse(JSON.stringify(notebook));
  const watchers = [];
  const host = {
    id,
    apiVersion: 2,
    calls,
    paste: {
      addTransform(fn, { priority = 0 } = {}) { calls.transforms.push({ fn, priority }); calls.transforms.sort((a, b) => b.priority - a.priority); },
      // like the app: the first non-null result wins
      run(clip) { for (const x of calls.transforms) { const r = x.fn(clip); if (r && typeof r.html === 'string') return r; } return null; },
    },
    inline: {
      register(kind, def) {
        if (!KIND.test(kind) || (kind !== id && !kind.startsWith(id + ':'))) throw new Error(`inline kind "${kind}" must be "${id}" or "${id}:<name>"`);
        if (!def || typeof def.render !== 'function' || typeof def.toText !== 'function') throw new Error('inline.register needs render() and toText()');
        calls.inline.set(kind, def);
      },
      html(kind, value, { display = false } = {}) {
        const def = calls.inline.get(kind);
        const text = def ? def.toText(value, { display }) : value;
        return `<span data-x="${esc(kind)}" data-v="${esc(value)}"${display ? ' data-display="1"' : ''}>${esc(text).replace(/&quot;/g, '"')}</span>`;
      },
    },
    menus: {
      add(where, item) {
        if (!WHERE.has(where)) throw new Error('unknown menu ' + where);
        if (!item || !item.label || typeof item.run !== 'function') throw new Error('a menu item needs label and run()');
        calls.menus.push({ where, item });
      },
      // the items the app would show for ctx
      visible(where, ctx) { return calls.menus.filter((m) => m.where === where && (!m.item.when || m.item.when(ctx))).map((m) => m.item); },
    },
    view: {
      addPagePass(fn, { when } = {}) { calls.passes.push(fn); passPredicates.set(fn, when); },
      async runPagePasses(ctx) {
        for (const pass of calls.passes) {
          const when = passPredicates.get(pass);
          if (!when || when(ctx)) await pass(ctx);
        }
      },
      setInkFilter(fn) { calls.ink = fn; },
      setHighlighterBlend(fn) { calls.blend = fn; },
      setClass(name, on) { if (on) calls.classes.add(name); else calls.classes.delete(name); },
      refresh() { calls.refreshes++; },
    },
    settings: {
      get(key, fallback) { return key in data ? JSON.parse(JSON.stringify(data[key])) : fallback; },
      set(key, value) { data[key] = JSON.parse(JSON.stringify(value)); for (const w of watchers) if (w.key === key) w.fn(value); },
      onChange(key, fn) { watchers.push({ key, fn }); },
      notebook: {
        get(key, fallback) { return key in nb ? JSON.parse(JSON.stringify(nb[key])) : fallback; },
        set(key, value) { nb[key] = JSON.parse(JSON.stringify(value)); },
      },
    },
    ui: {
      toast(text) { calls.toasts.push(String(text)); },
      prompt,
      t: (text) => String(text),
    },
    ai: {
      ready: () => !!ai,
      async request(req) { calls.aiRequests = (calls.aiRequests || []).concat([req]); if (!ai) throw new Error('Set up the AI assistant first'); return ai(req); },
      planSchema: () => JSON.parse(JSON.stringify(plan.PLAN_SCHEMA)),
    },
    notebook: {
      read({ scope = 'notebook', budget = 60000 } = {}) {
        if (!doc) return null;
        const c = context.buildContext({ title: doc.title, pages: doc.pages }, doc.data, {}, { scope, budget });
        return { title: doc.title, pages: doc.pages.length, current: 1, text: c.text, dropped: c.dropped };
      },
      preview(p, opts = {}) {
        const r = plan.checkPlan(p, { pages: doc.pages, data: (pid) => doc.data[pid] }, opts);
        return { ok: r.ok, lines: plan.describePlan(r.ops, doc.pages), problems: r.problems };
      },
      apply(p, opts = {}) {
        const r = plan.checkPlan(p, { pages: doc.pages, data: (pid) => doc.data[pid] }, opts);
        let n = 0;
        if (r.ops.length) {
          const out = plan.applyPlan({ pages: doc.pages, data: (pid) => doc.data[pid] }, r.ops, { newId: () => 'fake' + (++n), refs: opts.refs || {} });
          doc.pages = out.pages;
          for (const c of out.changes) doc.data[c.pageId] = c.after;
        }
        return { applied: r.ops.length, problems: r.problems };
      },
    },
    log: (...args) => calls.logs.push(args),
  };
  return host;
}

/** The default export of src/extensions/<id>/index.js. */
async function load(id) {
  const file = path.join(__dirname, '..', '..', '..', 'src', 'extensions', id, 'index.js');
  return (await import(pathToFileURL(file).href)).default;
}

module.exports = { fakeHost, load };
