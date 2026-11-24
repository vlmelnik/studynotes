'use strict';
// AI edit plans (docs/ROADMAP-1.9.md, "Edit plan"). The AI never changes a
// notebook itself: it answers with a plan in this JSON format, the app checks
// it (checkPlan), shows it (describePlan) and, when the user agrees, applies
// it as one undo step (applyPlan). Pure: unit-tested.
//
// Pages are given as numbers from 1, as page ids, or as "new:<n>" for the
// n-th page added by this plan (addPage).

const { parseRich, plainToHtml, richToPlain } = require('./richtext');
const { escHtml } = require('./util');

const MAX_OPS = 200;
const MAX_TEXT = 20000;
const PAPERS = ['blank', 'lined', 'grid', 'dots'];

const pageRef = { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }], description: 'page number from 1, a page id, or "new:<n>" for the n-th page this plan adds' };
const content = { text: { type: 'string', maxLength: MAX_TEXT }, html: { type: 'string', maxLength: MAX_TEXT * 2 } };

/** JSON Schema of a plan (for providers that take a schema, and for the docs). */
const PLAN_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['version', 'ops'],
  properties: {
    version: { const: 1 },
    summary: { type: 'string', description: 'one or two sentences for the user' },
    answer: { type: 'string', description: 'the answer to a question, when no change is needed' },
    ops: {
      type: 'array', maxItems: MAX_OPS,
      items: {
        oneOf: [
          { type: 'object', required: ['op', 'page'], properties: { op: { const: 'addText' }, page: pageRef, ...content, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, fs: { type: 'number' }, bold: { type: 'boolean' } } },
          { type: 'object', required: ['op', 'page', 'id'], properties: { op: { const: 'replaceText' }, page: pageRef, id: { type: 'string' }, ...content } },
          { type: 'object', required: ['op', 'page', 'id', 'terms'], properties: { op: { const: 'underline' }, page: pageRef, id: { type: 'string' }, terms: { type: 'array', items: { type: 'string' }, maxItems: 100 } } },
          { type: 'object', required: ['op', 'page'], properties: { op: { const: 'addBookmark' }, page: pageRef } },
          { type: 'object', required: ['op', 'from', 'id', 'to'], properties: { op: { const: 'moveText' }, from: pageRef, id: { type: 'string' }, to: pageRef } },
          { type: 'object', required: ['op', 'page', 'ref'], properties: { op: { const: 'addImage' }, page: pageRef, ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' } } },
          { type: 'object', required: ['op', 'after'], properties: { op: { const: 'addPage' }, after: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string' }] }, title: { type: 'string', maxLength: 200 }, paper: { enum: PAPERS } } },
          { type: 'object', required: ['op', 'page', 'id'], properties: { op: { const: 'removeText' }, page: pageRef, id: { type: 'string' } } },
        ],
      },
    },
  },
};

const OPS = new Set(['addText', 'replaceText', 'underline', 'addBookmark', 'moveText', 'addImage', 'addPage', 'removeText']);

/** Text for a box from an op: html wins (checked by the caller), else plain text. */
function opHtml(op) {
  if (typeof op.html === 'string' && op.html.trim()) return op.html;
  if (typeof op.text === 'string') return plainToHtml(op.text.replace(/\r/g, ''));
  return '';
}

// html that the rich-text reader keeps as it is: the plain text of the html
// must not lose letters that are in it (a stray "<" that eats text, etc.)
function htmlProblem(html) {
  const plain = richToPlain(html);
  const visible = String(html).replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, 'x');
  if (plain.replace(/\s+/g, '').length + 2 < visible.replace(/\s+/g, '').length * 0.9) return 'its html loses text';
  if (/<(script|style|iframe|img|object|embed)\b/i.test(html)) return 'its html has elements that are not allowed';
  return null;
}

/**
 * checkPlan(plan, notebook, { allowRemove = false, refs = {} })
 *   notebook: { pages: [{ id, kind, w, h, bm }], data(pageId) -> { texts, items, strokes } }
 *   refs: { <ref>: { src, w, h } } pictures the plan may place (study session)
 * -> { ok, ops, problems: [{ index, reason }] }; ops are the plan's ops with
 *    `pageId` (and `toId`) resolved; a page added by the plan is "new:<n>".
 */
function checkPlan(plan, notebook, { allowRemove = false, refs = {} } = {}) {
  const problems = [];
  const out = [];
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.ops)) return { ok: false, ops: [], problems: [{ index: -1, reason: 'not a plan: "ops" is missing' }] };
  if (plan.ops.length > MAX_OPS) return { ok: false, ops: [], problems: [{ index: -1, reason: `too many changes (${plan.ops.length}, at most ${MAX_OPS})` }] };
  const pages = notebook.pages || [];
  let added = 0;
  const textsOn = new Map(); // pageId -> Set of text ids (after earlier ops of this plan)
  const textIds = (pid) => {
    if (!textsOn.has(pid)) textsOn.set(pid, new Set(pid.startsWith('new:') ? [] : ((notebook.data(pid) || {}).texts || []).map((t) => t.id)));
    return textsOn.get(pid);
  };
  const resolve = (ref) => {
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
      const n = Number(ref);
      return Number.isInteger(n) && n >= 1 && n <= pages.length ? pages[n - 1].id : null;
    }
    const s = String(ref || '');
    const m = /^new:(\d+)$/.exec(s);
    if (m) return Number(m[1]) >= 1 && Number(m[1]) <= added ? s : null;
    return pages.some((p) => p.id === s) ? s : null;
  };
  plan.ops.forEach((raw, index) => {
    const bad = (reason) => problems.push({ index, reason });
    if (!raw || typeof raw !== 'object' || !OPS.has(raw.op)) return bad(`unknown change "${raw && raw.op}"`);
    const op = { ...raw };
    if (op.op === 'addPage') {
      const after = op.after === 0 || op.after === '0' ? 0 : resolve(op.after);
      if (after === null || after === undefined) return bad(`page ${op.after} does not exist`);
      if (op.paper && !PAPERS.includes(op.paper)) return bad(`unknown paper "${op.paper}"`);
      if (op.title && String(op.title).length > 200) return bad('the title is too long');
      added++;
      out.push({ ...op, afterId: after === 0 ? null : after, pageId: `new:${added}` });
      return;
    }
    const pid = resolve(op.op === 'moveText' ? op.from : op.page);
    if (!pid) return bad(`page ${op.op === 'moveText' ? op.from : op.page} does not exist`);
    op.pageId = pid;
    const page = pid.startsWith('new:') ? null : pages.find((p) => p.id === pid);
    if (page && page.kind === 'board' && op.op !== 'addBookmark') return bad('boards cannot be changed by a plan yet');
    if (op.op === 'addText' || op.op === 'replaceText') {
      const html = opHtml(op);
      if (!html.trim()) return bad('the text is empty');
      if (richToPlain(html).length > MAX_TEXT) return bad(`the text is longer than ${MAX_TEXT} characters`);
      const why = htmlProblem(html);
      if (why) return bad(why);
    }
    if (['replaceText', 'underline', 'moveText', 'removeText'].includes(op.op) && !textIds(pid).has(op.id)) return bad(`text box ${op.id} is not on page ${op.op === 'moveText' ? op.from : op.page}`);
    if (op.op === 'underline' && (!Array.isArray(op.terms) || !op.terms.some((t) => typeof t === 'string' && t.trim()))) return bad('no terms to underline');
    if (op.op === 'removeText' && !allowRemove) return bad('removing text is not allowed for this request');
    if (op.op === 'addImage' && !Object.prototype.hasOwnProperty.call(refs, op.ref)) return bad(`picture ${op.ref} is not part of this request`);
    if (op.op === 'moveText') {
      const to = resolve(op.to);
      if (!to) return bad(`page ${op.to} does not exist`);
      if (to === pid) return bad('moving to the same page');
      op.toId = to;
      textIds(pid).delete(op.id);
      textIds(to).add(op.id);
    }
    if (op.op === 'removeText') textIds(pid).delete(op.id);
    out.push(op);
  });
  return { ok: problems.length === 0, ops: out, problems };
}

