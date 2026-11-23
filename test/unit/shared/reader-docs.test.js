'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptDocs, docKey, remember, recall, openTabs, closeTab, moveTab, nextTab, prevTab } = require('../../../src/shared/reader-docs');

const file = (name, size = 32, type) => ({ name, size, type });
const key = (name) => docKey(file(name));
const blank = () => ({ tabs: [], active: null, used: {} });

test('document keys ignore name casing but distinguish sizes and names', () => {
  assert.equal(docKey(file('Notes.PDF')), docKey(file('notes.pdf')));
  assert.notEqual(docKey(file('Notes.PDF')), docKey(file('Notes.PDF', 33)));
  assert.notEqual(docKey(file('Notes.PDF')), docKey(file('Notes.png')));
});

test('acceptDocs accepts supported types in drop order', () => {
  const items = [file('Appendix', 32, 'application/pdf'), file('Page.PNG'), file('Page.jpg'), file('Page.JPEG'),
    file('Page.webp'), file('Notes.PDF', 500_000_000)];
  assert.deepEqual(acceptDocs(Object.freeze(items), Object.freeze([])), { add: items, skipped: [] });
});

test('acceptDocs rejects unsupported, empty, oversized and duplicate documents', () => {
  const otherSize = file('Notes.pdf', 33);
  const history = Object.freeze([file('Notes.PDF')]);
  const result = acceptDocs([file('Notes.pdf'), file('archive.zip'), file('empty.pdf', 0), file('large.pdf', 500_000_001),
    otherSize, file('NOTES.PDF', 33), file('extensionless', 32, 'image/png')], history);
  assert.deepEqual(result, { add: [otherSize], skipped: [
    { name: 'Notes.pdf', reason: 'already-open' }, { name: 'archive.zip', reason: 'unsupported' },
    { name: 'empty.pdf', reason: 'empty' }, { name: 'large.pdf', reason: 'too-large' },
    { name: 'NOTES.PDF', reason: 'already-open' }, { name: 'extensionless', reason: 'unsupported' },
  ] });
  assert.deepEqual(history, [file('Notes.PDF')]);
  assert.deepEqual(acceptDocs([file('notes.pdf')], [key('Notes.pdf')]), {
    add: [], skipped: [{ name: 'notes.pdf', reason: 'already-open' }],
  });
});

test('view state is immutable, clamps page and zoom, and round-trips through JSON', () => {
  const original = Object.freeze({});
  const view = Object.freeze({ page: -1, zoom: 90, scrollY: 120, fit: false });
  const store = remember(original, 'a', view);
  assert.deepEqual(original, {});
  assert.deepEqual(recall(JSON.parse(JSON.stringify(store)), 'a'), { page: 0, zoom: 8, scrollY: 120, fit: false });
  assert.deepEqual(recall(remember(store, 'b', { page: 2.4, zoom: 0, fit: true }), 'b'), { page: 2, zoom: 0.1, scrollY: 0, fit: true });
  assert.deepEqual(recall(remember(store, 'c', { page: 4, zoom: null, scrollY: 50 }), 'c'), { page: 4, zoom: null, scrollY: 50, fit: true });
  assert.deepEqual(recall(store, 'missing'), { page: 0, zoom: null, scrollY: 0, fit: true });
});

test('the fifty-document store evicts the least recently remembered entry', () => {
  const position = { page: 1, zoom: 1, scrollY: 40, fit: false };
  let store = {};
  for (let i = 0; i < 50; i++) store = remember(store, `doc${i}`, position);
  const recent = remember(store, 'doc0', recall(store, 'doc0'));
  const expanded = remember(recent, 'doc50', position);
  assert.equal(recall(expanded, 'doc0').page, 1);
  assert.equal(recall(expanded, 'doc1').zoom, null);
  assert.equal(recall(expanded, 'doc50').page, 1);
  assert.equal(recall(store, 'doc1').page, 1);
});

