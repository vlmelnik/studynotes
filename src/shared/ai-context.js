'use strict';
// What is sent to the AI (docs/ROADMAP-1.9.md, "Context"): the text of the
// notebook within a size budget, most relevant first, every piece with an id
// the edit plan can point at ([p3 t:abc] = page 3, text box abc), and the
// instructions for the answer. Pure: unit-tested.

const { pageText } = require('./mcp-tools');
const { PLAN_SCHEMA } = require('./ai-plan');

// 1, 2, 3, 5 -> "1–3, 5"
const ranges = (ns) => ns.reduce((out, n) => {
  const last = out[out.length - 1];
  if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  return out;
}, []).map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');

/** Rough token count: about 4 characters per token, Cyrillic and CJK denser. */
function estimateTokens(text) {
  const s = String(text || '');
  const dense = (s.match(/[Ѐ-ӿ぀-ヿ一-鿿]/g) || []).length;
  return Math.ceil((s.length - dense) / 4 + dense / 2);
}

/** The pieces of one page: the PDF text, then each text box with its id. */
function pagePieces(n, page, data, textIndex) {
  const pieces = [];
  const pdf = page.kind === 'pdf' ? pageText(page, { texts: [], items: [] }, textIndex) : '';
  if (pdf) pieces.push({ id: `p${n}`, page: n, kind: 'pdf', text: pdf });
  const boxes = ((data && data.texts) || []).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of boxes) if (t.text && t.text.trim()) pieces.push({ id: `p${n} t:${t.id}`, page: n, kind: 'text', textId: t.id, text: t.text.trim() });
  const tables = pageText({ kind: 'paper' }, { texts: [], items: (data && data.items) || [] }, null);
  if (tables) pieces.push({ id: `p${n} table`, page: n, kind: 'table', text: tables });
  return pieces;
}

/**
 * buildContext({ title, pages }, pageData, textIndex, { current, selection, scope, budget })
 *   current: current page number (1-based); selection: { page, ids: [text ids] }
 *   scope: 'selection' | 'page' | 'notebook'; budget in characters
 * -> { text, pieces, used, dropped: [page numbers], pagesSent: [page numbers] }
 */
function buildContext(notebook, pageData, textIndex, { current = 1, selection = null, scope = 'notebook', budget = 60000 } = {}) {
  const pages = notebook.pages || [];
  const all = pages.map((p, i) => pagePieces(i + 1, p, pageData[p.id], textIndex));
  let order;
  if (scope === 'selection' && selection && selection.ids && selection.ids.length) {
    const want = new Set(selection.ids);
    const sel = (all[selection.page - 1] || []).filter((x) => x.kind === 'text' && want.has(x.textId));
    order = [{ page: selection.page, pieces: sel }];
  } else if (scope === 'page' || scope === 'selection') {
    order = [{ page: current, pieces: all[current - 1] || [] }];
  } else {
    // current page, its neighbours, bookmarked pages, then the rest in order
    const rank = (n) => (n === current ? 0 : Math.abs(n - current) === 1 ? 1 : pages[n - 1].bm ? 2 : 3);
    order = all.map((pieces, i) => ({ page: i + 1, pieces })).sort((a, b) => rank(a.page) - rank(b.page) || a.page - b.page);
  }
  const sent = new Map();
  let used = 0;
  const dropped = [];
  const head = (n) => `\n=== Page ${n}${pages[n - 1].bm ? ' (bookmarked)' : ''}${pages[n - 1].kind === 'pdf' ? ' (PDF)' : ''} ===\n`;
  for (const { page, pieces } of order) {
    const size = pieces.reduce((s, x) => s + x.text.length + x.id.length + 4, 0) + head(page).length + (pieces.length ? 0 : 10);
    if (used + size > budget) {
      // a page that is too large alone is cut at sentence ends
      if (!sent.size && pieces.length) {
        const cut = [];
        let room = budget - 16;
        for (const x of pieces) {
          if (room <= x.id.length + 40) break;
          let t = x.text;
          if (t.length + x.id.length + 4 > room) {
            t = t.slice(0, room - x.id.length - 5);
            const end = Math.max(t.lastIndexOf('. '), t.lastIndexOf('.\n'), t.lastIndexOf('\n\n'));
            if (end > t.length * 0.5) t = t.slice(0, end + 1);
            t += ' …';
          }
          cut.push({ ...x, text: t });
          room -= t.length + x.id.length + 4;
        }
        sent.set(page, cut);
        used = budget - room;
      } else dropped.push(page);
      continue;
    }
    sent.set(page, pieces);
    used += size;
  }
  const pagesSent = [...sent.keys()].sort((a, b) => a - b);
  let text = `Notebook: ${notebook.title || 'Untitled'} (${pages.length} pages)\n`;
  for (const n of pagesSent) {
    text += head(n);
    const pieces = sent.get(n);
    if (!pieces.length) text += '(no text)\n';
    for (const x of pieces) text += `[${x.id}] ${x.text}\n`;
  }
  if (dropped.length) text += `\n(Pages not included because of the size limit: ${ranges(dropped.sort((a, b) => a - b))})\n`;
  return { text, pieces: pagesSent.flatMap((n) => sent.get(n)), used: text.length, dropped: dropped.sort((a, b) => a - b), pagesSent };
}

const PLAN_RULES = `Answer with one JSON object and nothing else, in this format (JSON Schema):
${JSON.stringify(PLAN_SCHEMA)}
Rules:
- "answer": your reply to the user (plain text, may be empty when you only change things).
- "ops": the changes to the notebook, or [] when nothing should change. Change only what the user asked for.
- Pages are numbers from 1 as shown in "=== Page n ===". A text box is changed by its id: in "[p3 t:abc]" the id is "abc" on page 3.
- New text: plain "text" (paragraphs separated by an empty line). Formulas in LaTeX between $…$ or $$…$$.
- Write in the language of the notes unless the user asks otherwise.`;

/**
 * buildRequest({ prompt, context, mode, custom }) -> { system, user }
 *   mode 'ask': answer only (ops must be empty); 'edit': answer and/or changes
 *   custom: the user's own standing instructions (Settings)
 */
function buildRequest({ prompt, context, mode = 'edit', custom = '' }) {
  const system = [
    'You help a student with their notes in StudyNotes, a note-taking app for lectures and PDFs.',
    mode === 'ask' ? 'Only answer; do not propose changes ("ops" must be []).' : 'You may propose changes to the notebook as an edit plan.',
    PLAN_RULES,
    custom && custom.trim() ? `The user's standing instructions:\n${custom.trim()}` : '',
  ].filter(Boolean).join('\n\n');
  const user = `${context}\n\n---\nRequest: ${String(prompt || '').trim()}`;
  return { system, user };
}

module.exports = { estimateTokens, pagePieces, buildContext, buildRequest, PLAN_RULES };
