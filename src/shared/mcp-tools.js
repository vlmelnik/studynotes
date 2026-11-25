'use strict';
// The tools StudyNotes offers to Claude (and other MCP clients) and the pure
// parts of running them: notebook text for reading, where new text goes on a
// page. The renderer runs the tools (src/renderer/mcp.js), so changes go
// through the open notebook, with undo. Pages are numbered from 1 here,
// because that is how people (and the model) talk about them.

const { pageSummary } = require('./notes-layout');

const notebookArg = { type: 'string', description: 'Notebook path or title, as listed by list_notebooks' };
const pageArg = { type: 'integer', minimum: 1, description: 'Page number, starting at 1' };

const TOOLS = [
  {
    name: 'list_notebooks',
    description: 'Lists the notebooks in the StudyNotes library with their folder, title, number of pages and last change.',
    inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Only this folder (path), default: all' } } },
  },
  {
    name: 'read_notebook',
    description: 'Reads the text of a notebook page by page: typed text boxes, tables and the text of PDF pages (including text recognised from scans). Bookmarked pages are marked. Long notebooks: read a page range.',
    inputSchema: {
      type: 'object', required: ['notebook'],
      properties: { notebook: notebookArg, from: { ...pageArg, description: 'First page (default 1)' }, to: { ...pageArg, description: 'Last page (default: up to the size limit)' } },
    },
  },
  {
    name: 'search_notes',
    description: 'Searches all notebooks (PDF text and typed text) for words. Returns notebook, page number and a snippet per hit.',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
  },
  {
    name: 'add_text',
    description: 'Adds a text box to a page, below what is already there. Plain text; separate paragraphs with empty lines. The user can undo it with Ctrl+Z.',
    inputSchema: {
      type: 'object', required: ['notebook', 'page', 'text'],
      properties: {
        notebook: notebookArg, page: pageArg, text: { type: 'string', maxLength: 20000 },
        size: { type: 'number', minimum: 6, maximum: 72, description: 'Font size (default: the text tool size)' },
        bold: { type: 'boolean' },
      },
    },
  },
  {
    name: 'add_page',
    description: 'Inserts a new empty page after the given page, optionally with a title at the top that is also bookmarked.',
    inputSchema: {
      type: 'object', required: ['notebook', 'after'],
      properties: {
        notebook: notebookArg, after: { type: 'integer', minimum: 0, description: 'Insert after this page number (0: at the start)' },
        paper: { type: 'string', enum: ['blank', 'lined', 'grid', 'dots'], description: 'Paper (default lined)' },
        title: { type: 'string', maxLength: 200 },
      },
    },
  },
  {
    name: 'apply_edit_plan',
    description: 'Applies several changes at once as one undo step: add pages with titles, add or rewrite text boxes, underline terms, move text boxes, bookmark pages. '
      + 'Text boxes are named by the ids that read_notebook shows as [t:<id>]. Pages are numbers from 1, or "new:<n>" for the n-th page added by this plan. '
      + 'Changes that do not fit (missing page, unknown id) are left out and reported.',
    inputSchema: {
      type: 'object', required: ['notebook', 'plan'],
      properties: {
        notebook: notebookArg,
        plan: { type: 'object', description: 'An edit plan: { "version": 1, "ops": [ { "op": "addPage", "after": 2, "title": "Summary" }, { "op": "addText", "page": "new:1", "text": "…" }, { "op": "underline", "page": 1, "id": "<text box id>", "terms": ["…"] }, { "op": "replaceText", "page": 1, "id": "…", "text": "…" }, { "op": "moveText", "from": 1, "id": "…", "to": 3 }, { "op": "addBookmark", "page": 4 } ] }' },
        allow_remove: { type: 'boolean', description: 'Allow "removeText" changes (only when the user asked to delete text)' },
      },
    },
  },
  {
    name: 'write_notes',
    description: 'The best way to write notes: send their structure and StudyNotes lays them out like a person would – on the ruled lines, inside the margins, '
      + 'below what is already on the page, headings bigger and coloured, colours that suit light or dark paper (the user\'s notes style), and onto the next or a new page when a page is full. '
      + 'Never over a PDF page: notes for a PDF page go on a new page after it. Inline: **bold** (key terms), *italic*, __underline__, $LaTeX$ formulas. One undo step.',
    inputSchema: {
      type: 'object', required: ['notebook', 'page', 'blocks'],
      properties: {
        notebook: notebookArg, page: { ...pageArg, description: 'The page the user means, or the page they have open' },
        place: { type: 'string', enum: ['next_page', 'free_space', 'below'], description: 'next_page (default): on the next empty page after "page", or a new one. '
          + 'free_space: on "page" itself, in its empty rows between what is there (when the user names the page). below: under everything on "page".' },
        blocks: {
          type: 'array', maxItems: 400,
          description: 'In order. { "type": "heading", "level": 1|2|3, "text": "…" } | { "type": "paragraph", "text": "…", "tone": "warning"|"note" (optional: red caution, or a side note / page reference in the note colour) } | '
            + '{ "type": "definition", "term": "SSRI", "text": "…" } (term: explanation; several in a row stay together) | { "type": "list", "items": ["…"], "ordered": false } | '
            + '{ "type": "formula", "latex": "U_2 > U_1" } (a formula on its own line) | { "type": "box", "title": "Remember", "text": "…" } (a framed key statement) | '
            + '{ "type": "image", "ref": "a1", "caption": "…", "size": "small"|"medium"|"full" } (a picture the user attached in the StudyNotes chat, by its id) | { "type": "pagebreak" }',
          items: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['heading', 'paragraph', 'definition', 'list', 'formula', 'box', 'image', 'pagebreak'] }, tone: { type: 'string' }, term: { type: 'string' }, level: { type: 'integer' }, text: { type: 'string' }, title: { type: 'string' }, latex: { type: 'string' }, ref: { type: 'string' }, caption: { type: 'string' }, size: { type: 'string' }, items: { type: 'array', items: { type: 'string' } }, ordered: { type: 'boolean' } } },
        },
      },
    },
  },
  {
    name: 'clear_page',
    description: 'Removes everything the user put on a page – typed text, handwriting, highlights, shapes, pictures – when the user asked to replace or delete the old notes. '
      + 'StudyNotes asks the user to confirm first; Ctrl+Z brings it back. PDF content itself stays.',
    inputSchema: { type: 'object', required: ['notebook', 'pages'], properties: { notebook: notebookArg, pages: { type: 'array', items: pageArg, minItems: 1, maxItems: 200, description: 'Page numbers' } } },
  },
  {
    name: 'bookmark_page',
    description: 'Sets or removes the bookmark of a page.',
    inputSchema: { type: 'object', required: ['notebook', 'page'], properties: { notebook: notebookArg, page: pageArg, on: { type: 'boolean', description: 'default true' } } },
  },
];

