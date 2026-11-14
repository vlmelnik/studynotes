'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fontFile, FONTS } = require('../../../src/shared/fonts');

const ROOT = path.join(__dirname, '..', '..', '..');

test('fonts: every font file exists, variants resolve', () => {
  for (const f of Object.values(FONTS)) for (const file of Object.values(f.files)) assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'fonts', file)), file);
  assert.deepStrictEqual(fontFile('hand', true, true), { file: 'Neucha-Regular.ttf', synthBold: true, synthItalic: true, subset: true });
  assert.strictEqual(fontFile('serif', true, false).file, 'LiberationSerif-Bold.ttf');
});
