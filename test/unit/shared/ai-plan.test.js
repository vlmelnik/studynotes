'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkPlan, applyPlan, describePlan, underlineTerms, parsePlan, PLAN_SCHEMA } = require('../../../src/shared/ai-plan');
const { parseRich } = require('../../../src/shared/richtext');

const pages = [
  { id: 'p1', kind: 'pdf', w: 595, h: 842 },
  { id: 'p2', kind: 'paper', w: 595, h: 842 },
  { id: 'b1', kind: 'board', w: 2000, h: 2000 },
];
const store = {
  p1: { strokes: [], texts: [{ id: 't1', x: 40, y: 100, w: 300, fs: 14, text: 'The MOSFET switches fast. A mosfet is a transistor.', z: 1 }], items: [] },
  p2: { strokes: [{ p: [10, 300, 0.5] }], texts: [], items: [] },
  b1: { strokes: [], texts: [], items: [] },
};
const nb = { pages, data: (id) => store[id] };
let n = 0;
const newId = () => 'n' + (++n);
const snapshot = JSON.stringify({ pages, store });

test('the schema names every change', () => {
  const names = PLAN_SCHEMA.properties.ops.items.oneOf.map((o) => o.properties.op.const);
  assert.deepStrictEqual(names, ['addText', 'replaceText', 'underline', 'addBookmark', 'moveText', 'addImage', 'addPage', 'removeText']);
});

test('checkPlan accepts a realistic study plan and resolves pages', () => {
  const plan = { version: 1, summary: 'x', ops: [
    { op: 'addPage', after: 2, title: 'Summary' },
    { op: 'addText', page: 'new:1', text: 'Buck converter\n\nD = Uout / Uin' },
    { op: 'underline', page: 1, id: 't1', terms: ['MOSFET', 'transistor'] },
    { op: 'addBookmark', page: 'p2' },
    { op: 'moveText', from: 1, id: 't1', to: 'new:1' },
  ] };
  const r = checkPlan(plan, nb);
  assert.ok(r.ok, JSON.stringify(r.problems));
  assert.strictEqual(r.ops[0].pageId, 'new:1');
  assert.strictEqual(r.ops[0].afterId, 'p2');
  assert.strictEqual(r.ops[2].pageId, 'p1');
  assert.strictEqual(r.ops[4].toId, 'new:1');
});

