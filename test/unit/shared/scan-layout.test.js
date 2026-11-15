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

// ---------- a real page: two columns of questions and answers, numbered notes ----------
// (the geometry of a real form: 20 px letters, lines 23 px apart inside
// a cell, 33 px and more between the rows)
test('paragraphs: a cell of several lines is one block, the next row another one', () => {
  const g = paragraphs([
    line(98, 283, 73, { text: 'Who has to report' }), line(98, 210, 96, { text: 'the accident?' }),
    line(353, 970, 73, { text: 'The owners of the company. They may also name a person who' }), line(353, 768, 96, { text: 'sends the report in their place.' }),
    line(98, 265, 129, { text: 'When must it be' }), line(98, 210, 152, { text: 'reported?' }),
    line(353, 945, 129, { text: 'Accidents at work and on the way (e.g. between home and the' }), line(353, 912, 152, { text: 'place of work) are reported when the person cannot work' }),
    line(353, 978, 175, { text: 'for more than three days afterwards, or in the case of' }), line(353, 596, 198, { text: 'a death.' }),
  ].map((t) => ({ ...t, fs: 20 })));
  assert.deepStrictEqual(g.map((x) => x.idx).sort((a, b) => a[0] - b[0]), [[0, 1], [2, 3], [4, 5], [6, 7, 8, 9]]);
});

test('paragraphs: lines of one block whose size was measured a little differently still join', () => {
  // (a line with bold words measures smaller than its neighbours)
  const g = paragraphs([{ ...line(353, 945, 129), fs: 20.1 }, { ...line(353, 912, 152), fs: 20 }, { ...line(353, 978, 175), fs: 18.5 }, { ...line(353, 596, 198), fs: 18.6 }]);
  assert.deepStrictEqual(g.map((x) => x.idx), [[0, 1, 2, 3]]);
  // but a heading clearly larger than the text below it stays apart
  const h = paragraphs([{ ...line(50, 300, 100), fs: 17 }, { ...line(50, 400, 122), fs: 12 }, { ...line(50, 390, 137), fs: 12 }]);
  assert.deepStrictEqual(h.map((x) => x.idx), [[0], [1, 2]]);
});

test('paragraphs: single-line rows one under the other end with their sentence', () => {
  // two questions, each one line, a row apart (wider than the line spacing would be)
  const g = paragraphs([line(98, 311, 515, { text: 'Who must be informed?' }), line(98, 300, 548, { text: 'How is it reported?' })].map((t) => ({ ...t, fs: 20 })));
  assert.deepStrictEqual(g.map((x) => x.idx), [[0], [1]]);
});

test('paragraphs: a bold line a row above regular text is its heading, not its first line', () => {
  const g = paragraphs([line(98, 452, 30, { text: 'I. Notes on the form', b: true, fs: 20 }), line(98, 283, 68, { text: 'Who has to report', fs: 20 }), line(98, 210, 91, { text: 'the accident?', fs: 20 })]);
  assert.deepStrictEqual(g.map((x) => x.idx), [[0], [1, 2]]);
});

test('splitColumns: a line read across two columns is cut where the other column starts', () => {
  const { splitColumns } = require('../../../src/shared/scan-layout');
  const word = (text, x0, x1, y = 0) => ({ text, conf: 90, bbox: { x0, y0: y, x1, y1: y + 20 } });
  const mk = (ws) => ({ text: ws.map((w) => w.text).join(' '), conf: 90, words: ws, bbox: { x0: ws[0].bbox.x0, y0: ws[0].bbox.y0, x1: ws[ws.length - 1].bbox.x1, y1: ws[0].bbox.y1 }, baseline: { x0: ws[0].bbox.x0, y0: ws[0].bbox.y0 + 16, x1: ws[ws.length - 1].bbox.x1, y1: ws[0].bbox.y0 + 16 } });
  const lines = [
    mk([word('Who', 98, 130, 505), word('is', 136, 155, 505), word('to', 161, 180, 505), word('know?', 186, 311, 505)]),
    mk([word('Insured', 381, 480, 505), word('persons', 486, 570, 505)]),
    // read as ONE line: the question and, 37 px further, the answer
    mk([word('How', 98, 130, 584), word('is', 136, 155, 584), word('the', 161, 190, 584), word('report', 196, 316, 584), word('By', 353, 385, 584), word('post', 391, 430, 584), word('or', 436, 475, 584), word('online,', 481, 545, 584)]),
    mk([word('to', 98, 118, 607), word('send?', 124, 213, 607)]),
    mk([word('Within', 353, 440, 640), word('about', 446, 480, 640), word('3', 486, 496, 640), word('days', 502, 560, 640)]),
  ];
  const out = splitColumns(lines);
  assert.deepStrictEqual(out.map((l) => l.text), ['Who is to know?', 'Insured persons', 'How is the report', 'By post or online,', 'to send?', 'Within about 3 days']);
  const right = out[3];
  assert.deepStrictEqual([right.bbox.x0, right.bbox.x1, right.words.length, right.baseline.x0], [353, 545, 4, 353]);
});

