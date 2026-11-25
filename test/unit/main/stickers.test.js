'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { packName } = require('../../../src/main/stickers');

test('sticker pack links', () => {
  assert.strictEqual(packName('https://t.me/addstickers/Animals_42'), 'Animals_42');
  assert.strictEqual(packName('t.me/addstickers/Cats'), 'Cats');
  assert.strictEqual(packName('tg://addstickers?set=Dogs'), 'Dogs');
  assert.strictEqual(packName('Plain_Name'), 'Plain_Name');
  assert.strictEqual(packName('https://t.me/addstickers/../etc'), null);
  assert.strictEqual(packName('https://example.com'), null);
});
