'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { imageRects } = require('../../../src/shared/pdf-images');

const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83,
  paintImageXObjectRepeat: 88, paintInlineImageXObjectGroup: 87, paintImageMaskXObjectRepeat: 89, paintImageMaskXObjectGroup: 84 };
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

test('PDF.js repeat and group operators protect each placement in a rotated tile', () => {
  const viewport = [0, 2, 2, 0, -80, -100];
  const fn = [OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObjectRepeat, OPS.paintImageMaskXObjectGroup];
  const args = [
    ['photo', 20, 30, new Float32Array([50, 40, 80, 65])],
    [{}, [{ transform: [10, 0, 0, 15, 70, 100] }]],
    [{}, 12, 0, 0, 18, new Float32Array([95, 110])],
    [[{ transform: [8, 0, 0, 9, 60, 125] }]],
  ];
  assert.deepStrictEqual(imageRects(fn, args, OPS, viewport), [
    { x0: 0, y0: 0, x1: 60, y1: 40 },
    { x0: 50, y0: 60, x1: 110, y1: 100 },
    { x0: 120, y0: 40, x1: 150, y1: 60 },
    { x0: 140, y0: 90, x1: 176, y1: 114 },
    { x0: 170, y0: 20, x1: 188, y1: 36 },
  ]);
});

test('a PDF.js typed form matrix moves and scales the picture inside it', () => {
  const fn = [OPS.paintFormXObjectBegin, OPS.transform, OPS.paintImageXObject, OPS.paintFormXObjectEnd];
  const args = [[new Float32Array([2, 0, 0, 2, 100, 300])], [20, 0, 0, 30, 10, 15], ['photo'], null];
  assert.deepStrictEqual(imageRects(fn, args, OPS, VP), [{ x0: 120, y0: 410, x1: 160, y1: 470 }]);
});