const INSTRUCTIONS = 'StudyNotes is the user\'s note-taking app for lectures and PDFs. Read with list_notebooks, read_notebook and search_notes. '
  + 'Write notes with write_notes: send headings, paragraphs, lists, formulas and boxes, not positions, sizes or colours – StudyNotes places them on the lines and styles them. '
  + 'Where: when the user just asks to add notes, use place "next_page" (the next empty page after the open one); when they name a page, use "free_space" on that page; '
  + 'only when they ask to replace or delete what is there, call clear_page for those pages first (the user confirms it) and then write on them. '
  + 'read_notebook also says what else is on a page (handwriting, pictures, shapes) that you cannot read, and which paper it is; use its lines or squares. '
  + 'A title page (cover) is never used for notes – at most the topic and a date when the user asks for that; write_notes moves notes to the page after it. '
  + 'Good notes: a level-1 heading for the topic, level-2 headings for sections, a level-3 heading for a sub-topic, short paragraphs, **bold** only for key terms, '
  + 'definition blocks for terms and abbreviations, lists for steps or properties, tone "warning" for side effects, risks and common mistakes, tone "note" for sources and page references, '
  + 'formulas as formula blocks (LaTeX), one "box" with the key statement to remember at the end. '
  + 'Example: [{"type":"heading","level":1,"text":"Ferranti effect"},{"type":"paragraph","text":"On a long **unloaded** line the voltage at the end rises."},'
  + '{"type":"heading","level":2,"text":"Why"},{"type":"list","items":["capacitive charging current","line inductance"]},{"type":"formula","latex":"U_2 > U_1"},'
  + '{"type":"box","title":"Remember","text":"Long, lightly loaded AC lines: the voltage at the end is higher."}]. '
  + 'Write only what the user asked for; every change shows up in the open notebook and can be undone there.';

