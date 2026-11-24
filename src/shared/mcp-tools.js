'use strict';
// The tools StudyNotes offers to Claude (and other MCP clients) and the pure
// parts of running them: notebook text for reading, where new text goes on a
// page. The renderer runs the tools (src/renderer/mcp.js), so changes go
// through the open notebook, with undo. Pages are numbered from 1 here,
// because that is how people (and the model) talk about them.

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
    name: 'bookmark_page',
    description: 'Sets or removes the bookmark of a page.',
    inputSchema: { type: 'object', required: ['notebook', 'page'], properties: { notebook: notebookArg, page: pageArg, on: { type: 'boolean', description: 'default true' } } },
  },
];

const INSTRUCTIONS = 'StudyNotes is the user\'s note-taking app for lectures and PDFs. Read with list_notebooks, read_notebook and search_notes. '
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
    const body = pageText(p, pageData[p.id], textIndex) || '(no text)';
    const block = `\n## Page ${n}${p.bm ? ' (bookmarked)' : ''}${p.kind === 'pdf' ? '' : p.kind === 'board' ? ' (board)' : ''}\n${body}\n`;
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
