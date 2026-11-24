// Claude (MCP): runs the tools that come in over the local pipe (see
// src/main/mcp-server.js, src/shared/mcp-tools.js). Reading works on closed
// notebooks too; writing opens the notebook and goes through the editor, so
// the change is visible at once and Ctrl+Z undoes it.
import { toast } from './ui.js';
import { notebookText, freeSpot, findNotebook } from '../shared/mcp-tools.js';
import { plainToHtml } from '../shared/richtext.js';
import { uid } from './tools.js';
import { round2 } from '../shared/geometry.js';

const PAPERS = new Set(['blank', 'lined', 'grid', 'dots']);

export class McpTools {
  constructor(app) {
    this.app = app;
    window.api.onMcpCall(async ({ id, name, args }) => {
      try {
        const result = await this.run(name, args || {});
        window.api.mcpResult(id, { ok: true, result });
      } catch (err) {
        window.api.mcpResult(id, { ok: false, error: String((err && err.message) || err) });
      }
    });
  }

  get enabled() { return !!this.app.settings.mcp; }

  async setEnabled(on) {
    const r = await window.api.mcpSetEnabled(!!on);
    this.app.settings.mcp = !!r;
    this.app.saveSettings();
    return r;
  }

  // ---------- helpers ----------
  async allNotebooks(folder = '') {
    const out = [];
    const walk = async (rel, depth) => {
      if (depth > 12) return;
      const r = await window.api.list(rel);
      for (const n of r.notebooks) out.push({ path: n.path, title: n.title, pages: n.pageCount, modified: n.modified, kind: n.kind });
      for (const f of r.folders) await walk(f.path, depth + 1);
    };
    await walk(folder, 0);
    return out;
  }

  async notebookFor(ref) {
    const nb = findNotebook(await this.allNotebooks(), ref);
    if (!nb) throw new Error(`No notebook "${ref}". Use list_notebooks to see the names.`);
    return nb;
  }

  openEditor(rel) { const t = this.app.editors.find(({ editor }) => editor.rel === rel); return t && t.editor; }

  async editorFor(rel) { return this.openEditor(rel) || this.app.openNotebook(rel); }

  pageIndex(editor, n) {
    const i = Math.floor(Number(n)) - 1;
    if (!(i >= 0 && i < editor.pages.length)) throw new Error(`Page ${n} does not exist (the notebook has ${editor.pages.length} pages).`);
    return i;
  }

