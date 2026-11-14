'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { paperGeometry, PAPERS } = require('../../../src/shared/paper');

test('every paper template produces finite geometry', () => {
  for (const [k] of PAPERS) {
    const g = paperGeometry(k, 595, 842);
    for (const l of g.lines) assert.ok(l.slice(0, 4).every(Number.isFinite), k);
    for (const d of g.dots) assert.ok(d.slice(0, 2).every(Number.isFinite), k);
  }
  assert.ok(paperGeometry('board', 0, 0, [-100, -100, 100, 100]).dots.length > 0);
});
