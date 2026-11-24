'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { estimateTokens, buildContext, buildRequest } = require('../../../src/shared/ai-context');

const pages = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + (i + 1), kind: i < 3 ? 'pdf' : 'paper', pdfPage: i + 1, w: 595, h: 842, bm: i === 5 ? 1 : undefined }));
const data = {
  p2: { texts: [{ id: 'b', x: 40, y: 200, text: 'second box' }, { id: 'a', x: 40, y: 100, text: 'first box' }], items: [] },
  p4: { texts: [], items: [{ type: 'table', cells: [[{ t: 'U' }, { t: 'I' }]] }] },
  p6: { texts: [{ id: 'z', x: 0, y: 0, text: 'Важное определение' }], items: [] },
};
const index = { main: { pages: { 1: 'Page one PDF text.', 2: 'Page two PDF text.', 3: 'Page three PDF text.' } } };
const nb = { title: 'Power electronics', pages };

test('ids for every piece, boxes top to bottom, tables, bookmarks', () => {
  const r = buildContext(nb, data, index, { current: 2 });
  assert.ok(r.text.includes('=== Page 2 (PDF) ===\n[p2] Page two PDF text.\n[p2 t:a] first box\n[p2 t:b] second box'));
  assert.ok(r.text.includes('[p4 table] U | I'));
  assert.ok(r.text.includes('=== Page 6 (bookmarked) ==='));
  assert.deepStrictEqual(r.pagesSent, [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(r.dropped.length, 0);
});

test('budget: current page, neighbours and bookmarks first; the rest is listed as dropped', () => {
  const r = buildContext(nb, data, index, { current: 2, budget: 240 });
  assert.deepStrictEqual(r.pagesSent, [1, 2, 3, 6], JSON.stringify(r));
  assert.deepStrictEqual(r.dropped, [4, 5]);
  assert.ok(r.text.includes('size limit: 4–5'));
  assert.ok(r.text.indexOf('=== Page 1') < r.text.indexOf('=== Page 2'), 'sent pages stay in page order');
});

test('scope page and selection', () => {
  const page = buildContext(nb, data, index, { current: 2, scope: 'page' });
  assert.deepStrictEqual(page.pagesSent, [2]);
  const sel = buildContext(nb, data, index, { scope: 'selection', selection: { page: 2, ids: ['b'] } });
  assert.ok(sel.text.includes('[p2 t:b] second box') && !sel.text.includes('first box') && !sel.text.includes('PDF text'));
});

test('a page too large alone is cut at a sentence end', () => {
  const big = { main: { pages: { 1: 'One sentence here. '.repeat(400) } } };
  const r = buildContext({ title: 't', pages: [pages[0]] }, {}, big, { budget: 1000 });
  assert.ok(r.text.length < 1200 && r.text.includes('here. …'), r.text.slice(-80));
});

test('300 pages under 200 ms; token estimate', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ id: 'q' + i, kind: 'pdf', pdfPage: i + 1, w: 595, h: 842 }));
  const idx = { main: { pages: Object.fromEntries(many.map((p, i) => [i + 1, 'Lecture text about converters. '.repeat(30)])) } };
  const t = Date.now();
  const r = buildContext({ title: 'big', pages: many }, {}, idx, { current: 150, budget: 60000 });
  assert.ok(Date.now() - t < 200);
  assert.ok(r.used <= 60000 + 200 && r.dropped.length > 0, String(r.used));
  assert.strictEqual(estimateTokens('abcd'.repeat(10)), 10);
  assert.strictEqual(estimateTokens('Привет'), 3);
});

test('request: plan rules, mode and standing instructions', () => {
  const r = buildRequest({ prompt: 'Summarise page 2', context: 'CTX', mode: 'ask', custom: 'Answer in German.' });
  assert.ok(r.system.includes('"ops" must be []') && r.system.includes('Answer in German.') && r.system.includes('"addPage"'));
  assert.ok(r.user.startsWith('CTX') && r.user.endsWith('Request: Summarise page 2'));
  assert.ok(!buildRequest({ prompt: 'x', context: '' }).system.includes('standing instructions'));
});
