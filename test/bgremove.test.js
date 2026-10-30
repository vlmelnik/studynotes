'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const bg = require('../src/main/bgremove');

const MODEL = path.join(__dirname, '..', 'assets', 'models', bg.MODEL_FILE);

// Synthetic scene: shaded orange ball with a dark outline on a light grey/blue vertical
// gradient with mild noise (something like a product photo).
function makeScene(w, h) {
  const data = Buffer.alloc(w * h * 4);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.3;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const t = y / h;
      let R = 225 - 40 * t, G = 230 - 30 * t, B = 240 - 10 * t;
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) {
        const shade = 1 - 0.5 * Math.hypot(x - cx + r * 0.35, y - cy + r * 0.35) / (2 * r);
        R = 240 * shade; G = 120 * shade; B = 30 * shade;
        if (d > r - 3) { R = G = B = 40; }
      }
      const n = rnd() * 8;
      data[p] = Math.max(0, Math.min(255, R + n));
      data[p + 1] = Math.max(0, Math.min(255, G + n));
      data[p + 2] = Math.max(0, Math.min(255, B + n));
      data[p + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function pngInfo(buf) {
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG signature');
  assert.strictEqual(buf.toString('latin1', 12, 16), 'IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), depth: buf[24], colorType: buf[25] };
}

function meanAlpha(img, x0, y0, x1, y1) {
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += img.data[(y * img.width + x) * 4 + 3]; n++; }
  return s / n;
}

function checkResult(png, w, h) {
  const info = pngInfo(png);
  assert.deepStrictEqual(info, { width: w, height: h, depth: 8, colorType: 6 }, 'RGBA PNG, same size');
  const out = bg.decodePNG(png);
  const c = Math.round(Math.min(w, h) * 0.08);
  const corners = [
    meanAlpha(out, 0, 0, c, c), meanAlpha(out, w - c, 0, w, c),
    meanAlpha(out, 0, h - c, c, h), meanAlpha(out, w - c, h - c, w, h),
  ];
  const centre = meanAlpha(out, Math.round(w / 2 - c), Math.round(h / 2 - c), Math.round(w / 2 + c), Math.round(h / 2 + c));
  return { out, corners, centre };
}

test('PNG encode/decode round trip', () => {
  const img = makeScene(37, 23);
  img.data[3] = 0; img.data[7] = 128;
  const back = bg.decodePNG(bg.encodePNG(img.data, img.width, img.height));
  assert.strictEqual(back.width, 37);
  assert.strictEqual(back.height, 23);
  assert.ok(back.data.equals(img.data));
});

test('model file is present', () => {
  assert.ok(fs.existsSync(MODEL), MODEL);
  assert.ok(fs.statSync(MODEL).size > 30e6);
});

test('removeBackground: synthetic object on gradient', { timeout: 60000 }, async (t) => {
  t.after(() => bg.dispose());
  await bg.warmup();
  const w = 900, h = 640;
  const img = makeScene(w, h);
  const input = bg.encodePNG(img.data, w, h);
  const t0 = Date.now();
  const png = await bg.removeBackground(input);
  t.diagnostic(`removeBackground ${w}x${h}: ${Date.now() - t0} ms`);
  const { out, corners, centre } = checkResult(png, w, h);
  for (const a of corners) assert.ok(a < 20, `corner alpha ${a.toFixed(1)} should be ~0`);
  assert.ok(centre > 235, `centre alpha ${centre.toFixed(1)} should be ~255`);
  // foreground colours are preserved
  const p = (Math.round(h / 2) * w + Math.round(w / 2)) * 4;
  assert.deepStrictEqual([...out.data.subarray(p, p + 3)], [...img.data.subarray(p, p + 3)]);

  // raw RGBA entry point gives the same result
  const png2 = await bg.removeBackgroundRGBA(img);
  assert.ok(png2.equals(png));
});

test('removeBackground keeps existing transparency and handles small/odd sizes', { timeout: 60000 }, async (t) => {
  t.after(() => bg.dispose());
  const img = makeScene(203, 97);
  for (let y = 0; y < 10; y++) for (let x = 90; x < 110; x++) img.data[(y * 203 + x) * 4 + 3] = 0;
  const png = await bg.removeBackground(bg.encodePNG(img.data, 203, 97));
  const out = bg.decodePNG(png);
  assert.strictEqual(out.width, 203);
  assert.strictEqual(out.height, 97);
  assert.strictEqual(meanAlpha(out, 90, 0, 110, 10), 0);
});

test('removeBackground: real photo (set BGREMOVE_TEST_PHOTO=/path/to/photo.png)', {
  timeout: 60000,
  skip: !process.env.BGREMOVE_TEST_PHOTO && 'BGREMOVE_TEST_PHOTO not set',
}, async (t) => {
  t.after(() => bg.dispose());
  const buf = fs.readFileSync(process.env.BGREMOVE_TEST_PHOTO);
  const src = bg.decodePNG(buf);
  const png = await bg.removeBackground(buf);
  const { corners, centre } = checkResult(png, src.width, src.height);
  t.diagnostic(`corners ${corners.map((a) => a.toFixed(0))}, centre ${centre.toFixed(0)}`);
  assert.ok(Math.min(...corners) < 20, 'at least one corner is background');
  assert.ok(centre > 200, 'centre is foreground');
});

test('rejects garbage input', async () => {
  await assert.rejects(bg.removeBackground(Buffer.from('not an image')), /unsupported image format/);
});
