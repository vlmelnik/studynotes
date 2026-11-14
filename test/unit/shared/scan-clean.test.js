'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('1.7: scan cleaning removes dark text and keeps the paper colour', () => {
  const { cleanLines } = require('../../../src/shared/scan-clean');
  const W = 120, H = 40, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 240; data[i * 4 + 1] = 232; data[i * 4 + 2] = 215; data[i * 4 + 3] = 255; }
  // "letters": dark blue bars
  for (let y = 12; y < 28; y++) for (let x = 20; x < 100; x++) if ((x % 6) < 3) { const i = (y * W + x) * 4; data[i] = 20; data[i + 1] = 40; data[i + 2] = 130; }
  const img = { width: W, height: H, data };
  const [look] = cleanLines(img, [{ bbox: { x0: 20, y0: 12, x1: 100, y1: 28 } }]);
  const rgb = [1, 3, 5].map((k) => parseInt(look.color.slice(k, k + 2), 16));
  assert.ok(Math.abs(rgb[0] - 20) < 15 && Math.abs(rgb[2] - 130) < 15, look.color);
  let min = 255;
  for (let i = 0; i < W * H; i++) min = Math.min(min, data[i * 4]);
  assert.ok(min > 200, `darkest red ${min}`);
});

// --- cleaning paints only the letters (plan 1.3) ---
// A sheet of paper with blocky "letters": 3 px stems, a bar on top of every
// second one, some with a descender.
const PAPER = [240, 232, 215], INK = [25, 25, 35];
function sheet(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = PAPER[0]; data[i * 4 + 1] = PAPER[1]; data[i * 4 + 2] = PAPER[2]; data[i * 4 + 3] = 255; }
  return { width: W, height: H, data };
}
function rect(img, x0, y0, x1, y1, c = INK) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.width + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; }
}
// letters from x0 to x1, body y0..base, every third with a descender to `desc`
function word(img, x0, x1, y0, base, desc = base) {
  let k = 0;
  for (let x = x0; x + 3 <= x1; x += 7, k++) {
    rect(img, x, y0, x + 3, k % 3 === 1 ? desc : base);
    if (k % 2 === 0 && x + 6 <= x1) rect(img, x, y0, x + 6, y0 + 3);
  }
  return { x0, y0, x1: x0 + Math.floor((x1 - x0 - 3) / 7) * 7 + (Math.floor((x1 - x0 - 3) / 7) % 2 === 0 && x0 + Math.floor((x1 - x0 - 3) / 7) * 7 + 6 <= x1 ? 6 : 3), y1: desc };
}
const dark = (img, x, y) => img.data[(y * img.width + x) * 4] < 150;
function darkIn(img, x0, y0, x1, y1, skip = () => false) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!skip(x, y) && dark(img, x, y)) n++;
  return n;
}
const same = (a, b, x, y) => { const i = (y * a.width + x) * 4; return a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]; };
const copy = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });

test('1.3: cleaning a table cell keeps its borders', () => {
  const { cleanLines } = require('../../../src/shared/scan-clean');
  for (const gap of [2, 3, 4]) {
    const img = sheet(260, 120);
    const bb = word(img, 60, 180, 50, 70);
    // the cell: 2 px borders `gap` pixels from the letters, the table goes on
    const bx0 = bb.x0 - gap - 2, bx1 = bb.x1 + gap, by0 = bb.y0 - gap - 2, by1 = bb.y1 + gap;
    const border = (x, y) => ((y >= by0 && y < by0 + 2) || (y >= by1 && y < by1 + 2) || (y >= 10 && y < 110 && ((x >= bx0 && x < bx0 + 2) || (x >= bx1 && x < bx1 + 2)))) && x >= 10 && x < 250 && y >= 10 && y < 110;
    for (let y = 0; y < 120; y++) for (let x = 0; x < 260; x++) if (border(x, y)) rect(img, x, y, x + 1, y + 1);
    const before = copy(img);
    const looks = cleanLines(img, [{ bbox: bb }]);
    let changed = 0, painted = 0;
    for (let y = 0; y < 120; y++) for (let x = 0; x < 260; x++) if (border(x, y)) { if (!same(img, before, x, y)) changed++; if (looks.fill[y * 260 + x]) painted++; }
    assert.strictEqual(changed, 0, `gap ${gap}: ${changed} border pixels changed`);
    assert.strictEqual(painted, 0, `gap ${gap}: ${painted} border pixels in the patch`);
    assert.strictEqual(darkIn(img, bx0 + 2, by0 + 2, bx1, by1), 0, `gap ${gap}: letters left in the cell`);
    assert.strictEqual(looks[0].color, '#191923');
  }
});

test('1.3: cleaning text on a form rule keeps the rule whole', () => {
  const { cleanLines } = require('../../../src/shared/scan-clean');
  const img = sheet(260, 100);
  const bb = word(img, 60, 180, 40, 60, 67); // descenders cross the rule
  rect(img, 20, 60, 240, 62); // the rule the text is written on
  const rule = (x, y) => y >= 60 && y < 62 && x >= 20 && x < 240;
  const before = copy(img);
  cleanLines(img, [{ bbox: bb, baseline: { x0: bb.x0, y0: 60, x1: bb.x1, y1: 60 } }]);
  for (let x = 20; x < 240; x++) for (let y = 60; y < 62; y++) assert.ok(same(img, before, x, y), `rule changed at ${x},${y}`);
  assert.strictEqual(darkIn(img, 0, 0, 260, 100, rule), 0, 'letters left');
});

