'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findBlocks } = require('../../../src/shared/scan-blocks');

// a page drawn from "letters": dark boxes 6 wide and 10 high, 3 apart; words
// of 5 letters, 9 apart; lines 20 apart
function page(W, H, draw) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const rect = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set([20, 20, 20, 255], (y * W + x) * 4); };
  const line = (x, y, words, lh = 10, lw = 6) => { for (let w = 0; w < words; w++) for (let l = 0; l < 5; l++) rect(x + w * (5 * (lw + 3) + 6) + l * (lw + 3), y, lw, lh); };
  const para = (x, y, lines, words, pitch = 20) => { for (let k = 0; k < lines; k++) line(x, y + k * pitch, words); };
  draw({ rect, line, para });
  return { width: W, height: H, data };
}
const boxes = (b) => b.map((q) => [q.x0, q.y0, q.x1, q.y1]);

test('findBlocks: paragraphs with an empty line between them are two blocks', () => {
  const b = findBlocks(page(600, 300, ({ para }) => { para(40, 40, 3, 8); para(40, 130, 2, 8); }));
  assert.strictEqual(b.length, 2);
  assert.deepStrictEqual(boxes(b), [[40, 40, 439, 90], [40, 130, 439, 160]]);
  assert.strictEqual(b[0].h, 10);
});

test('findBlocks: two columns side by side are two blocks, each with all its lines', () => {
  const b = findBlocks(page(700, 200, ({ para }) => { para(40, 40, 2, 3); para(260, 40, 4, 6); }));
  assert.deepStrictEqual(boxes(b), [[40, 40, 184, 70], [260, 40, 557, 110]]);
});

test('findBlocks: the cells of a table are blocks of their own, with different zones; the borders are no text', () => {
  const b = findBlocks(page(600, 260, ({ rect, para }) => {
    // a frame with a line across and one down: four cells, text close to the borders
    rect(20, 20, 560, 2); rect(20, 238, 560, 2); rect(20, 20, 2, 220); rect(578, 20, 2, 220); rect(20, 128, 560, 2); rect(298, 20, 2, 220);
    para(30, 30, 4, 4); para(310, 60, 2, 4); para(30, 140, 4, 4); para(310, 140, 4, 4);
  }));
  assert.strictEqual(b.length, 4);
  assert.strictEqual(new Set(b.map((q) => q.zone)).size, 4);
  assert.deepStrictEqual(boxes(b)[0], [30, 30, 225, 100]);
});

test('findBlocks: an underline across the page divides no zone; a title in large letters is one block', () => {
  const b = findBlocks(page(700, 300, ({ rect, para }) => {
    // title: letters 3 × as large, words far apart for the smear of the small print
    for (let w = 0; w < 3; w++) for (let l = 0; l < 4; l++) rect(60 + w * 130 + l * 26, 30, 18, 30);
    rect(40, 80, 620, 2);
    para(40, 110, 3, 9); para(40, 200, 3, 1);
  }));
  assert.strictEqual(b[0].x1 - b[0].x0 > 300, true, 'the three words of the title are one block');
  assert.strictEqual(new Set(b.map((q) => q.zone)).size, 1);
});

test('findBlocks: one line of large letters in a low strip (a selected part of a page) is one block', () => {
  const b = findBlocks(page(900, 90, ({ rect }) => { for (let w = 0; w < 3; w++) for (let l = 0; l < 6; l++) rect(30 + w * 280 + l * 40, 20, 28, 50); }));
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].h, 50);
});

test('findBlocks: an empty or a black picture gives no blocks (the page is read as a whole)', () => {
  assert.strictEqual(findBlocks(page(200, 100, () => {})), null);
  assert.strictEqual(findBlocks(page(200, 100, ({ rect }) => rect(0, 0, 200, 100))), null);
});
