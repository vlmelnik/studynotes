'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TOOLS, pageText, notebookText, freeSpot, findNotebook } = require('../../../src/shared/mcp-tools');

const nb = { title: 'Power electronics', pages: [
  { id: 'a', kind: 'pdf', pdfPage: 1, w: 595, h: 842, bm: 1 },
  { id: 'b', kind: 'paper', w: 595, h: 842 },
  { id: 'c', kind: 'pdf', pdfPage: 2, src: 's1', w: 595, h: 842 },
] };
const data = {
  a: { texts: [{ id: 't2', x: 40, y: 300, text: 'second note', fs: 14 }, { id: 't1', x: 40, y: 100, text: 'first note', fs: 14 }], items: [], strokes: [] },
  b: { texts: [], items: [{ type: 'table', cells: [[{ t: 'U' }, { t: 'I' }], [{ t: '230 V' }, { t: '2 A' }]] }], strokes: [] },
  c: { texts: [], items: [], strokes: [] },
};
const text = { main: { pages: { 1: 'Buck converter   \nduty cycle' } }, s1: { pages: { 2: 'Second source page' } } };

test('the tool list is complete and every tool has a schema', () => {
  assert.deepStrictEqual(TOOLS.map((t) => t.name), ['list_notebooks', 'read_notebook', 'search_notes', 'add_text', 'add_page', 'bookmark_page']);
  for (const t of TOOLS) assert.strictEqual(t.inputSchema.type, 'object');
});

test('page text: PDF text of the right source, boxes top to bottom, tables', () => {
  assert.strictEqual(pageText(nb.pages[0], data.a, text), 'Buck converter\nduty cycle\n\nfirst note\n\nsecond note');
  assert.strictEqual(pageText(nb.pages[1], data.b, text), 'U | I\n230 V | 2 A');
  assert.strictEqual(pageText(nb.pages[2], data.c, text), 'Second source page');
  assert.strictEqual(pageText(nb.pages[0], undefined, { pages: { 1: 'old style index' } }), 'old style index');
});

test('notebook text: headings, bookmarks, ranges and the size limit', () => {
  const all = notebookText(nb, data, text);
  assert.ok(all.text.includes('## Page 1 (bookmarked)') && all.text.includes('## Page 3') && !all.more);
  const two = notebookText(nb, data, text, { from: 2, to: 2 });
  assert.ok(!two.text.includes('## Page 1') && two.text.includes('## Page 2') && two.to === 2);
  const small = notebookText(nb, data, text, { max: 120 });
  assert.ok(small.more && small.to >= 1 && small.text.includes('from=' + (small.to + 1)));
});

test('free spot: below the lowest object, null when the page is full', () => {
  const s = freeSpot(nb.pages[0], data.a, { fs: 14, lines: 2 });
  assert.ok(s.y > 300 + 14 && s.x === 40 && s.w === 515);
  assert.deepStrictEqual(freeSpot(nb.pages[2], data.c), { x: 40, y: 40, w: 515 });
  assert.strictEqual(freeSpot(nb.pages[0], { texts: [{ x: 0, y: 800, fs: 14 }] }, { lines: 3 }), null);
  assert.ok(freeSpot(nb.pages[1], { strokes: [{ p: [10, 500, 0.5] }] }).y > 500);
});

test('findNotebook: path, title, title start (newest first)', () => {
  const list = [{ path: 'S1/PE', title: 'Power electronics', modified: 1 }, { path: 'S2/PE', title: 'Power electronics 2', modified: 5 }];
  assert.strictEqual(findNotebook(list, 'S1/PE').path, 'S1/PE');
  assert.strictEqual(findNotebook(list, 'power electronics').path, 'S1/PE');
  assert.strictEqual(findNotebook(list, 'Power').path, 'S2/PE');
  assert.strictEqual(findNotebook(list, 'Physics'), null);
});