  // ---------- tools ----------
  async run(name, a) {
    if (!this.enabled) throw new Error('Claude access is switched off in StudyNotes (Settings → Add-ons).');
    switch (name) {
      case 'list_notebooks': {
        const list = await this.allNotebooks(a.folder || '');
        if (!list.length) return 'The library has no notebooks' + (a.folder ? ' in this folder.' : '.');
        return list.map((n) => `- ${n.title} (path: ${n.path}, ${n.pages} pages${n.kind === 'board' ? ', board' : ''}, changed ${n.modified ? new Date(n.modified).toISOString().slice(0, 10) : '?'})`).join('\n');
      }
      case 'read_notebook': {
        const nb = await this.notebookFor(a.notebook);
        const ed = this.openEditor(nb.path);
        let notebook, pageData, textIndex;
        if (ed) {
          notebook = { title: ed.doc.nb.title || nb.title, pages: ed.pages };
          pageData = Object.fromEntries(ed.pages.map((p) => [p.id, ed.pageData(p.id)]));
          textIndex = ed.doc.textIndexes || {};
        } else {
          const raw = await window.api.readNotebook(nb.path);
          notebook = { title: raw.title || nb.title, pages: raw.pages || [] };
          pageData = (await window.api.readPages(nb.path)) || {};
          textIndex = {};
          const srcs = new Set(['main', ...Object.keys(raw.sources || {})]);
          for (const src of srcs) textIndex[src] = await window.api.readText(nb.path, src).catch(() => null);
        }
        const r = notebookText(notebook, pageData, textIndex, { from: a.from || 1, to: a.to || Infinity });
        const noIndex = notebook.pages.some((p) => p.kind === 'pdf' && !(textIndex[p.src || 'main'] && textIndex[p.src || 'main'].pages));
        return r.text + (noIndex ? '\n(Some PDF pages have no text yet: their text is read when the notebook is opened in StudyNotes.)\n' : '');
      }
      case 'search_notes': {
        const hits = await window.api.search(String(a.query));
        if (!hits || !hits.length) return `Nothing found for "${a.query}".`;
        const lines = [];
        for (const nb of hits) {
          if (nb.titleMatch && !(nb.hits || []).length) lines.push(`- ${nb.title} (path: ${nb.path}): the title matches`);
          for (const h of nb.hits || []) lines.push(`- ${nb.title} (path: ${nb.path}), page ${h.pageIndex + 1} [${h.source === 'pdf' ? 'PDF text' : 'note'}]: ${h.snippet}`);
        }
        return lines.slice(0, 200).join('\n') || `Nothing found for "${a.query}".`;
      }
      case 'add_text': {
        const nb = await this.notebookFor(a.notebook);
        const ed = await this.editorFor(nb.path);
        const index = this.pageIndex(ed, a.page);
        const page = ed.pages[index];
        if (page.kind === 'board') throw new Error('Adding text to boards is not supported yet.');
        const text = String(a.text).replace(/\r/g, '').trim();
        if (!text) throw new Error('The text is empty.');
        const fs = Number(a.size) || ed.toolState.text.size || 14;
        const lines = text.split('\n').length;
        const spot = freeSpot(page, ed.pageData(page.id), { fs, lines });
        if (!spot) throw new Error(`Page ${index + 1} is full. Add a page (add_page) and write there.`);
        const t = {
          id: uid(), x: round2(spot.x), y: round2(spot.y), w: round2(spot.w), fs, c: ed.toolState.pen.color || '#1c1c1e',
          text, ff: ed.toolState.text.ff, b: !!a.bold, i: false, u: false, lines,
        };
        if (text.includes('\n')) t.html = plainToHtml(text);
        ed.tools.placeObjects(index, { texts: [t] });
        ed.viewer.scrollToPage(index);
        toast(`Claude added text on page ${index + 1}`);
        return `Added a text box on page ${index + 1} of "${nb.title}".`;
      }
      case 'add_page': {
        const nb = await this.notebookFor(a.notebook);
        const ed = await this.editorFor(nb.path);
        const after = Math.floor(Number(a.after));
        if (!(after >= 0 && after <= ed.pages.length)) throw new Error(`"after" must be between 0 and ${ed.pages.length}.`);
        const paper = PAPERS.has(a.paper) ? a.paper : 'lined';
        if (after === 0) ed.insertPage(0, paper, 'before'); else ed.insertPage(after - 1, paper, 'after');
        const n = after + 1;
        if (a.title && String(a.title).trim()) {
          const page = ed.pages[n - 1];
          const title = String(a.title).trim();
          ed.tools.placeObjects(n - 1, { texts: [{ id: uid(), x: 40, y: 40, w: round2(page.w - 80), fs: 22, c: '#1c1c1e', text: title, ff: ed.toolState.text.ff, b: true, i: false, u: false, lines: 1 }] });
          if (!ed.pages[n - 1].bm) ed.toggleBookmark(n - 1);
        }
        toast(`Claude added page ${n}`);
        return `Added page ${n} to "${nb.title}"${a.title ? ' with a bookmarked title' : ''}.`;
      }
      case 'bookmark_page': {
        const nb = await this.notebookFor(a.notebook);
        const ed = await this.editorFor(nb.path);
        const index = this.pageIndex(ed, a.page);
        const on = a.on !== false;
        if (!!ed.pages[index].bm !== on) ed.toggleBookmark(index);
        return `Page ${index + 1} is ${on ? 'bookmarked' : 'no longer bookmarked'}.`;
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  }
}