/** The text of one page (PDF text from the text index, typed text boxes, table cells). */
function pageText(page, data, textIndex) {
  const parts = [];
  if (page.kind === 'pdf') {
    const idx = textIndex && (textIndex.pages ? textIndex : textIndex[page.src || 'main']);
    const t = idx && idx.pages && idx.pages[page.pdfPage];
    if (t && t.trim()) parts.push(t.replace(/[ \t]+\n/g, '\n').trim());
  }
  const boxes = ((data && data.texts) || []).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of boxes) if (t.text && t.text.trim()) parts.push(t.text.trim());
  for (const it of (data && data.items) || []) {
    if (it.type !== 'table' || !it.cells) continue;
    parts.push(it.cells.map((row) => (row || []).map((c) => (c && c.t ? String(c.t).replace(/\s+/g, ' ') : '')).join(' | ')).join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * The text of pages from..to (1-based) as one string, cut at `max` characters
 * (whole pages only, at least one): { text, from, to, pages, more }.
 */
function notebookText(notebook, pageData, textIndex, { from = 1, to = Infinity, max = 60000 } = {}) {
  const pages = notebook.pages || [];
  const first = Math.max(1, Math.floor(from));
  const last = Math.min(pages.length, Math.floor(to));
  let text = `# ${notebook.title || 'Notebook'} (${pages.length} pages)\n`;
  let end = first - 1;
  for (let n = first; n <= last; n++) {
    const p = pages[n - 1];
    // text boxes carry their id, so apply_edit_plan can change them
    const d = pageData[p.id] || {};
    const pdf = pageText(p, { texts: [], items: [] }, textIndex);
    const boxes = (d.texts || []).filter((t) => t.text && t.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x).map((t) => `[t:${t.id}] ${t.text.trim()}`);
    const tables = pageText({ kind: 'paper' }, { texts: [], items: d.items || [] }, null);
    const body = [pdf, ...boxes, tables].filter(Boolean).join('\n\n') || '(no text)';
    const block = `\n## Page ${n}${p.bm ? ' (bookmarked)' : ''} [${pageSummary(p, d)}]\n${body}\n`;
    if (text.length + block.length > max && end >= first) break;
    text += block;
    end = n;
  }
  const more = end < last;
  if (more) text += `\n(… pages ${end + 1}–${last} not included: call read_notebook with from=${end + 1})\n`;
  return { text, from: first, to: end, pages: pages.length, more };
}

/** Where a new text box of about `lines` lines goes: below everything on the page, or null if it does not fit. */
function freeSpot(page, data, { fs = 14, lines = 1, margin = 40 } = {}) {
  let bottom = margin;
  for (const t of (data && data.texts) || []) bottom = Math.max(bottom, t.y + (t.h || (t.fs || 14) * 1.35 * (t.lines || 1)));
  for (const it of (data && data.items) || []) bottom = Math.max(bottom, (it.y || 0) + (it.h || 0));
  for (const st of (data && data.strokes) || []) for (let i = 1; i < (st.p || []).length; i += 3) bottom = Math.max(bottom, st.p[i]);
  const y = bottom + (bottom > margin ? fs : 0);
  const h = fs * 1.35 * Math.max(1, lines);
  if (y + h > page.h - margin / 2) return null;
  return { x: margin, y, w: page.w - margin * 2 };
}

/** The notebook entry for a path or a title (exact path, then case-insensitive title, then title start). */
function findNotebook(list, ref) {
  const r = String(ref || '').trim();
  const low = r.toLowerCase();
  return list.find((n) => n.path === r)
    || list.find((n) => (n.title || '').toLowerCase() === low)
    || list.filter((n) => (n.title || '').toLowerCase().startsWith(low)).sort((a, b) => b.modified - a.modified)[0]
    || null;
}

module.exports = { TOOLS, INSTRUCTIONS, pageText, notebookText, freeSpot, findNotebook };
