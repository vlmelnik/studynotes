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
