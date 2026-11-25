'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../../src/shared/capture-session');

const T = 1_700_000_000_000;
const min = 60000;

test('parseTitle: the three browsers, an address as title, a normal app', () => {
  assert.deepStrictEqual(C.parseTitle('Semiconductors – Wikipedia - Google Chrome'), { app: 'Chrome', title: 'Semiconductors – Wikipedia', url: null });
  assert.deepStrictEqual(C.parseTitle('example.org/lecture/3 — Mozilla Firefox'), { app: 'Firefox', title: 'example.org/lecture/3', url: 'https://example.org/lecture/3' });
  assert.strictEqual(C.parseTitle('https://example.org - Microsoft​ Edge').url, 'https://example.org');
  assert.deepStrictEqual(C.parseTitle('Lecture 3.pdf - Viewer', 'Viewer'), { app: 'Viewer', title: 'Lecture 3.pdf - Viewer', url: null });
});

test('addItem: every kind; the same picture or the same text within 10 min is counted, not added; input untouched', () => {
  let s = C.newSession({ id: 's1', topic: 'Doping', startedAt: T });
  const s0 = s;
  s = C.addItem(s, { id: 'c1', kind: 'region', at: T + min, title: 'Doping - Google Chrome', image: { hash: 'h1', width: 400, height: 200 } });
  s = C.addItem(s, { id: 'c2', kind: 'window', at: T + 2 * min, title: 'Lecture.pdf - Viewer', app: 'Viewer', image: { hash: 'h2', width: 1200, height: 800 } });
  s = C.addItem(s, { id: 'c3', kind: 'page', at: T + 3 * min, image: { hash: 'h3', width: 1920, height: 1080 } });
  s = C.addItem(s, { id: 'c4', kind: 'text', at: T + 4 * min, text: 'Donors add free electrons.', title: 'Doping - Google Chrome' });
  s = C.addItem(s, { id: 'c5', kind: 'note', at: T + 5 * min, text: 'ask about p-n junction' });
  s = C.addItem(s, { id: 'c6', kind: 'region', at: T + 6 * min, image: { hash: 'h1', width: 400, height: 200 } });
  s = C.addItem(s, { id: 'c7', kind: 'text', at: T + 9 * min, text: '  Donors add   free electrons. ' });
  s = C.addItem(s, { id: 'c8', kind: 'text', at: T + 30 * min, text: 'Donors add free electrons.' });
  assert.strictEqual(s0.items.length, 0);
  assert.deepStrictEqual(s.items.map((x) => [x.id, x.count]), [['c1', 2], ['c2', 1], ['c3', 1], ['c4', 2], ['c5', 1], ['c8', 1]]);
  assert.throws(() => C.addItem(s, { id: 'x', kind: 'video' }), /Unknown kind/);
  assert.deepStrictEqual(C.summary(s), { counts: { region: 1, window: 1, page: 1, text: 2, note: 1 }, total: 6, minutes: 30 });
  assert.strictEqual(C.removeItem(s, 'c5').items.length, 5);
});

test('groups: by source in time order, also when apps take turns', () => {
  let s = C.newSession({ id: 's', startedAt: T });
  s = C.addItem(s, { id: 'a', kind: 'text', at: T + 1, text: 'one', title: 'A - Google Chrome' });
  s = C.addItem(s, { id: 'b', kind: 'text', at: T + 2, text: 'two', title: 'Lecture.pdf - Viewer', app: 'Viewer' });
  s = C.addItem(s, { id: 'c', kind: 'text', at: T + 3, text: 'three', title: 'A - Google Chrome' });
  s = C.addItem(s, { id: 'd', kind: 'note', at: T + 4, text: 'mine' });
  const g = C.groups(s);
  assert.deepStrictEqual(g.map((x) => [x.label, x.items.map((i) => i.id).join('')]), [['Chrome: A', 'ac'], ['Viewer: Lecture.pdf - Viewer', 'b'], ['Own notes', 'd']]);
});

test('forPrompt: one line per item with its id, pictures as refs, cut at the budget', () => {
  let s = C.newSession({ id: 's', topic: 'Doping', startedAt: T });
  s = C.addItem(s, { id: 'c1', kind: 'region', at: T + 1, title: 'Doping - Google Chrome', image: { hash: 'h1', width: 400, height: 200 } });
  s = C.addItem(s, { id: 'c2', kind: 'text', at: T + 2, text: 'Donors add free electrons.', title: 'Doping - Google Chrome' });
  for (let i = 0; i < 50; i++) s = C.addItem(s, { id: 'n' + i, kind: 'note', at: T + 10 + i, text: 'note number ' + i + ' '.repeat(i) + 'x'.repeat(40) });
  const all = C.forPrompt(s);
  assert.ok(all.text.startsWith('[c1] (region, Chrome: Doping) picture 400x200\n[c2] (text, Chrome: Doping) Donors add free electrons.'), all.text.slice(0, 200));
  assert.deepStrictEqual(all.refs, { c1: 'h1' });
  const cut = C.forPrompt(s, { budget: 400 });
  assert.ok(cut.text.length < 520 && /more items left out/.test(cut.text), cut.text);
});
