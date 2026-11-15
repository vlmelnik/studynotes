'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('1.7: text recognition data comes with the app (complete, no download)', async () => {
  const { Ocr, FILES } = require('../../../src/main/ocr');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-ocr-'));
  const ocr = new Ocr({ dir, bundledDir: path.join(__dirname, '..', '..', '..', 'assets', 'ocr') });
  const st = await ocr.status();
  assert.strictEqual(st.installed, true);
  assert.deepStrictEqual(st.langs, FILES.map((f) => f.lang));
  // language data an early 1.7 build downloaded into the app data is removed
  for (const f of FILES) fs.writeFileSync(path.join(dir, f.file), 'old');
  await ocr.forgetDownloaded();
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  // a damaged install says so instead of failing somewhere later
  const broken = new Ocr({ dir, bundledDir: path.join(dir, 'missing') });
  assert.strictEqual((await broken.status()).installed, false);
  await assert.rejects(() => broken.recognize(Buffer.alloc(1), ['eng']), /reinstall/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- several readers at once (a stand-in for Tesseract) ----------
function fakePool(max, { ms = 30 } = {}) {
  const { Ocr } = require('../../../src/main/ocr');
  const st = { made: [], active: 0, most: 0, ended: 0 };
  const ocr = new Ocr({
    dir: os.tmpdir(), bundledDir: path.join(__dirname, '..', '..', '..', 'assets', 'ocr'), maxWorkers: max,
    createWorker: async (langs) => {
      const id = st.made.length;
      st.made.push(langs.join('+'));
      return {
        recognize: async (buf) => {
          st.active++; st.most = Math.max(st.most, st.active);
          await new Promise((r) => setTimeout(r, ms));
          st.active--;
          if (buf[0] === 255) throw new Error('bad picture');
          return { data: { blocks: [{ paragraphs: [{ lines: [{ text: `job ${buf[0]} by ${id}\n`, confidence: 90, bbox: {}, baseline: {}, words: [] }] }] }] } };
        },
        terminate: async () => { st.ended++; },
      };
    },
  });
  return { ocr, st };
}
const img = (n) => Buffer.from([n]);

test('ocr pool: one reader for single calls; more only while jobs wait, never above the limit', async () => {
  const { ocr, st } = fakePool(3);
  assert.strictEqual((await ocr.status()).workers, 3);
  await ocr.recognize(img(1), ['eng']);
  await ocr.recognize(img(2), ['eng']);
  assert.strictEqual(st.made.length, 1, 'calls one after the other need one reader');
  const out = await Promise.all([1, 2, 3, 4, 5].map((n) => ocr.recognize(img(n), ['eng'])));
  assert.deepStrictEqual(out.map((l) => l[0].text.split(' ')[1]), ['1', '2', '3', '4', '5'], 'every call gets its own result');
  assert.strictEqual(st.made.length, 3);
  assert.strictEqual(st.most, 3);
  await ocr.stop();
  assert.strictEqual(st.ended, 3);
});

test('ocr pool: a limit of one reads one after the other', async () => {
  const { ocr, st } = fakePool(1);
  await Promise.all([1, 2, 3].map((n) => ocr.recognize(img(n), ['eng'])));
  assert.strictEqual(st.most, 1);
  assert.strictEqual(st.made.length, 1);
  await ocr.stop();
});

test('ocr pool: other languages start new readers after the running jobs; a failed job does not block the next', async () => {
  const { ocr, st } = fakePool(2);
  const a = ocr.recognize(img(1), ['deu', 'eng']), b = ocr.recognize(img(2), ['deu', 'eng']), c = ocr.recognize(img(3), ['rus']);
  const bad = ocr.recognize(img(255), ['rus']);
  const res = await Promise.allSettled([a, b, c, bad]);
  assert.deepStrictEqual(res.map((r) => r.status), ['fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
  assert.match(res[3].reason.message, /bad picture/);
  assert.ok(st.made.slice(0, 2).every((k) => k === 'deu+eng') && st.made.slice(2).every((k) => k === 'rus'), st.made.join(','));
  assert.strictEqual(st.ended, 2, 'the readers with the old languages are ended');
  assert.strictEqual((await ocr.recognize(img(4), ['rus']))[0].text.startsWith('job 4'), true);
  await ocr.stop();
});
