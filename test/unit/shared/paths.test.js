'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../../src/shared/paths');

test('normalize collapses ".", "//", trailing "/" and inner ".."', () => {
  assert.strictEqual(P.normalize(''), '');
  assert.strictEqual(P.normalize('.'), '');
  assert.strictEqual(P.normalize('./'), '');
  assert.strictEqual(P.normalize('a//b/./c/'), 'a/b/c');
  assert.strictEqual(P.normalize('a/b/../c'), 'a/c');
  assert.strictEqual(P.normalize('a/..'), '');
  assert.strictEqual(P.normalize('Übung/Заметки/note 1.json'), 'Übung/Заметки/note 1.json');
  assert.strictEqual(P.normalize('a/..b/c..'), 'a/..b/c..', 'dots inside a name are plain characters');
});

test('normalize rejects paths that escape or are not library-relative', () => {
  const bad = ['..', '../x', 'a/../../x', './..', '/abs', '//abs', 'a\\b', '..\\x', 'a\u0000b', 'C:/x', 'c:x'];
  for (const p of bad) assert.throws(() => P.normalize(p), /Invalid library path/, p);
  for (const p of [null, undefined, 5, {}]) assert.throws(() => P.normalize(p), /not a string/);
});

test('join', () => {
  assert.strictEqual(P.join(), '');
  assert.strictEqual(P.join('', 'a', '', 'b'), 'a/b');
  assert.strictEqual(P.join('a/', '/b', 'c.json'), 'a/b/c.json');
  assert.strictEqual(P.join('a/b', '..', 'c'), 'a/c');
  assert.throws(() => P.join('a', '..', '..', 'x'), /leaves the library root/);
  assert.throws(() => P.join('a', 'b\\c'), /backslash/);
});

test('dirname, basename, extname', () => {
  assert.strictEqual(P.dirname('a/b/c.json'), 'a/b');
  assert.strictEqual(P.dirname('a'), '');
  assert.strictEqual(P.dirname(''), '');
  assert.strictEqual(P.dirname('a/b/'), 'a');
  assert.strictEqual(P.basename('a/b/c.json'), 'c.json');
  assert.strictEqual(P.basename('a/b/'), 'b');
  assert.strictEqual(P.basename(''), '');
  assert.strictEqual(P.extname('a/b/c.json'), '.json');
  assert.strictEqual(P.extname('x.tar.gz'), '.gz');
  assert.strictEqual(P.extname('.view'), '');
  assert.strictEqual(P.extname('.view.json'), '.json');
  assert.strictEqual(P.extname('README'), '');
  assert.strictEqual(P.extname('a.b/c'), '');
  assert.throws(() => P.dirname('../x'));
  assert.throws(() => P.basename('/x'));
});

test('isInside compares whole segments', () => {
  assert.strictEqual(P.isInside('', 'a/b'), true);
  assert.strictEqual(P.isInside('', ''), true);
  assert.strictEqual(P.isInside('a', 'a'), true);
  assert.strictEqual(P.isInside('a', 'a/b'), true);
  assert.strictEqual(P.isInside('a/', 'a//b/c'), true);
  assert.strictEqual(P.isInside('a', 'ab'), false);
  assert.strictEqual(P.isInside('a/b', 'a'), false);
  assert.strictEqual(P.isInside('a', 'b/../a/c'), true);
  assert.throws(() => P.isInside('a', '../a/x'));
});
