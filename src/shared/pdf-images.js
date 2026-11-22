'use strict';
// Where a PDF page draws pictures: the rectangles of its image operators, in
// the pixels of a rendered canvas. A view effect (dark pages, docs/EXTENSIONS.md)
// leaves photos and figures alone with them. Pure: takes PDF.js's operator
// list (fnArray / argsArray), its OPS table and the viewport transform.

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * imageRects(fnArray, argsArray, OPS, viewportTransform, { minSide = 4 })
 * -> [{ x0, y0, x1, y1 }] in canvas pixels (rounded outwards), images smaller
 * than minSide pixels on a side are left out (bullets, rules drawn as images).
 */
function imageRects(fnArray, argsArray, OPS, viewportTransform, { minSide = 4 } = {}) {
  const paint = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup']
    .map((k) => OPS[k]).filter((v) => v !== undefined));
  let ctm = viewportTransform.slice(0, 6);
  const stack = [];
  const out = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform && args) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args && Array.isArray(args[0])) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (paint.has(fn)) {
      // an image fills the unit square of the current matrix
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const r = { x0: Math.floor(Math.min(...xs)), y0: Math.floor(Math.min(...ys)), x1: Math.ceil(Math.max(...xs)), y1: Math.ceil(Math.max(...ys)) };
      if (r.x1 - r.x0 >= minSide && r.y1 - r.y0 >= minSide) out.push(r);
    }
  }
  return out;
}

module.exports = { imageRects };
