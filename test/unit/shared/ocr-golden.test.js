'use strict';
// Recorded readings (test/golden/ocr/raw/*.json, written by
// `UPDATE_GOLDEN=1 node test/e2e/ocr-bench.js`) replayed through the layout
// rules in milliseconds, without Tesseract: languages, tilt, umlauts and the
// paragraph boxes must stay as recorded in expect.json. After an intended
// change of a rule: `UPDATE_GOLDEN=1 npm test` records the new results.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { narrowLangs, skewOf, fixUmlauts, joinParagraphs } = require('../../../src/shared/scan-text');

const dir = path.join(__dirname, '..', '..', 'golden', 'ocr', 'raw');
const expectFile = path.join(dir, 'expect.json');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'expect.json').sort() : [];

const r2 = (v) => Math.round(v * 100) / 100;
function replay(rec) {
  const out = { langs: narrowLangs(rec.first), skew: r2(skewOf(rec.first)), text: fixUmlauts(rec.first).map((l) => l.text.trim()) };
  if (rec.join) {
    const { texts, lines, fonts, r, S } = rec.join;
    const { boxes } = joinParagraphs(texts, lines, fonts, r, S);
    out.boxes = boxes.map((b) => ({ text: b.text, lh: b.lh, al: b.al || 'left', b: !!b.b, i: !!b.i, u: !!b.u, x: r2(b.x), y: r2(b.y) }));
  }
  return out;
}

test('OCR golden: recorded readings give the recorded layout', { skip: files.length ? false : 'no recorded readings yet' }, () => {
  // (in the stored JSON form: fields that are undefined are left out)
  const now = JSON.parse(JSON.stringify(Object.fromEntries(files.map((f) => [f, replay(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))]))));
  if (process.env.UPDATE_GOLDEN) {
    fs.writeFileSync(expectFile, JSON.stringify(now, null, 1) + '\n');
    return;
  }
  assert.ok(fs.existsSync(expectFile), 'expect.json missing: run UPDATE_GOLDEN=1 npm test');
  const want = JSON.parse(fs.readFileSync(expectFile, 'utf8'));
  assert.deepStrictEqual(Object.keys(now), Object.keys(want), 'recorded cases and expectations differ');
  for (const f of files) assert.deepStrictEqual(now[f], want[f], f);
});
