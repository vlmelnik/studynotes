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
  const paint = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject']
    .map((k) => OPS[k]).filter((v) => v !== undefined));
  let ctm = viewportTransform.slice(0, 6);
  const stack = [];
  const out = [];
  // Each placement paints into a unit square under its own transform.
  const add = ([a, b, c, d, x, y]) => {
    const r = {
      x0: Math.floor(x + Math.min(0, a) + Math.min(0, c)),
      y0: Math.floor(y + Math.min(0, b) + Math.min(0, d)),
      x1: Math.ceil(x + Math.max(0, a) + Math.max(0, c)),
      y1: Math.ceil(y + Math.max(0, b) + Math.max(0, d)),
    };
    if (r.x1 - r.x0 >= minSide && r.y1 - r.y0 >= minSide) out.push(r);
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform && args) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args?.[0]?.length === 6) ctm = mul(ctm, args[0]); // PDF.js matrices may be typed arrays
    }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (paint.has(fn)) add(ctm);
    else if (fn === OPS.paintImageXObjectRepeat || fn === OPS.paintImageMaskXObjectRepeat) {
      const mask = fn === OPS.paintImageMaskXObjectRepeat;
      const [sx, b, c, sy, positions] = mask ? args.slice(1) : [args[1], 0, 0, args[2], args[3]];
      for (let p = 0; p < positions.length; p += 2) add(mul(ctm, [sx, b, c, sy, positions[p], positions[p + 1]]));
    } else if (fn === OPS.paintInlineImageXObjectGroup || fn === OPS.paintImageMaskXObjectGroup) {
      const placements = args[fn === OPS.paintInlineImageXObjectGroup ? 1 : 0];
      for (const { transform } of placements) add(mul(ctm, transform));
    }
  }
  return out;
}

module.exports = { imageRects };
