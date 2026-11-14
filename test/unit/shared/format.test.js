'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { migrateNotebook, migratePage, pageIsEmpty, makeSettingsExport, readSettingsImport } = require('../../../src/shared/format');

test('format: v1 notebooks migrate, unknown fields survive', () => {
  const nb = migrateNotebook({ version: 1, hasPdf: true, pages: [], futureField: 42 });
  assert.strictEqual(nb.version, 2);
  assert.deepStrictEqual(nb.sources, { main: { file: 'source.pdf' } });
  assert.strictEqual(nb.futureField, 42);
  assert.strictEqual(migrateNotebook({ version: 9, pages: [] }).newerVersion, 9);
  const pg = migratePage({ strokes: [], future: [1] });
  assert.deepStrictEqual(pg.items, []);
  assert.strictEqual(pageIsEmpty(pg), false, 'unknown data keeps the page file');
  assert.strictEqual(pageIsEmpty({ strokes: [], texts: [], items: [] }), true);
  const exp = makeSettingsExport({ a: 1 }, '1.1.0');
  assert.deepStrictEqual(readSettingsImport(JSON.parse(JSON.stringify(exp))), { a: 1 });
  assert.throws(() => readSettingsImport({ format: 'other' }));
});
