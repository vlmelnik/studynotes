'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('Russian dictionary: patterns and plurals', () => {
  const ru = require('../../../src/shared/i18n-ru');
  const tr = (s) => { if (ru.words[s]) return ru.words[s]; for (const [re, rep] of ru.patterns) if (re.test(s)) return s.replace(re, rep); return s; };
  assert.strictEqual(tr('Import PDF'), 'Импорт PDF');
  assert.strictEqual(tr('Page 12'), 'Страница 12');
  assert.strictEqual(tr('1 page · 26.10.2026'), '1 страница · 26.10.2026');
  assert.strictEqual(tr('3 pages · x'), '3 страницы · x');
  assert.strictEqual(tr('11 pages · x'), '11 страниц · x');
  assert.strictEqual(tr('Could not save: disk full'), 'Не удалось сохранить: disk full');
  assert.strictEqual(tr('My own notebook title'), 'My own notebook title');
});
