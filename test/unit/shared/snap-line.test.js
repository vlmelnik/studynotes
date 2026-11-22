'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { paperGeometry } = require('../../../src/shared/paper');
const { snapLine } = require('../../../src/shared/snap-line');

const geometry = (kind, colour) => paperGeometry(kind, 595, 842, undefined, colour);
const bbox = (x0, y0, y1) => ({ x0, y0, x1: x0 + 60, y1 });

test('lined paper uses the nearest ruling below the lower-half midpoint', () => {
  assert.deepStrictEqual(snapLine(bbox(90, 74, 94), geometry('lined')), {
    baseline: 96, x: 90, lineHeight: 24, kind: 'ruled',
  });
});

test('college paper uses its own spacing and moves writing inside its margin', () => {
  const paper = geometry('college');
  assert.deepStrictEqual(snapLine(bbox(40, 91, 111), paper), {
    baseline: 110, x: 76, lineHeight: 20, kind: 'ruled',
  });
  assert.deepStrictEqual(snapLine(bbox(72, 95, 115), paper), {
    baseline: 110, x: 72, lineHeight: 20, kind: 'ruled',
  });
});

test('grid paper snaps down to a row and left to a column', () => {
  const gap = 5 * 2.8346;
  assert.deepStrictEqual(snapLine(bbox(35, 12, 28), geometry('grid')), {
    baseline: 2 * gap, x: 2 * gap, lineHeight: gap, kind: 'grid',
  });
});

test('grid10 uses 10 mm spacing and recognizes the dark paper geometry', () => {
  const gap = 10 * 2.8346;
  assert.deepStrictEqual(snapLine(bbox(2 * gap, 30, 60), geometry('grid10', 'dark')), {
    baseline: 2 * gap, x: 2 * gap, lineHeight: gap, kind: 'grid',
  });
});

test('blank, unknown and decorative papers preserve the stroke bounds', () => {
  for (const kind of ['blank', 'unknown', 'music', 'accounting']) {
    assert.deepStrictEqual(snapLine(bbox(30, 40, 55), geometry(kind)), {
      baseline: 55, x: 30, lineHeight: 15, kind: 'free',
    });
  }
});

test('keeps the stroke coordinate when there is no eligible ruling or grid column', () => {
  assert.deepStrictEqual(snapLine(bbox(90, 820, 835), geometry('lined')), {
    baseline: 835, x: 90, lineHeight: 24, kind: 'ruled',
  });
  const gap = 5 * 2.8346;
  assert.deepStrictEqual(snapLine(bbox(4, 1, 9), geometry('grid')), {
    baseline: gap, x: 4, lineHeight: gap, kind: 'grid',
  });
});
