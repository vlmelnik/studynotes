'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { googleLine } = require('../src/shared/ocr-text');

test('googleLine: the separator line Google puts first is not text', () => {
  assert.strictEqual(googleLine('________________\n\nCurrent waveform', 'Curent wavefonn'), 'Current waveform');
  assert.strictEqual(googleLine('________________', 'Time'), '');
});

test('googleLine: of several lines, the one like ours (not the longest neighbour)', () => {
  assert.strictEqual(googleLine('Voltage waveform and the long line below it\nTime\n____', 'Tine'), 'Time');
  assert.strictEqual(googleLine('something else entirely\nother text', 'Time'), '');
});
