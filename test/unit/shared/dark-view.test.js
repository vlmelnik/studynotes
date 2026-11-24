'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { darkColor, darkenImage, inkForDark, highlightBlend } = require('../../../src/shared/dark-view');

test('full mode reverses greyscale lightness within the target range', () => {
  assert.deepStrictEqual(darkColor(255, 255, 255, 'full'), [31, 31, 31]);
  assert.deepStrictEqual(darkColor(0, 0, 0, 'full'), [224, 224, 224]);
  assert.deepStrictEqual(darkColor(128, 128, 128, 'full'), [127, 127, 127]);
});

test('full mode brightens green and preserves its hue', () => {
  const [r, g, b] = darkColor(132, 184, 25, 'full');
  assert.deepStrictEqual([r, g, b], [174, 229, 61]);
  // Green is the largest channel before and after, so both hues are in the same HSL sector.
  const originalHue = 60 * (2 + (25 - 132) / (184 - 25));
  const mappedHue = 60 * (2 + (b - r) / (g - b));
  assert.ok(Math.abs(mappedHue - originalHue) < 10);
});

test('background mode maps only light, low-saturation colours', () => {
  assert.deepStrictEqual(darkColor(255, 255, 255, 'background'), [30, 30, 30]);
  assert.deepStrictEqual(darkColor(244, 243, 242, 'background'), [30, 30, 30]);
  assert.deepStrictEqual(darkColor(230, 229, 229, 'background'), [230, 229, 229]);
  assert.deepStrictEqual(darkColor(238, 235, 232, 'background'), [238, 235, 232]);
  assert.deepStrictEqual(darkColor(132, 184, 25, 'background'), [132, 184, 25]);
});

test('darkenImage mutates RGB in place while preserving the alpha and keep rectangle', () => {
  const data = new Uint8ClampedArray([
    255, 255, 255, 255, 132, 184, 25, 123, 0, 0, 0, 9,
    128, 128, 128, 0, 255, 255, 255, 42, 0, 0, 0, 255,
  ]);
  const im = { width: 3, height: 2, data };
  assert.strictEqual(darkenImage(im, { mode: 'full', keep: [{ x: 1, y: 0, w: 1, h: 1 }] }), im);
  assert.strictEqual(im.data, data);
  assert.deepStrictEqual([...im.data], [
    31, 31, 31, 255, 132, 184, 25, 123, 224, 224, 224, 9,
    127, 127, 127, 0, 31, 31, 31, 42, 224, 224, 224, 255,
  ]);
});

test('background mode respects overlapping and clipped keep rectangles across rows', () => {
  const im = { width: 4, height: 2, data: new Uint8ClampedArray(32).fill(255) };
  darkenImage(im, { mode: 'background', keep: [
    { x0: -1, y0: 0, x1: 2, y1: 1 },
    { x: 1, y: 0, w: 2, h: 2 },
    { x: 3, y: 1, w: 0, h: 1 },
  ] });
  assert.deepStrictEqual([...im.data], [
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 30, 30, 30, 255,
    30, 30, 30, 255, 255, 255, 255, 255, 255, 255, 255, 255, 30, 30, 30, 255,
  ]);
});

test('dark ink gets the full lightness mapping while light ink retains its color', () => {
  assert.strictEqual(inkForDark('#000000'), '#e0e0e0');
  assert.strictEqual(inkForDark('#000080'), '#6161ff');
  assert.strictEqual(inkForDark('#D4B8FF'), '#d4b8ff');
  assert.strictEqual(inkForDark('#FF0000'), '#ff0000'); // exactly HSL 0.5
  assert.strictEqual(inkForDark('#FFF'), '#ffffff');
  assert.strictEqual(inkForDark('currentColor'), 'currentColor');
});

test('highlighter screen blend brightens dark pages, but light pages keep multiply', () => {
  assert.strictEqual(highlightBlend(true), 'screen');
  assert.strictEqual(highlightBlend(false), 'multiply');
});