/** Wraps whole-word, case-insensitive matches of terms in <u>, outside tags, existing <u> and inline elements. */
function underlineTerms(html, terms) {
  const list = [...new Set(terms.map((t) => String(t).trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length) return html;
  const esc = (s) => escHtml(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${list.map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  let inU = 0, inX = 0;
  const spanStack = [];
  return String(html).split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith('<')) {
      const m = /^<(\/?)([a-z0-9]+)/i.exec(part);
      if (m) {
        const tag = m[2].toLowerCase(), close = m[1] === '/';
        if (tag === 'u') inU += close ? -1 : 1;
        if (tag === 'span') {
          if (close) { if (spanStack.pop()) inX--; } else { const x = /\bdata-x\s*=/.test(part); spanStack.push(x); if (x) inX++; }
        }
      }
      return part;
    }
    if (inU > 0 || inX > 0 || !part) return part;
    return part.replace(re, (w) => `<u>${w}</u>`);
  }).join('');
}

/**
 * applyPlan({ pages, data }, ops, { newId, fontSize = 14, color = '#1c1c1e', font, refs = {} })
 *   pages: the page list, data(pageId) -> page data
 * -> { pages, changes: [{ pageId, before, after }], added: [pageIds] }
 * Inputs are not changed. Ops must come from checkPlan.
 */
function applyPlan({ pages, data }, ops, { newId, fontSize = 14, color = '#1c1c1e', font, refs = {} } = {}) {
  const outPages = pages.slice();
  const ids = new Map(); // "new:<n>" -> real id
  const before = new Map();
  const after = new Map();
  const added = [];
  const real = (pid) => ids.get(pid) || pid;
  const get = (pid) => {
    const id = real(pid);
    if (!after.has(id)) {
      const d = data(id) || { strokes: [], texts: [], items: [] };
      before.set(id, d);
      after.set(id, { ...d, strokes: d.strokes || [], texts: (d.texts || []).slice(), items: (d.items || []).slice() });
    }
    return after.get(id);
  };
  const pageOf = (pid) => outPages.find((p) => p.id === real(pid));
  const bottom = (d) => {
    let b = 40;
    for (const t of d.texts) b = Math.max(b, t.y + (t.h || (t.fs || fontSize) * 1.35 * (t.lines || 1)));
    for (const it of d.items) b = Math.max(b, (it.y || 0) + (it.h || 0));
    for (const st of d.strokes) for (let i = 1; i < (st.p || []).length; i += 3) b = Math.max(b, st.p[i]);
    return b;
  };
  const topZ = (d) => d.texts.reduce((m, t) => Math.max(m, t.z || 0), 0) + 1;
  const box = (d, page, { html, fs, bold, x, y, w }) => {
    const plain = richToPlain(html);
    const lines = parseRich(html).length;
    const b = bottom(d);
    const t = {
      id: newId(), x: x ?? 40, y: y ?? (b > 40 ? b + fs : 40), w: w ?? Math.max(120, (page ? page.w : 595) - 80), fs, c: color,
      text: plain, b: !!bold, i: false, u: false, lines, lay: 'f', z: topZ(d),
    };
    if (font) t.ff = font;
    if (/<(b|i|u|span|div)\b/i.test(html) || plain.includes('\n')) t.html = html;
    return t;
  };
  for (const op of ops) {
    if (op.op === 'addPage') {
      const at = op.afterId ? outPages.findIndex((p) => p.id === real(op.afterId)) + 1 : 0;
      const ref = outPages[Math.max(0, at - 1)] || pages[0];
      const np = { id: newId(), kind: 'paper', paper: op.paper || 'lined', w: ref ? ref.w : 595.28, h: ref ? ref.h : 841.89 };
      if (op.title) np.bm = 1;
      outPages.splice(at, 0, np);
      ids.set(op.pageId, np.id);
      added.push(np.id);
      before.set(np.id, { strokes: [], texts: [], items: [] });
      after.set(np.id, { strokes: [], texts: [], items: [] });
      if (op.title) after.get(np.id).texts.push(box(after.get(np.id), np, { html: escHtml(op.title), fs: Math.round(fontSize * 1.6), bold: true }));
      continue;
    }
    const d = get(op.pageId);
    const page = pageOf(op.pageId);
    if (op.op === 'addText') d.texts.push(box(d, page, { html: opHtml(op), fs: op.fs || fontSize, bold: op.bold, x: op.x, y: op.y, w: op.w }));
    else if (op.op === 'replaceText' || op.op === 'underline') {
      d.texts = d.texts.map((t) => {
        if (t.id !== op.id) return t;
        const html = op.op === 'replaceText' ? opHtml(op) : underlineTerms(t.html || plainToHtml(t.text || ''), op.terms);
        const plain = richToPlain(html);
        return { ...t, html, text: plain, lines: parseRich(html).length };
      });
    } else if (op.op === 'removeText') d.texts = d.texts.filter((t) => t.id !== op.id);
    else if (op.op === 'moveText') {
      const t = d.texts.find((x) => x.id === op.id);
      d.texts = d.texts.filter((x) => x.id !== op.id);
      const to = get(op.toId);
      to.texts.push({ ...t, y: bottom(to) > 40 ? bottom(to) + (t.fs || fontSize) : 40, z: topZ(to) });
    } else if (op.op === 'addBookmark') {
      const i = outPages.findIndex((p) => p.id === real(op.pageId));
      if (i >= 0 && !outPages[i].bm) outPages[i] = { ...outPages[i], bm: 1 };
    } else if (op.op === 'addImage') {
      const r = refs[op.ref];
      const w = op.w || Math.min(r.w || 300, (page ? page.w : 595) - 80);
      const h = r.w && r.h ? w * (r.h / r.w) : w * 0.75;
      d.items.push({ id: newId(), type: 'img', src: r.src, x: op.x ?? 40, y: op.y ?? (bottom(d) > 40 ? bottom(d) + 12 : 40), w, h, lay: 'b', z: d.items.reduce((m, it) => Math.max(m, it.z || 0), 0) + 1 });
    }
  }
  const changes = [...after.keys()].filter((id) => !added.includes(id) || after.get(id).texts.length || after.get(id).items.length)
    .map((id) => ({ pageId: id, before: before.get(id), after: after.get(id) }));
  return { pages: outPages, changes, added };
}

/** Short English lines for the preview, one per change. */
function describePlan(ops, pages) {
  const name = (pid) => {
    if (!pid) return 'the start';
    const m = /^new:(\d+)$/.exec(pid);
    if (m) return `new page ${m[1]}`;
    const i = pages.findIndex((p) => p.id === pid);
    return i >= 0 ? `page ${i + 1}` : 'a page';
  };
  const short = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > 60 ? t.slice(0, 57) + '…' : t; };
  return ops.map((op) => {
    switch (op.op) {
      case 'addPage': return `Add a page after ${name(op.afterId)}${op.title ? `: "${short(op.title)}" (bookmarked)` : ''}`;
      case 'addText': return `${cap(name(op.pageId))}: add text "${short(op.text || richToPlain(op.html || ''))}"`;
      case 'replaceText': return `${cap(name(op.pageId))}: rewrite a text box as "${short(op.text || richToPlain(op.html || ''))}"`;
      case 'underline': return `${cap(name(op.pageId))}: underline ${op.terms.length} term${op.terms.length === 1 ? '' : 's'} (${short(op.terms.join(', '))})`;
      case 'addBookmark': return `${cap(name(op.pageId))}: bookmark`;
      case 'moveText': return `Move a text box from ${name(op.pageId)} to ${name(op.toId)}`;
      case 'addImage': return `${cap(name(op.pageId))}: add a picture`;
      case 'removeText': return `${cap(name(op.pageId))}: remove a text box`;
      default: return op.op;
    }
  });
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The plan in a model's answer: the first JSON object, also inside ```json fences. */
function parsePlan(answer) {
  const s = String(answer || '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fence ? fence[1] : s;
  const start = body.indexOf('{');
  if (start < 0) return null;
  // the outermost balanced object, strings respected
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

module.exports = { PLAN_SCHEMA, checkPlan, applyPlan, describePlan, underlineTerms, parsePlan, MAX_OPS };
