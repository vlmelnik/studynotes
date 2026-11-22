# Block detection can merge ragged columns

Verified on revision `f347d1b4`. The 600 × 170 scan below has two columns
with three lines each. The gaps between lines at the same height are 39, 83,
and 52 pixels. The detector returns one block `[40, 40, 513, 90]`. The
expected blocks are `[40, 40, 251, 90]` and `[267, 40, 513, 90]` in reading
order. Coordinates use exclusive right and bottom bounds.

## Reproduction

Run this snippet with Node from the repository root.

```js
const { findBlocks } = require('./src/shared/scan-blocks');
const width = 600;
const height = 170;
const data = new Uint8ClampedArray(width * height * 4).fill(255);
const lines = [
  [40, 40, 4], [40, 60, 3], [56, 80, 4],
  [274, 40, 4], [267, 60, 5], [303, 80, 3],
];
for (const [x, y, words] of lines) {
  for (let word = 0; word < words; word++) {
    for (let letter = 0; letter < 5; letter++) {
      const left = x + 51 * word + 9 * letter;
      for (let row = y; row < y + 10; row++) {
        for (let col = left; col < left + 6; col++) {
          const offset = 4 * (row * width + col);
          data.fill(20, offset, offset + 3);
        }
      }
    }
  }
}
console.log(findBlocks({ width, height, data }).map(
  ({ x0, y0, x1, y1 }) => [x0, y0, x1, y1],
));
```

The fixture also reproduces the merge in the expanded binary mask before
later block merging. Ten-pixel glyphs expand by 10 pixels horizontally and
5 vertically. At the bottom edge of the middle-right line, its expanded
mask meets the top edge of the bottom-left line on adjacent rows. Moving
the middle-right line from `x = 267` to `x = 270` still merges the columns.
At `x = 271` and `x = 278`, both the mask and the detector produce two
separate components.

When changing the mask expansion, check that the narrow gutter stays open
and that words, bullets, and lines within a paragraph still join correctly.
Enable the narrow-gutter assertion in the block-coverage contribution and
run it alongside the wider-gutter and existing table and paragraph cases.
[Regression fixture](https://github.com/vlmelnik/studynotes/pull/27)
