'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { clipPlan } = require('../../../src/shared/clip-plan');

const picture = { type: 'img', x: 0, y: 0, w: 90, h: 60, natural: { w: 6000, h: 4000 } };

test('clip plan for an empty selection keeps only the private format', () => {
  assert.deepStrictEqual(clipPlan({ items: [], bbox: { w: 0, h: 0 }, zoom: 1 }), {
    png: null, text: '', html: false, privateClip: true,
  });
});

test('a single picture uses its original bytes regardless of zoom and size', () => {
  assert.deepStrictEqual(clipPlan({ items: [picture], bbox: { w: 90, h: 60 }, zoom: 50 }), {
    png: { mode: 'original' }, text: '', html: false, privateClip: true,
  });
});

test('two pictures render at twice the screen size with whole-pixel dimensions', () => {
  const items = [picture, { ...picture, x: 101.1 }];
  assert.deepStrictEqual(clipPlan({ items, bbox: { w: 191.1, h: 60 }, zoom: 1.25 }), {
    png: { mode: 'render', width: 478, height: 150, scale: 2.5 },
    text: '', html: false, privateClip: true,
  });
  assert.strictEqual(clipPlan({ items, bbox: { w: 191.3, h: 60 }, zoom: 1.25 }).png.width, 478);
});

test('a wide drawing scales to the 4000 pixel limit in both dimensions', () => {
  const items = [{ type: 'stroke', w: 3000, h: 1500 }];
  const { png } = clipPlan({ items, bbox: { w: 3000, h: 1500 }, zoom: 2 });
  assert.deepStrictEqual(png, { mode: 'render', width: 4000, height: 2000, scale: 4000 / 3000 });
});

test('a tall selection uses its height for the limit and keeps at least one pixel of width', () => {
  const items = [{ type: 'stroke', w: 0.1, h: 10000 }];
  const { png } = clipPlan({ items, bbox: { w: 0.1, h: 10000 }, zoom: 1 });
  assert.deepStrictEqual(png, { mode: 'render', width: 1, height: 4000, scale: 0.4 });
});

test('a selection exactly at the limit keeps its render scale', () => {
  const items = [{ type: 'shape', w: 150, h: 2000 }];
  const { png } = clipPlan({ items, bbox: { w: 150, h: 2000 }, zoom: 1 });
  assert.deepStrictEqual(png, { mode: 'render', width: 300, height: 4000, scale: 2 });
});

test('text boxes and table cells follow reading order without changing drawing order', () => {
  const table = {
    type: 'table', x: 0, y: 30,
    cells: [[{ t: 'Name', b: true }, { t: 'Value' }], [{ t: '' }, { t: 'One', h: '<b>One</b>' }]],
  };
  const first = { type: 'text', x: 0, y: 10, text: 'Title\nSubtitle' };
  const second = { type: 'text', x: 60, y: 10, text: 'Caption' };
  const samePosition = { type: 'text', x: 60, y: 10, text: 'Note' };
  const shape = { type: 'shape', x: 0, y: 0, text: 'Shape label' };
  const items = Object.freeze([table, second, samePosition, shape, first, picture]);
  const plan = clipPlan({ items, bbox: { w: 100, h: 80 }, zoom: 1 });
  assert.deepStrictEqual(plan, {
    png: { mode: 'render', width: 200, height: 160, scale: 2 },
    text: 'Title\nSubtitle\nCaption\nNote\nName\nValue\nOne',
    html: true, privateClip: true,
  });
});

test('a text-only selection offers PNG, plain text and HTML', () => {
  const items = [{ type: 'text', x: 0, y: 0, text: 'Notes' }];
  assert.deepStrictEqual(clipPlan({ items, bbox: { w: 50, h: 20 }, zoom: 1 }), {
    png: { mode: 'render', width: 100, height: 40, scale: 2 },
    text: 'Notes', html: true, privateClip: true,
  });
});

test('a table with only precomputed plain text can supply that text', () => {
  const items = [{ type: 'table', x: 0, y: 0, text: 'Name\nValue' }];
  const { text, html } = clipPlan({ items, bbox: { w: 50, h: 20 }, zoom: 1 });
  assert.strictEqual(text, 'Name\nValue');
  assert.strictEqual(html, true);
});

test('empty text boxes and table cells leave HTML disabled', () => {
  const items = [{ type: 'text', text: '' }, { type: 'table', cells: [[{ t: '' }]] }];
  const { png, text, html } = clipPlan({ items, bbox: { w: 10, h: 20 }, zoom: 1 });
  assert.strictEqual(png.mode, 'render');
  assert.strictEqual(text, '');
  assert.strictEqual(html, false);
});

test('a zero-size selection renders at least one pixel per side and an invalid zoom defaults to one', () => {
  const items = [{ type: 'stroke' }];
  const { png } = clipPlan({ items, bbox: { w: 0, h: 0 }, zoom: 0 });
  assert.deepStrictEqual(png, { mode: 'render', width: 1, height: 1, scale: 2 });
});
