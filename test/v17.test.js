'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

test('1.7: scan cleaning removes dark text and keeps the paper colour', () => {
  const { cleanLines } = require('../src/shared/scan-clean');
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

test('1.7: handwriting words are put in reading order', () => {
  const { wordsToText } = require('../src/main/handwriting');
  const w = (text, x, y) => ({ text, x, y, w: 30, h: 12 });
  assert.strictEqual(wordsToText([w('world', 60, 10), w('second', 10, 40), w('hello', 10, 12), w('line', 70, 41)]), 'hello world\nsecond line');
});

test('1.7: the OCR add-on refuses damaged downloads and installs good ones', async () => {
  const { Ocr, FILES } = require('../src/main/ocr');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-ocr-'));
  const real = (f) => fs.readFileSync(require.resolve(`@tesseract.js-data/${f.lang}/4.0.0_best_int/${f.file}`));
  const body = (buf) => ({ ok: true, body: { getReader() { let done = false; return { read: async () => (done ? { done: true } : ((done = true), { done: false, value: new Uint8Array(buf) })) }; } } });
  const bad = new Ocr({ dir, fetch: async () => body(Buffer.from('nope')) });
  await assert.rejects(() => bad.install(), /damaged/);
  assert.strictEqual((await bad.status()).installed, false);
  const good = new Ocr({ dir, fetch: async (url) => body(real(FILES.find((f) => url.endsWith(f.file)))) });
  for (const f of FILES) assert.strictEqual(crypto.createHash('sha256').update(real(f)).digest('hex'), f.sha256, f.file);
  const st = await good.install();
  assert.strictEqual(st.installed, true);
  assert.deepStrictEqual(st.langs, ['eng', 'deu', 'rus']);
  assert.strictEqual((await good.remove()).installed, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
