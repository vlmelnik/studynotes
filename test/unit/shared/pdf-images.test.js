'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { imageRects } = require('../../../src/shared/pdf-images');

const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83 };
// a 600 x 800 pt page at scale 1: PDF y goes up, canvas y goes down
const VP = [1, 0, 0, -1, 0, 800];

test('an image placed with cm lands where the canvas shows it', () => {
  // q 200 0 0 100 50 600 cm /Im0 Do Q  -> x 50..250, PDF y 600..700 -> canvas y 100..200
  const r = imageRects([OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore], [null, [200, 0, 0, 100, 50, 600], ['img0', 200, 100], null], OPS, VP);
  assert.deepStrictEqual(r, [{ x0: 50, y0: 100, x1: 250, y1: 200 }]);
});

test('restore undoes a transform, forms apply their matrix, tiny images are dropped', () => {
  const fn = [OPS.save, OPS.transform, OPS.restore, OPS.paintFormXObjectBegin, OPS.save, OPS.transform, OPS.paintInlineImageXObject, OPS.restore, OPS.paintFormXObjectEnd, OPS.save, OPS.transform, OPS.paintImageMaskXObject, OPS.restore];
  const args = [null, [9, 0, 0, 9, 9, 9], null, [[1, 0, 0, 1, 100, 0], [0, 0, 10, 10]], null, [50, 0, 0, 50, 0, 0], [], null, null, null, [2, 0, 0, 2, 10, 10], [], null];
  const r = imageRects(fn, args, OPS, VP);
  assert.deepStrictEqual(r, [{ x0: 100, y0: 750, x1: 150, y1: 800 }]); // the 2 px mask is left out
});

test('scale and a rotated image give its bounding box', () => {
  const r = imageRects([OPS.transform, OPS.paintImageXObject], [[0, 100, -100, 0, 300, 300], []], OPS, [2, 0, 0, -2, 0, 1600]);
  assert.deepStrictEqual(r, [{ x0: 400, y0: 800, x1: 600, y1: 1000 }]);
});