test('1.3: cleaning leaves the word of a neighbouring column alone', () => {
  const { cleanLines } = require('../../../src/shared/scan-clean');
  const img = sheet(320, 80);
  const bb = word(img, 40, 150, 30, 50);
  const hgt = bb.y1 - bb.y0;
  const nb = word(img, bb.x1 + Math.round(hgt * 0.4), 300, 30, 50); // 0.4 line heights away
  const left = word(img, 4, bb.x0 - Math.round(hgt * 0.3), 30, 50);
  const before = copy(img);
  const looks = cleanLines(img, [{ bbox: bb }]);
  for (const b of [nb, left]) for (let y = b.y0 - 3; y < b.y1 + 3; y++) for (let x = b.x0; x < b.x1; x++) {
    assert.ok(same(img, before, x, y), `neighbour changed at ${x},${y}`);
    assert.ok(!looks.fill[y * 320 + x], `neighbour in the patch at ${x},${y}`);
  }
  assert.strictEqual(darkIn(img, bb.x0, 0, bb.x1, 80), 0, 'letters left');
});

test('1.3: plain text is cleaned completely, with a missed full stop', () => {
  const { cleanLines } = require('../../../src/shared/scan-clean');
  const img = sheet(300, 120);
  const a = word(img, 30, 250, 30, 50, 56), b = word(img, 30, 200, 64, 84, 90);
  rect(img, a.x1 + 4, 47, a.x1 + 7, 50); // a full stop outside the read box
  // a strike-through and a dash stay letters' ink (they end with the text)
  rect(img, b.x0, 73, b.x1, 75);
  const looks = cleanLines(img, [{ bbox: a }, { bbox: b }]);
  let min = 255;
  for (let i = 0; i < 300 * 120; i++) min = Math.min(min, img.data[i * 4]);
  assert.ok(min > 150, `darkest red ${min}`);
  assert.strictEqual(looks.length, 2);
  assert.ok(looks.fill.some(Boolean));
});

test('1.3: an underline that goes onto the text box is erased, a longer rule is not', () => {
  const { cleanLines } = require('../../../src/shared/scan-clean');
  const mk = (ux0, ux1) => {
    const img = sheet(300, 90);
    const bb = word(img, 80, 200, 30, 50);
    rect(img, bb.x0 + ux0, 53, bb.x1 + ux1, 55);
    // (the caller stretches the box over the underline)
    cleanLines(img, [{ bbox: { ...bb, y1: 59 }, under: true }]);
    return darkIn(img, 0, 0, 300, 90);
  };
  assert.strictEqual(mk(0, 0), 0, 'underline left');
  assert.strictEqual(mk(-3, 3), 0, 'slightly longer underline left');
  assert.ok(mk(-60, 60) >= 2 * 230, 'a rule under the text was erased');
});

test('1.3: longRuns joins the pieces of a rule that is not level', () => {
  const { longRuns } = require('../../../src/shared/scan-clean');
  const w = 60, h = 10, m = new Uint8Array(w * h);
  for (let x = 0; x < 60; x++) m[(3 + Math.floor(x / 20)) * w + x] = 1; // three steps
  for (let y = 0; y < 10; y++) m[y * w + 30] = 1; // a stem through it
  const g = longRuns(m, w, h, 8);
  assert.strictEqual(g.length, 1);
  assert.deepStrictEqual([g[0].x0, g[0].x1, g[0].y0, g[0].y1], [0, 60, 3, 6]);
});

test('1.3: a rule along the edge of the line box does not make dark text "light"', () => {
  const { lineInk, cleanLines } = require('../../../src/shared/scan-clean');
  const img = sheet(300, 100);
  const bb = word(img, 40, 240, 40, 60);
  // pad = 3: the rule lies on the last rows of the padded box, a border on its right edge
  rect(img, 0, 62, 300, 66);
  rect(img, bb.x1 + 9, 0, bb.x1 + 12, 100);
  const li = lineInk(img, { x0: bb.x0 - 8, y0: bb.y0 - 3, x1: bb.x1 + 10, y1: bb.y1 + 3 });
  assert.strictEqual(li.light, false);
  const [look] = cleanLines(img, [{ bbox: bb }]);
  assert.strictEqual(look.color, '#191923');
  assert.strictEqual(darkIn(img, bb.x0, bb.y0, bb.x1, bb.y1), 0, 'letters left');
  assert.strictEqual(darkIn(img, 0, 62, 300, 66), 300 * 4, 'rule damaged');
});

test('lineInk still finds light text on a dark label', () => {
  const { lineInk } = require('../../../src/shared/scan-clean');
  const img = sheet(200, 60);
  rect(img, 0, 0, 200, 60, [30, 30, 40]);
  for (let x = 30; x < 170; x += 7) rect(img, x, 20, x + 3, 40, [245, 245, 245]);
  const li = lineInk(img, { x0: 22, y0: 17, x1: 180, y1: 43 });
  assert.strictEqual(li.light, true);
  assert.strictEqual(li.ink[5 * li.w + 8 + 1], 1);
});
