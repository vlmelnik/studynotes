'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { narrowLangs, fixUmlauts, mergeLines, skewOf, invertHex, paperColor, isDark, darkShare, invert, dilateMask } = require('../../../src/shared/scan-text');

const w = (text, conf = 90) => ({ text, conf });
const img = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); data.set([r, g, b, 255], (y * w + x) * 4); }
  return { width: w, height: h, data };
};

test('narrowLangs: a German page with stray Cyrillic look-alikes is read again without Russian', () => {
  const lines = [{ words: [w('Der'), w('Mieter'), w('zahlt'), w('die'), w('Kaution'), w('Рог', 40), w('pünktlich')] }];
  assert.deepStrictEqual(narrowLangs(lines), ['deu', 'eng']);
});

test('narrowLangs: a real quote in the other script (read with confidence) keeps all languages', () => {
  const lines = [{ words: [w('Der'), w('Mieter'), w('zahlt'), w('die'), w('Kaution'), w('пожалуйста', 92), w('pünktlich')] }];
  assert.strictEqual(narrowLangs(lines), null);
});

test('narrowLangs: too little text to tell → keep all', () => {
  assert.strictEqual(narrowLangs([{ words: [w('Hi'), w('du')] }]), null);
});

test('fixUmlauts: a word read without its dots takes the spelling used elsewhere', () => {
  const out = fixUmlauts([{ text: 'Übung macht den Meister', words: [w('Übung')] }, { text: 'Die Ubung ist leicht', words: [w('Die'), w('Ubung')] }]);
  assert.strictEqual(out[1].text, 'Die Übung ist leicht');
  assert.strictEqual(out[1].words[1].text, 'Übung');
  // nothing to learn from: unchanged (same object)
  const plain = [{ text: 'Ubung', words: [] }];
  assert.strictEqual(fixUmlauts(plain), plain);
});

test('mergeLines: a second reading fills gaps and replaces clearly better lines only', () => {
  const a = [{ text: 'first', conf: 80, bbox: { x0: 0, y0: 0, x1: 100, y1: 10 } }, { text: 'bad', conf: 40, bbox: { x0: 0, y0: 20, x1: 100, y1: 30 } }];
  const b = [
    { text: 'better', conf: 90, bbox: { x0: 0, y0: 20, x1: 100, y1: 30 } }, // replaces "bad"
    { text: 'same', conf: 82, bbox: { x0: 0, y0: 0, x1: 100, y1: 10 } }, // not clearly better than "first"
    { text: 'new', conf: 70, bbox: { x0: 0, y0: 40, x1: 100, y1: 50 } }, // fills a gap
    { text: 'noise', conf: 30, bbox: { x0: 0, y0: 60, x1: 100, y1: 70 } }, // too unsure
  ];
  assert.deepStrictEqual(mergeLines(a, b).map((l) => l.text), ['first', 'better', 'new']);
});

test('skewOf: median tilt of the long baselines in degrees, short lines ignored', () => {
  const line = (deg, len = 200) => ({ baseline: { x0: 0, y0: 0, x1: len, y1: Math.tan((deg * Math.PI) / 180) * len } });
  assert.ok(Math.abs(skewOf([line(2), line(2.2), line(1.8), line(15, 50)]) - 2) < 0.01);
  assert.strictEqual(skewOf([]), 0);
});

test('colours: paper, dark pages, inverted colours', () => {
  const paper = img(40, 40, (x, y) => (y % 10 === 5 ? [20, 20, 20] : [250, 245, 235]));
  assert.deepStrictEqual(paperColor(paper), [250, 245, 235]);
  assert.strictEqual(isDark(paper), false);
  assert.ok(darkShare(paper) > 0.05 && darkShare(paper) < 0.2);
  const dark = img(40, 40, () => [30, 30, 30]);
  assert.strictEqual(isDark(dark), true);
  invert(dark);
  assert.deepStrictEqual([...dark.data.slice(0, 4)], [225, 225, 225, 255]);
  assert.strictEqual(invertHex('#102030'), '#efdfcf');
});

test('dilateMask grows a mask by the radius', () => {
  const m = new Uint8Array(25); m[12] = 1; // centre of 5×5
  const g = dilateMask(m, 5, 5, 1);
  assert.strictEqual(g.reduce((s, v) => s + (v ? 1 : 0), 0), 9);
  assert.strictEqual(g[0], 0);
});

