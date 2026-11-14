'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { graphicMarks, besideMark, underlinedWords, paragraphs, combineBoxes } = require('../../../src/shared/scan-layout');

const line = (x0, x1, cy, more = {}) => ({ x0, x1, cy, fs: 12, ff: 'inter', c: '#222222', ...more });

test('paragraphs: evenly spaced lines aligned left are one group', () => {
  const g = paragraphs([line(50, 400, 100), line(50, 395, 116), line(50, 250, 132), line(50, 400, 170)]);
  assert.deepStrictEqual(g.map((x) => x.idx), [[0, 1, 2], [3]]);
  assert.strictEqual(g[0].al, 'left');
  assert.strictEqual(g[0].pitch, 16);
});

test('paragraphs: a centred title of two lines; different size / font / colour stay apart', () => {
  const g = paragraphs([line(200, 400, 50), line(230, 370, 66), line(50, 400, 82, { fs: 9 }), line(50, 400, 98, { ff: 'serif' }), line(50, 400, 114, { c: '#cc0000' })]);
  assert.deepStrictEqual(g[0].idx, [0, 1]);
  assert.strictEqual(g[0].al, 'center');
  assert.strictEqual(g.length, 4);
});

test('paragraphs: two columns are two paragraphs; tilted or handwritten lines stay single', () => {
  const g = paragraphs([line(50, 280, 100), line(320, 550, 100), line(50, 280, 116), line(320, 550, 116), line(50, 280, 132, { warp: true })]);
  assert.deepStrictEqual(g.map((x) => x.idx), [[0, 2], [1, 3], [4]]);
});

test('paragraphs: the labels of a form (widely spaced, different lengths) stay single boxes', () => {
  // "Name:", "Street and number:", "City:", "Date of birth:" one under the other, 1.8 × the font size apart
  const g = paragraphs([line(50, 90, 100, { text: 'Name:' }), line(50, 170, 122, { text: 'Street and number:' }), line(50, 82, 144, { text: 'City:' }), line(50, 140, 166, { text: 'Date of birth:' })]);
  assert.deepStrictEqual(g.map((x) => x.idx), [[0], [1], [2], [3]]);
});

test('paragraphs: a paragraph with 1.5 line spacing is still one box (its lines are full)', () => {
  const g = paragraphs([line(50, 400, 100), line(50, 392, 118), line(50, 398, 136), line(50, 210, 154)]);
  assert.deepStrictEqual(g.map((x) => x.idx), [[0, 1, 2, 3]]);
});

test('paragraphs: a single-spaced list or address stays one box whatever the lengths', () => {
  const g = paragraphs([line(50, 80, 100, { text: 'Milk' }), line(50, 92, 115, { text: 'Bread' }), line(50, 100, 130, { text: 'Butter' }), line(50, 78, 145, { text: 'Eggs' })]);
  assert.deepStrictEqual(g.map((x) => x.idx), [[0, 1, 2, 3]]);
});

test('paragraphs: the cells of a table are not joined down a column', () => {
  // three rows of "Item | Qty | Price": every line has a neighbour in its row
  const row = (cy, a, b, c) => [line(50, 50 + a.length * 6, cy, { text: a }), line(200, 200 + b.length * 6, cy, { text: b }), line(300, 300 + c.length * 6, cy, { text: c })];
  const items = [...row(100, 'Pen', '2', '1.50'), ...row(115, 'Notebook', '10', '12.00'), ...row(130, 'Ruler', '1', '0.80')];
  const g = paragraphs(items);
  assert.ok(g.every((x) => x.idx.length === 1), JSON.stringify(g.map((x) => x.idx)));
});

test('paragraphs: a short line ending with a colon closes its group when widely spaced', () => {
  const g = paragraphs([line(50, 400, 100, { text: 'Please note the following points before you sign:' }), line(50, 150, 122, { text: 'Remarks:' }), line(50, 148, 144, { text: 'see page 2' })]);
  assert.deepStrictEqual(g.map((x) => x.idx), [[0], [1], [2]]);
});

// a small ink mask: words with an underline under the 2nd one
function mask(w, h, fill) {
  const ink = new Uint8Array(w * h);
  fill((x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * w + x] = 1; });
  return { w, h, ink, box: { x0: 0, y0: 0 } };
}