test('opening tabs appends unique keys and activates the first new one', () => {
  const a = file('a.pdf'), b = file('b.pdf'), c = file('c.pdf');
  const initial = openTabs(blank(), [a]);
  Object.freeze(initial.tabs);
  Object.freeze(initial.used);
  Object.freeze(initial);
  const added = openTabs(initial, [a, b, c, b]);
  assert.deepEqual(added.tabs, [docKey(a), docKey(b), docKey(c)]);
  assert.equal(added.active, docKey(b));
  assert.deepEqual(openTabs(added, [c, a]), added);
  assert.deepEqual(initial.tabs, [docKey(a)]);
});

test('closing the active tab activates the right neighbour, then left, then none', () => {
  const keys = ['a.pdf', 'b.pdf', 'c.pdf'].map(key);
  const initial = openTabs(blank(), ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => file(name)));
  const middle = nextTab(initial);
  const right = closeTab(middle, keys[1]);
  assert.deepEqual(right.tabs, [keys[0], keys[2]]);
  assert.equal(right.active, keys[2]);
  assert.deepEqual(closeTab(middle, 'missing'), middle);
  assert.equal(closeTab(middle, keys[0]).active, keys[1]);
  const left = closeTab(right, keys[2]);
  assert.equal(left.active, keys[0]);
  assert.deepEqual(closeTab(left, keys[0]), blank());
});

test('moving tabs clamps the index and cycling wraps in both directions', () => {
  const names = ['a.pdf', 'b.pdf', 'c.pdf'];
  const keys = names.map(key);
  const initial = openTabs(blank(), names.map((name) => file(name)));
  const moved = moveTab(initial, keys[2], -100);
  assert.deepEqual(moved.tabs, [keys[2], keys[0], keys[1]]);
  assert.equal(moved.active, keys[0]);
  assert.deepEqual(moveTab(moved, keys[2], 100).tabs, keys);
  assert.deepEqual(moveTab(moved, 'missing', 0), moved);
  assert.equal(nextTab(nextTab(moved)).active, keys[2]);
  assert.equal(prevTab(prevTab(moved)).active, keys[1]);
  assert.deepEqual(nextTab(blank()), blank());
  assert.deepEqual(prevTab(blank()), blank());
});

test('the twelve-tab cap evicts least recently active keys, never the newly active tab', () => {
  const names = Array.from({ length: 13 }, (_, i) => `Reader ${i}.pdf`);
  let state = blank();
  for (const name of names.slice(0, 12)) state = openTabs(state, [file(name)]);
  state = nextTab(state); // Make the oldest tab most recently active.
  const added = openTabs(state, [file(names[12])]);
  assert.equal(added.tabs.length, 12);
  assert.equal(added.active, key(names[12]));
  assert.ok(added.tabs.includes(key(names[0])));
  assert.ok(!added.tabs.includes(key(names[1])));
  assert.ok(!Object.hasOwn(added.used, key(names[1])));
  const bulk = openTabs(blank(), names.map((name) => file(name)));
  assert.deepEqual(bulk.tabs, names.slice(0, 12).map(key));
  assert.equal(bulk.active, key(names[0]));
});

test('a drop at capacity keeps the whole new batch if it fits on its own', () => {
  const olderNames = Array.from({ length: 11 }, (_, i) => `Saved ${i}.pdf`);
  let state = blank();
  for (const name of olderNames) state = openTabs(state, [file(name)]);
  const { add } = acceptDocs([file('New A.pdf'), file('New B.pdf')], state.tabs);
  const added = openTabs(state, add);
  assert.deepEqual(added.tabs, [...olderNames.slice(1), 'New A.pdf', 'New B.pdf'].map(key));
  assert.equal(added.active, key('New A.pdf'));
});

test('reader workflow restores a position after dropping documents and switching tabs', () => {
  const { add, skipped } = acceptDocs([file('Reference.pdf'), file('Figure.webp'), file('Video.mp4')], []);
  assert.deepEqual(skipped, [{ name: 'Video.mp4', reason: 'unsupported' }]);
  const state = openTabs(blank(), add);
  const later = nextTab(state);
  const position = { page: 3, zoom: 1.5, scrollY: 280, fit: false };
  const store = remember({}, state.active, position);
  const restored = closeTab(later, later.active);
  assert.equal(restored.active, key('Reference.pdf'));
  assert.deepEqual(recall(JSON.parse(JSON.stringify(store)), restored.active), position);
});
