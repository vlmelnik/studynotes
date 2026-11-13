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

// 1.7.0 r7: formula symbols, units and variables must survive the check
const words = (text, conf) => text.split(' ').map((t, i) => ({ text: t, conf: conf ? conf[i] : undefined }));
const fixC = (text, conf) => correctLines([{ text, words: words(text, conf) }]).lines[0];

test('spell: short symbols and units in formulas stay as they are', () => {
  for (const s of ['die Zeit tf und fT', 'der Wert lc ist klein', 'Fall time tf of the switch', 'время tf мало',
    'Strom Ic und Uce', 'mit dt und df', 'eV und meV', 'ein pn Übergang', 'GaN und SiC']) {
    assert.strictEqual(fixC(s).text, s, s);
  }
});

test('spell: a single Latin letter inside a Russian sentence is a variable, not a word', () => {
  for (const s of ['пусть a равно нулю', 'поле B равно нулю', 'величина B поля', 'где o обозначает угол', 'ток k растёт', 'функция y растёт']) {
    const l = fixC(s);
    assert.strictEqual(l.text, s, s);
    assert.deepStrictEqual(l.words.map((w) => w.text), s.split(' '), s);
  }
});

test('spell: a single letter is still fixed at the start of a sentence or when it was read badly', () => {
  assert.strictEqual(fixC('Это так. K сожалению нет').text, 'Это так. К сожалению нет');
  // a lowercase look-alike only when the reader was unsure about it
  assert.strictEqual(fixC('работа c контакторами', [95, 40, 95]).text, 'работа с контакторами');
  assert.strictEqual(fixC('работа c контакторами', [95, 96, 95]).text, 'работа c контакторами');
});

test('spell: longer misreads are still corrected', () => {
  assert.strictEqual(fixC('fhe tenant pays').text, 'the tenant pays');
  assert.strictEqual(fixC('Tak начинается глава', [40, 95, 95]).text, 'Так начинается глава');
});

test('spell: short Russian words read with Latin look-alikes are still fixed', () => {
  // mixed letters are never a unit
  assert.strictEqual(fixC('нa столе').text, 'на столе');
  assert.strictEqual(fixC('дo вечера').text, 'до вечера');
  // Latin look-alikes that are English words, between Russian words
  assert.strictEqual(fixC('работа no плану').text, 'работа по плану');
  assert.strictEqual(fixC('он he знает').text, 'он не знает');
  assert.strictEqual(fixC('Ha столе лежит').text, 'На столе лежит');
});

test('spell: the start of a line is not the start of a sentence', () => {
  const r = correctLines([{ text: 'поле равно', words: words('поле равно') }, { text: 'B равно нулю', words: words('B равно нулю') }]);
  assert.strictEqual(r.lines[1].text, 'B равно нулю');
  assert.strictEqual(r.lines[1].words[0].text, 'B');
  const r2 = correctLines([{ text: 'Это так.', words: words('Это так.') }, { text: 'K сожалению нет', words: words('K сожалению нет') }]);
  assert.strictEqual(r2.lines[1].text, 'К сожалению нет');
});