test('checkPlan refuses with a reason per change', () => {
  const r = checkPlan({ ops: [
    { op: 'explode' },
    { op: 'addText', page: 9, text: 'x' },
    { op: 'addText', page: 1, text: '   ' },
    { op: 'replaceText', page: 1, id: 'nope', text: 'x' },
    { op: 'underline', page: 1, id: 't1', terms: [] },
    { op: 'removeText', page: 1, id: 't1' },
    { op: 'addImage', page: 1, ref: 'c7' },
    { op: 'addText', page: 'new:1', text: 'before the page exists' },
    { op: 'addText', page: 3, text: 'on a board' },
    { op: 'addText', page: 1, html: '<script>x()</script>hi' },
    { op: 'addText', page: 1, text: 'x'.repeat(20001) },
    { op: 'moveText', from: 1, id: 't1', to: 1 },
  ] }, nb);
  assert.ok(!r.ok);
  assert.deepStrictEqual(r.problems.map((p) => p.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.match(r.problems[5].reason, /not allowed/);
  assert.ok(checkPlan({ ops: [{ op: 'removeText', page: 1, id: 't1' }] }, nb, { allowRemove: true }).ok);
  assert.ok(checkPlan({ ops: [{ op: 'addImage', page: 1, ref: 'c7' }] }, nb, { refs: { c7: { src: 'a.png', w: 400, h: 200 } } }).ok);
  assert.ok(!checkPlan({ ops: Array.from({ length: 201 }, () => ({ op: 'addBookmark', page: 1 })) }, nb).ok);
  assert.ok(!checkPlan(null, nb).ok && !checkPlan({}, nb).ok);
  // a text box removed earlier in the plan cannot be changed later
  assert.ok(!checkPlan({ ops: [{ op: 'removeText', page: 1, id: 't1' }, { op: 'underline', page: 1, id: 't1', terms: ['a'] }] }, nb, { allowRemove: true }).ok);
});

test('applyPlan: pages, text, underline, bookmark, move; inputs unchanged', () => {
  n = 0;
  const { ops } = checkPlan({ ops: [
    { op: 'addPage', after: 2, title: 'Summary' },
    { op: 'addText', page: 'new:1', text: 'Buck converter\n\nD = Uout / Uin' },
    { op: 'underline', page: 1, id: 't1', terms: ['MOSFET', 'transistor'] },
    { op: 'addBookmark', page: 2 },
    { op: 'addText', page: 2, text: 'below the ink' },
  ] }, nb);
  const r = applyPlan({ pages, data: (id) => store[id] }, ops, { newId, fontSize: 14 });
  assert.strictEqual(JSON.stringify({ pages, store }), snapshot);
  assert.strictEqual(r.pages.length, 4);
  assert.strictEqual(r.pages[2].id, r.added[0]);
  assert.strictEqual(r.pages[2].bm, 1);
  assert.strictEqual(r.pages[1].bm, 1);
  const np = r.changes.find((c) => c.pageId === r.added[0]).after;
  assert.deepStrictEqual(np.texts.map((t) => t.text), ['Summary', 'Buck converter\n\nD = Uout / Uin']);
  assert.ok(np.texts[1].y > np.texts[0].y);
  const p1 = r.changes.find((c) => c.pageId === 'p1');
  assert.strictEqual(p1.after.texts[0].html, 'The <u>MOSFET</u> switches fast. A <u>mosfet</u> is a <u>transistor</u>.');
  assert.strictEqual(p1.before, store.p1);
  const p2 = r.changes.find((c) => c.pageId === 'p2').after;
  assert.ok(p2.texts[0].y > 300, 'below the stroke');
  assert.deepStrictEqual(describePlan(ops, pages), [
    'Add a page after page 2: "Summary" (bookmarked)',
    'New page 1: add text "Buck converter D = Uout / Uin"',
    'Page 1: underline 2 terms (MOSFET, transistor)',
    'Page 2: bookmark',
    'Page 2: add text "below the ink"',
  ]);
});

test('move text to a page added by the plan, and add a picture', () => {
  n = 0;
  const refs = { c1: { src: 'assets/a.png', w: 800, h: 400 } };
  const { ops } = checkPlan({ ops: [{ op: 'addPage', after: 0 }, { op: 'moveText', from: 1, id: 't1', to: 'new:1' }, { op: 'addImage', page: 'new:1', ref: 'c1' }] }, nb, { refs });
  const r = applyPlan({ pages, data: (id) => store[id] }, ops, { newId, refs });
  assert.strictEqual(r.pages[0].id, r.added[0]);
  const first = r.changes.find((c) => c.pageId === r.added[0]).after;
  assert.strictEqual(first.texts[0].id, 't1');
  assert.strictEqual(first.items[0].src, 'assets/a.png');
  assert.strictEqual(first.items[0].h, first.items[0].w / 2);
  assert.strictEqual(r.changes.find((c) => c.pageId === 'p1').after.texts.length, 0);
});

test('underline: whole words only, idempotent, never inside tags or inline elements', () => {
  const once = underlineTerms('Gate and gates, <b>gate</b> <span data-x="rich-paste:math" data-v="gate">$gate$</span> <a title="gate">x</a>', ['gate']);
  assert.strictEqual(once, '<u>Gate</u> and gates, <b><u>gate</u></b> <span data-x="rich-paste:math" data-v="gate">$gate$</span> <a title="gate">x</a>');
  assert.strictEqual(underlineTerms(once, ['gate']), once);
  assert.strictEqual(underlineTerms('Übergang über', ['über']), 'Übergang <u>über</u>');
  assert.strictEqual(underlineTerms('R&amp;D team', ['R&D']), '<u>R&amp;D</u> team');
  assert.ok(parseRich(once)[0].some((r) => r.u));
});

test('parsePlan finds the plan in an answer', () => {
  assert.deepStrictEqual(parsePlan('Here:\n```json\n{"version":1,"ops":[{"op":"addBookmark","page":1}]}\n```'), { version: 1, ops: [{ op: 'addBookmark', page: 1 }] });
  assert.deepStrictEqual(parsePlan('{"version":1,"ops":[],"answer":"a } b"} trailing'), { version: 1, ops: [], answer: 'a } b' });
  assert.strictEqual(parsePlan('no plan'), null);
  assert.strictEqual(parsePlan('{broken'), null);
});