test('sampleLines: all lines of a short text; a spread sample plus the headings of a long one', () => {
  const { sampleLines } = require('../../../src/shared/scan-text');
  const line = (h, len) => ({ text: 'x'.repeat(len), bbox: { y0: 0, y1: h } });
  assert.deepStrictEqual(sampleLines([line(30, 5), line(30, 9)]), [0, 1]);
  // 40 lines of text, a heading first, one long line in every stretch of four
  const lines = Array.from({ length: 40 }, (_, k) => line(k === 0 ? 60 : 30, k % 4 === 2 ? 50 : 20));
  const got = sampleLines(lines);
  assert.ok(got.includes(0), 'the heading');
  assert.strictEqual(got.length, 11);
  assert.deepStrictEqual(got.slice(1), [2, 6, 10, 14, 18, 22, 26, 30, 34, 38]);
});

test('boldLines: a text that is bold throughout is bold (nothing thinner to compare with)', () => {
  const { boldLines } = require('../../../src/shared/scan-text');
  const sizes = [36, 36, 36, 36];
  // sharp picture: the strokes stand at the bold letters (p ≈ 1), not the regular ones (p ≈ 0.1)
  assert.deepStrictEqual(boldLines([1.6, 1.58, 1.62, 1.6], sizes, { ps: [0.92, 0.9, 1.05, 0.95], ds: [0.03, 0.02, 0.04, 0.03], soft: 0.007 }), [true, true, true, true]);
  assert.deepStrictEqual(boldLines([1.05, 1.08, 1.03, 1.06], sizes, { ps: [0.1, 0.2, 0.08, 0.15], ds: [-0.4, -0.3, -0.4, -0.35], soft: 0.007 }), [false, false, false, false]);
  // sharp, mixed: every line by its own strokes
  assert.deepStrictEqual(boldLines([1.6, 1.05, 1.06, 1.04], sizes, { ps: [0.95, 0.1, 0.12, 0.08], ds: [0.03, -0.4, -0.4, -0.4], soft: 0.007 }), [true, false, false, false]);
});

test('boldLines: on a blurred picture the fit of the bold letters decides, not the smeared strokes', () => {
  const { boldLines } = require('../../../src/shared/scan-text');
  const sizes = [33, 33, 33, 33];
  // regular small print, blurred: strokes look thick (p > 1) but the bold letters fit worse
  assert.deepStrictEqual(boldLines([1.27, 1.3, 1.25, 1.28], sizes, { ps: [1.2, 1.25, 1.16, 1.21], ds: [-0.19, -0.2, -0.15, -0.18], soft: 0.04 }), [false, false, false, false]);
  // bold, photographed: strokes look thin (p ≈ 0.05) but the bold letters fit better
  assert.deepStrictEqual(boldLines([1.01, 1.02, 1.0, 1.01], sizes, { ps: [0.05, 0.08, -0.01, 0.05], ds: [0.09, 0.1, 0.08, 0.094], soft: 0.039 }), [true, true, true, true]);
  // a monospaced typeface: its bold letters always fit a little better – no decision from that
  assert.deepStrictEqual(boldLines([1.02, 1.01, 1.03, 1.02], sizes, { ps: [0.17, 0.12, 0.25, 0.17], ds: [0.04, 0.05, 0.04, 0.043], soft: 0.035, mono: true }), [false, false, false, false]);
  // a bold page with one regular line: clearly thinner than the rest
  assert.deepStrictEqual(boldLines([1.2, 1.22, 0.85, 1.19], sizes, { ps: [0.6, 0.62, 0.0, 0.6], ds: [0.04, 0.05, -0.2, 0.04], soft: 0.035 }), [true, true, false, true]);
});

test('boldLines: without the extra measures it is the old comparison with the typical line', () => {
  const { boldLines } = require('../../../src/shared/scan-text');
  assert.deepStrictEqual(boldLines([1.0, 1.02, 1.4, 0.98], [30, 30, 30, 30]), [false, false, true, false]);
  assert.deepStrictEqual(boldLines([1.5], [30]), [true]);
});

