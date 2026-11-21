'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapPdfOutline } = require('../../../src/shared/outline');

function pdfPage(id, pdfPage, src) {
  return { id, kind: 'pdf', pdfPage, src };
}

test('maps a nested outline, preserving order and leaving the inputs untouched', () => {
  const items = Object.freeze([
    Object.freeze({ title: '  Chapter\t\n one  ', page: 5, items: Object.freeze([
      Object.freeze({ title: 'Examples', page: 2, items: Object.freeze([
        Object.freeze({ title: 'Further reading', page: null, items: Object.freeze([]) }),
      ]) }),
    ]) }),
    Object.freeze({ title: 'Summary', page: 8, items: Object.freeze([]) }),
  ]);
  const pages = Object.freeze([
    Object.freeze(pdfPage('page-5', 5)),
    Object.freeze(pdfPage('page-8', 8, 'main')),
    Object.freeze(pdfPage('page-2', 2)),
  ]);
  assert.deepStrictEqual(mapPdfOutline(items, 'main', pages), [
    { title: 'Chapter one', pageId: 'page-5', level: 0, items: [
      { title: 'Examples', pageId: 'page-2', level: 1, items: [
        { title: 'Further reading', pageId: null, level: 2, items: [] },
      ] },
    ] },
    { title: 'Summary', pageId: 'page-8', level: 0, items: [] },
  ]);
});

test('uses the next PDF page for a deleted destination, then the previous page at the end', () => {
  const pages = [pdfPage('page-9', 9), pdfPage('page-2', 2), pdfPage('page-7', 7)];
  const items = [
    { title: 'Start', page: 1, items: [] },
    { title: 'Middle', page: 3, items: [] },
    { title: 'End', page: 12, items: [] },
  ];
  assert.deepStrictEqual(mapPdfOutline(items, 'main', pages).map((item) => item.pageId), [
    'page-2', 'page-7', 'page-9',
  ]);
});

test('the first notebook copy supplies both exact and replacement destinations', () => {
  const pages = [pdfPage('first-copy', 6), pdfPage('second-copy', 6)];
  const items = [
    { title: 'Exact', page: 6, items: [] },
    { title: 'Deleted', page: 5, items: [] },
  ];
  assert.deepStrictEqual(mapPdfOutline(items, 'main', pages).map((item) => item.pageId), [
    'first-copy', 'first-copy',
  ]);
});

test('ignores pages from other sources and pages that are not PDF pages', () => {
  const pages = [
    pdfPage('main-4', 4),
    { id: 'paper', kind: 'paper', src: 'appendix', pdfPage: 4 },
    pdfPage('appendix-9', 9, 'appendix'),
  ];
  const items = [{ title: 'Section', page: 4, items: [] }];
  assert.strictEqual(mapPdfOutline(items, 'appendix', pages)[0].pageId, 'appendix-9');
  assert.strictEqual(mapPdfOutline(items, 'main', pages)[0].pageId, 'main-4');
  assert.strictEqual(mapPdfOutline(items, 'missing-source', pages)[0].pageId, null);
});

test('normalizes titles before limiting them to 200 characters', () => {
  const prefix = 'A'.repeat(198);
  const items = [
    { title: `  ${prefix}\t\nBC`, page: null, items: [] },
    { title: `${prefix}A📘B`, page: null, items: [] },
    { title: `${prefix}A B`, page: null, items: [] },
  ];
  assert.deepStrictEqual(mapPdfOutline(items, 'main', []).map((item) => item.title), [
    `${prefix} B`, `${prefix}A📘`, `${prefix}A`,
  ]);
});

test('an empty PDF outline maps to an empty tree', () => {
  assert.deepStrictEqual(mapPdfOutline([], 'main', [pdfPage('page-1', 1)]), []);
});
