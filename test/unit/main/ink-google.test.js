'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { inkRequest, inkAnswer, recognizeGoogle } = require('../../../src/main/ink-google');

test('Google handwriting: strokes from the top-left of the writing, language and context', () => {
  const r = inkRequest([[100, 50, 110, 60], [120, 50, 130, 70]], { lang: 'de', pre: 'Ein Erdschluss liegt vor, wenn ein Außenleiter' });
  const q = r.requests[0];
  assert.deepStrictEqual(q.ink[0], [[0, 10], [0, 10]]);
  assert.deepStrictEqual(q.ink[1], [[20, 30], [0, 20]]);
  assert.strictEqual(q.language, 'de');
  assert.strictEqual(q.pre_context.length, 40);
  assert.deepStrictEqual(q.writing_guide, { writing_area_width: 30, writing_area_height: 20 });
});

test('Google handwriting: the best reading, errors are said', async () => {
  assert.strictEqual(inkAnswer(['SUCCESS', [['id', ['Erdschluss', 'Erdschlus'], [], {}]]]), 'Erdschluss');
  assert.throws(() => inkAnswer(['FAILED_TO_PARSE_REQUEST_BODY']), /could not read/);
  const fetch = async (url, o) => ({ ok: true, json: async () => ['SUCCESS', [['x', [JSON.parse(o.body).requests[0].language]]]] });
  assert.deepStrictEqual(await recognizeGoogle([[0, 0, 5, 5]], { lang: 'ru' }, fetch), { text: 'ru' });
});