test('mainFamily: a clear winner is taken; among near-equal look-alikes the everyday typeface of the kind', () => {
  const { mainFamily } = require('../../../src/shared/scan-text');
  const line = (o) => Object.entries(o).map(([ff, score]) => ({ ff, score, prior: 0, b: false, i: false }));
  // Source Sans clearly ahead of the other sans typefaces: recognised
  assert.strictEqual(mainFamily([line({ sourcesans: 0.8, ptsans: 0.7, sans: 0.65, serif: 0.4 }), line({ sourcesans: 0.82, ptsans: 0.71, sans: 0.66, serif: 0.4 })]), 'sourcesans');
  // an unknown sans: PT Sans, Noto Sans and Roboto within a hair – whichever leads, the answer is the same
  const a = mainFamily([line({ ptsans: 0.70, notosans: 0.695, roboto: 0.69, sans: 0.6, carlito: 0.55, serif: 0.4 })]);
  const b = mainFamily([line({ ptsans: 0.69, notosans: 0.70, roboto: 0.695, sans: 0.6, carlito: 0.55, serif: 0.4 })]);
  assert.deepStrictEqual([a, b], ['sans', 'sans']);
  // the same for serifs, and an everyday typeface that wins is kept as it is
  assert.strictEqual(mainFamily([line({ ptserif: 0.7, notoserif: 0.69, serif: 0.62, sans: 0.3 })]), 'serif');
  assert.strictEqual(mainFamily([line({ carlito: 0.7, lato: 0.695, sans: 0.6 })]), 'carlito');
});

test('boldLines: with an unrecognised typeface only the comparison between lines counts', () => {
  const { boldLines } = require('../../../src/shared/scan-text');
  // heavier strokes than the stand-in typeface, on every line: not "bold"
  assert.deepStrictEqual(boldLines([1.3, 1.32, 1.28, 1.3], [33, 33, 33, 33], { ps: [0.8, 0.85, 0.7, 0.8], ds: [0.05, 0.06, 0.04, 0.05], soft: 0.007, known: false }), [false, false, false, false]);
});

test('handwrittenPage: one odd line among two does not make printed text handwriting', () => {
  const { handwrittenPage } = require('../../../src/shared/scan-text');
  assert.strictEqual(handwrittenPage([0.37, 0.14], [94, 73]), false); // a label with an index + a clean line
  assert.strictEqual(handwrittenPage([0, 0.49], [95, 78]), false); // a date + a line full of underscores
  assert.strictEqual(handwrittenPage([0.45, 0.5], [70, 65]), true); // two handwritten lines
  assert.strictEqual(handwrittenPage([0.4, 0.35, 0.5, 0.3], [70, 75, 60, 80]), true); // a handwritten page
  assert.strictEqual(handwrittenPage([0.05, 0.4, 0.1, 0.08], [95, 70, 96, 94]), false); // print with one odd line
  assert.strictEqual(handwrittenPage([0.5], [60]), false); // (a single line is judged on its own elsewhere)
});

test('boldByWords: a line with a few bold words is regular with those words in bold', () => {
  const { boldByWords } = require('../../../src/shared/scan-text');
  const sizes = [42, 42, 42, 42];
  const got = boldByWords([
    [7.2, 7.0, 7.4], // a heading, bold throughout
    [7.1, 4.6, 4.5, 4.7], // "**Who** has to report"
    [4.6, 4.5, 0, 4.7, 4.4], // regular (one word too short to measure)
    [7.0, 0, 7.2, 0, 0, 7.3, 4.5, 4.6], // six words in bold, two regular ones after them
  ], sizes, [true, true, true, true]);
  assert.deepStrictEqual(got.lines, [true, false, false, false]);
  assert.deepStrictEqual(got.words, [null, [true, false, false, false], null, [true, true, true, true, true, true, false, false]]);
});

test('boldByWords: words that all weigh the same, or too few of them, leave the line measure as it is', () => {
  const { boldByWords } = require('../../../src/shared/scan-text');
  const same = boldByWords([[7, 7.2, 6.9], [7.1, 7, 7.3], [7, 7.1]], [42, 42, 42], [true, true, true]);
  assert.deepStrictEqual(same.lines, [true, true, true]);
  const few = boldByWords([[7.2], [4.5, 4.6]], [42, 42], [true, false]);
  assert.deepStrictEqual([few.lines, few.words], [[true, false], [null, null]]);
  // a heading in larger letters: thicker strokes for its size only
  const head = boldByWords([[8.4, 8.6], [4.5, 4.6, 4.4], [4.6, 4.5, 4.7]], [80, 42, 42], [false, false, false]);
  assert.deepStrictEqual(head.lines, [false, false, false]);
});

test('strayScript: a few words in Cyrillic letters on a German page are read again in German', () => {
  const { strayScript } = require('../../../src/shared/scan-text');
  const t = (text) => ({ text });
  const page = [t('В Hinweise гиг Anmeldung'), t('Der Mieter zahlt die Kaution für die Wohnung'), t('in drei gleichen Raten bis zum Monatsende.'), t('(2. В. bis zum Monatsende, pünktlich)')];
  assert.deepStrictEqual(strayScript(page), { langs: ['deu', 'eng'], idx: [0, 3] });
  assert.strictEqual(strayScript([t('Der Mieter zahlt die Kaution für die Wohnung'), t('Спасибо большое за помощь')]), null); // a mixed page
  assert.strictEqual(strayScript([t('Der Mieter zahlt die Kaution für die Wohnung pünktlich')]), null); // nothing stray
});

