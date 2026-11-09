'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { correctLines } = require('../src/main/spell');

const fix = (text) => correctLines([{ text, words: text.split(' ').map((t) => ({ text: t })) }]).lines[0];

test('spell: a Russian word read with Latin look-alike letters is corrected', () => {
  const l = fix('Tak начинается новая глава');
  assert.strictEqual(l.text, 'Так начинается новая глава');
  assert.strictEqual(l.words[0].text, 'Так');
});

test('spell: a lost space after a Russian preposition is put back', () => {
  assert.strictEqual(fix('Работа сконтакторами и реле').text, 'Работа с контакторами и реле');
});

test('spell: right words, terms and acronyms stay as they are', () => {
  for (const s of ['Modbus TCP über Ethernet', 'Der Eingang ist offen', 'Протокол RS-485 и TCP', 'The tenant agrees to pay the rent']) {
    assert.strictEqual(fix(s).text, s);
  }
});

test('spell: a one-letter Russian word read in Latin, but not a label', () => {
  assert.strictEqual(fix('K сожалению это так').text, 'К сожалению это так');
  assert.strictEqual(fix('B понедельник').words[0].text, 'В');
  assert.strictEqual(fix('Точка A и точка B').text, 'Точка A и точка B');
});