test('splitColumns: a number before a hanging indent is cut off; a numbered heading is not', () => {
  const { splitColumns } = require('../../../src/shared/scan-layout');
  const word = (text, x0, x1, y = 0) => ({ text, conf: 90, bbox: { x0, y0: y, x1, y1: y + 20 } });
  const mk = (ws) => ({ text: ws.map((w) => w.text).join(' '), conf: 90, words: ws, bbox: { x0: ws[0].bbox.x0, y0: ws[0].bbox.y0, x1: ws[ws.length - 1].bbox.x1, y1: ws[0].bbox.y1 }, baseline: { x0: ws[0].bbox.x0, y0: ws[0].bbox.y0 + 16, x1: ws[ws.length - 1].bbox.x1, y1: ws[0].bbox.y0 + 16 } });
  const out = splitColumns([
    mk([word('I.', 98, 113, 30), word('Notes', 149, 290, 30), word('on', 296, 325, 30), word('reporting', 331, 452, 30)]), // nothing below starts at 149
    mk([word('Who', 98, 130, 63), word('must', 136, 180, 63)]),
    mk([word('2', 98, 107, 866), word('Give', 149, 250, 866), word('the', 256, 275, 866)]),
    mk([word('number', 149, 190, 889), word('of', 196, 215, 889), word('it', 221, 300, 889)]),
    // a very wide gap needs no other line: a label left of a framed text
    mk([word('UD', 100, 139, 1000), word('Logic-unit', 200, 340, 1000)]),
  ]);
  assert.deepStrictEqual(out.map((l) => l.text), ['I. Notes on reporting', 'Who must', '2', 'Give the', 'number of it', 'UD', 'Logic-unit']);
});

test('splitColumns: a border between two words (table cell, frame) cuts the line', () => {
  const { splitColumns } = require('../../../src/shared/scan-layout');
  const word = (text, x0, x1) => ({ text, conf: 90, bbox: { x0, y0: 20, x1, y1: 40 } });
  const l = { text: 'Up Logic-unit', conf: 90, words: [word('Up', 10, 40), word('Logic-unit', 60, 200)], bbox: { x0: 10, y0: 20, x1: 200, y1: 40 }, baseline: { x0: 10, y0: 36, x1: 200, y1: 36 } };
  const W = 220, H = 60;
  const pic = (ruleX, from = 0, to = H) => { const data = new Uint8ClampedArray(W * H * 4).fill(255); if (ruleX != null) for (let y = from; y < to; y++) for (let x = ruleX; x < ruleX + 2; x++) data.set([20, 20, 20, 255], (y * W + x) * 4); return { width: W, height: H, data }; };
  assert.deepStrictEqual(splitColumns([l], pic(50)).map((x) => [x.text, !!x.cut]), [['Up', true], ['Logic-unit', true]]);
  assert.deepStrictEqual(splitColumns([l], pic(null)).map((x) => x.text), ['Up Logic-unit']); // no border
  assert.deepStrictEqual(splitColumns([l], pic(50, 24, 36)).map((x) => x.text), ['Up Logic-unit']); // a short stroke (a letter, a dash)
  // the dark side of a photo is no border
  const dusk = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(110) };
  assert.deepStrictEqual(splitColumns([l], dusk).map((x) => x.text), ['Up Logic-unit']);
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