test('underlinedWords: a line under a word, not descenders', () => {
  const li = mask(200, 40, (r) => {
    r(0, 5, 40, 25); r(60, 5, 120, 25); r(140, 5, 190, 25);
    r(58, 28, 122, 30); // underline under word 2
    r(150, 25, 155, 33); r(175, 25, 180, 33); // descenders of word 3
  });
  const words = [{ bbox: { x0: 0, x1: 40 } }, { bbox: { x0: 60, x1: 120 } }, { bbox: { x0: 140, x1: 190 } }];
  assert.deepStrictEqual(underlinedWords(li, words, 25, 20), [false, true, false]);
});

test('graphicMarks / besideMark: a solid sign next to a name; thin lines and text are no marks', () => {
  const W = 300, H = 120, data = new Uint8ClampedArray(W * H * 4).fill(255);
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(c, (y * W + x) * 4); };
  rect(10, 20, 50, 100, [132, 184, 23, 255]); // green sign, 80 px tall
  rect(60, 40, 140, 52, [30, 30, 30, 255]); // "text" next to it, 12 px tall
  rect(10, 110, 290, 112, [30, 30, 30, 255]); // a thin rule
  rect(150, 20, 156, 60, [47, 124, 246, 255]); // a blue bar beside a heading
  const marks = graphicMarks({ width: W, height: H, data }, 12);
  assert.strictEqual(marks.length, 1);
  assert.ok(besideMark({ x0: 60, y0: 40, x1: 140, y1: 52 }, marks, 12));
  assert.ok(!besideMark({ x0: 200, y0: 40, x1: 280, y1: 52 }, marks, 12));
});

test('combineBoxes: side by side → one line, one under the other → lines; style per part', () => {
  const t = (x, y, text, more = {}) => ({ id: text, x, y, w: 60, fs: 10, ff: 'inter', c: '#222222', text, aw: true, ...more });
  const out = combineBoxes([t(100, 20, 'world'), t(20, 20, 'Hello', { b: true }), t(20, 34, 'second line')]);
  assert.strictEqual(out.text, 'Hello world\nsecond line');
  assert.strictEqual(out.html, '<b>Hello</b> world\nsecond line');
  assert.strictEqual(out.lh, 1.4);
  assert.strictEqual(out.x, 20);
  assert.strictEqual(out.w, 140);
  assert.ok(!out.b);
});

test('underlinedWords: a ruled line running on past the text is no underline', () => {
  const li = mask(300, 40, (r) => { r(60, 5, 120, 25); r(140, 5, 190, 25); r(0, 28, 300, 30); });
  const words = [{ bbox: { x0: 60, x1: 120 } }, { bbox: { x0: 140, x1: 190 } }];
  assert.deepStrictEqual(underlinedWords(li, words, 25, 20, { x0: 60, x1: 190 }), [false, false]);
});

test('besideMark: long lines beside a picture and lines below it stay', () => {
  const marks = [{ x0: 10, y0: 20, x1: 50, y1: 100 }];
  assert.ok(!besideMark({ x0: 60, y0: 40, x1: 400, y1: 52 }, marks, 12, 9));
  assert.ok(!besideMark({ x0: 10, y0: 104, x1: 120, y1: 116 }, marks, 12, 2));
});

test('combineBoxes: a box of several lines keeps its spacing when another one is added below', () => {
  const a = { id: 'a', x: 20, y: 0, w: 100, fs: 10, ff: 'inter', c: '#222222', text: 'one\ntwo\nthree', lh: 1.6 };
  const b = { id: 'b', x: 20, y: 48, w: 100, fs: 10, ff: 'inter', c: '#222222', text: 'four', lh: 1.6 };
  const out = combineBoxes([a, b]);
  assert.strictEqual(out.text, 'one\ntwo\nthree\nfour');
  assert.strictEqual(out.lh, 1.6);
  assert.strictEqual(out.y, 0);
});

test('underlinedWords: a ruled line cut off by the selection on both sides is no underline', () => {
  // the lasso ends right at the text: nothing beyond it to look at
  const li = mask(130, 40, (r) => { r(5, 5, 60, 25); r(70, 5, 125, 25); r(0, 28, 130, 30); });
  const words = [{ bbox: { x0: 5, x1: 60 } }, { bbox: { x0: 70, x1: 125 } }];
  assert.deepStrictEqual(underlinedWords(li, words, 25, 20, { x0: 5, x1: 125 }), [false, false]);
  // with room on one side and no ink there, a real underline is still found
  const li2 = mask(200, 40, (r) => { r(5, 5, 60, 25); r(70, 5, 125, 25); r(0, 28, 127, 30); });
  assert.deepStrictEqual(underlinedWords(li2, words, 25, 20, { x0: 5, x1: 125 }), [true, true]);
});
