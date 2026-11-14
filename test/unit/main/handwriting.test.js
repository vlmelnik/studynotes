'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('1.7: handwriting words are put in reading order', () => {
  const { wordsToText } = require('../../../src/main/handwriting');
  const w = (text, x, y) => ({ text, x, y, w: 30, h: 12 });
  assert.strictEqual(wordsToText([w('world', 60, 10), w('second', 10, 40), w('hello', 10, 12), w('line', 70, 41)]), 'hello world\nsecond line');
});