test('romanStart: a Roman numeral read as small L\'s before a heading', () => {
  const { romanStart } = require('../../../src/shared/scan-text');
  assert.strictEqual(romanStart('l. Hinweise zur Anmeldung'), 'I. Hinweise zur Anmeldung');
  assert.strictEqual(romanStart('Il. Hinweise zu einzelnen Fragen'), 'II. Hinweise zu einzelnen Fragen');
  assert.strictEqual(romanStart('I. Allgemeines'), 'I. Allgemeines');
  assert.strictEqual(romanStart('l. c. on page 3'), 'l. c. on page 3'); // (no heading follows)
});

test('evenSizes: lines of one print measured a little differently get one size', () => {
  const { evenSizes } = require('../../../src/shared/scan-text');
  assert.deepStrictEqual(evenSizes([10.05, 10.46, 10.12, 11.89, 10.06, null, 17, 10.69]), [10.12, 10.12, 10.12, 11.89, 10.12, null, 17, 10.12]);
  assert.deepStrictEqual(evenSizes([12, 12.4]), [12, 12.4]); // two lines: may be two sizes
});

test('boldLines: two lines of a label, both nearly at the mark, are judged alike', () => {
  const { boldLines } = require('../../../src/shared/scan-text');
  assert.deepStrictEqual(boldLines([1.43, 1.48], [106, 110], { ps: [0.98, 1.03], ds: [0.069, 0.039], soft: 0.02, known: false }), [true, true]);
  assert.deepStrictEqual(boldLines([1.3, 1.33], [154, 153], { ps: [0.84, 0.87], ds: [-0.015, 0.134], soft: 0.02, known: false }), [true, true]);
  assert.deepStrictEqual(boldLines([1.35, 1.2], [106, 110], { ps: [0.5, 0.4], ds: [-0.1, -0.2], soft: 0.02, known: false }), [false, false]);
});

test('chooseFonts: a line changes the kind of typeface only with most of its block; alone it needs a clear lead', () => {
  const { chooseFonts } = require('../../../src/shared/scan-text');
  const sc = (serif, sans) => [{ ff: 'serif', score: serif, prior: 0, b: false, i: false }, { ff: 'sans', score: sans, prior: 0, b: false, i: false }];
  const all = [sc(0.8, 0.5), sc(0.8, 0.5), sc(0.8, 0.5), sc(0.6, 0.7), sc(0.8, 0.5), sc(0.5, 0.62), sc(0.5, 0.7)];
  const bolds = all.map(() => false);
  // without blocks: as before, every line by its own lead (> 0.08)
  assert.deepStrictEqual(chooseFonts(all, bolds).map((f) => f.ff), ['serif', 'serif', 'serif', 'sans', 'serif', 'sans', 'sans']);
  // line 3 stands in a paragraph of serif lines: it stays serif (a justified line fits badly);
  // line 5, alone in its block, is only a little ahead: serif; line 6, alone and far ahead: sans
  assert.deepStrictEqual(chooseFonts(all, bolds, [0, 0, 0, 0, 0, 1, 2]).map((f) => f.ff), ['serif', 'serif', 'serif', 'serif', 'serif', 'serif', 'sans']);
});

test('fixCase: small Cyrillic letters read as capitals take the case of the same word elsewhere, when no higher', () => {
  const { fixCase } = require('../../../src/shared/scan-text');
  const w = (text, h) => ({ text, bbox: { x0: 0, y0: 0, x1: 50, y1: h } });
  const lines = [{ text: 'ч 30 мин. Перерыв', words: [w('ч', 20), w('30', 28), w('мин.', 20), w('Перерыв', 28)] }, { text: 'МИН.', words: [w('МИН.', 21)] }, { text: 'МИН. ОБЪЁМ', words: [w('МИН.', 29), w('ОБЪЁМ', 29)] }];
  const got = fixCase(lines);
  assert.deepStrictEqual(got.map((l) => l.text), ['ч 30 мин. Перерыв', 'мин.', 'МИН. ОБЪЁМ']); // real capitals stand higher: kept
  assert.strictEqual(got[1].words[0].text, 'мин.');
  assert.strictEqual(got[0], lines[0]);
});
