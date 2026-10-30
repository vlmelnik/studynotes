'use strict';
// Library-wide search over extracted PDF text (text.json) and typed text boxes.

// Case/accent folding that keeps string length, so an index found in the
// folded text is valid in the original text too.
const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'); // combining accents
function fold(s) {
  let out = '';
  for (const ch of String(s || '')) {
    let f = ch.normalize('NFKD').replace(MARKS, '').toLowerCase();
    if (f.length !== ch.length) f = (ch.toLowerCase() + '  ').slice(0, ch.length);
    out += f;
  }
  return out;
}

function collapse(s) {
  return String(s || '').replace(/\s+/g, ' ');
}

function normalize(s) {
  return fold(collapse(s));
}

function snippet(text, idx, qlen) {
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + qlen + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// Text index per PDF source: { pages: { "<pdfPage>": "text" } }.
// `textIndex` is either one index (the main PDF, older call style) or a map
// { main: index, <sourceId>: index, ... }.
function indexFor(textIndex, src) {
  if (!textIndex) return null;
  if (textIndex.pages) return src === 'main' ? textIndex : null;
  return textIndex[src] || null;
}

function richPlain(s) {
  // Typed text is stored as plain `text` (always kept in sync with rich html).
  return s || '';
}

// Returns hits: [{ pageId, pageIndex, source: 'pdf'|'note', snippet }]
function searchNotebook(notebook, textIndex, pageData, query, limit = 200) {
  const q = normalize(query).trim();
  if (!q) return [];
  const hits = [];
  notebook.pages.forEach((pg, i) => {
    if (hits.length >= limit) return;
    const tix = pg.kind === 'pdf' ? indexFor(textIndex, pg.src || 'main') : null;
    if (tix && tix.pages) {
      const raw = collapse(tix.pages[pg.pdfPage]);
      const idx = fold(raw).indexOf(q);
      if (idx >= 0) hits.push({ pageId: pg.id, pageIndex: i, source: 'pdf', snippet: snippet(raw, idx, q.length) });
    }
    const d = pageData && pageData[pg.id];
    if (d && d.texts) {
      const tables = (d.items || []).filter((it) => it.type === 'table')
        .map((it) => ({ text: (it.cells || []).map((row) => row.map((c) => c.t || '').join(' ')).join(' ') }));
      for (const tb of d.texts.concat(tables)) {
        const raw = collapse(richPlain(tb.text));
        const idx = fold(raw).indexOf(q);
        if (idx >= 0) {
          hits.push({ pageId: pg.id, pageIndex: i, source: 'note', snippet: snippet(raw, idx, q.length) });
          break;
        }
      }
    }
  });
  return hits;
}

async function searchLibrary(library, query, limitPerNotebook = 20) {
  const q = normalize(query).trim();
  if (!q) return [];
  const results = [];
  const notebooks = await library.listAllNotebooks();
  const titleHits = [];
  for (const nb of notebooks) {
    const full = await library.readNotebook(nb.path).catch(() => null);
    if (!full) continue;
    const text = {};
    for (const src of Object.keys(full.sources || (full.hasPdf ? { main: 1 } : {}))) {
      text[src] = await library.readText(nb.path, src).catch(() => null);
    }
    const ids = await library.listPageFiles(nb.path);
    const pageData = ids.length ? await library.readPages(nb.path, ids) : {};
    const hits = searchNotebook(full, text, pageData, query, limitPerNotebook);
    const titleMatch = normalize(full.title).includes(q);
    if (hits.length || titleMatch) {
      (titleMatch ? titleHits : results).push({ path: nb.path, title: full.title, hits, titleMatch });
    }
  }
  return titleHits.concat(results);
}

module.exports = { searchNotebook, searchLibrary, normalize, fold };
