'use strict';
// src/shared/paths.js and src/platform/memory.js must also run in the Android
// WebView and the browser: no Node or Electron modules, no Node byte buffers.
// Same text scan as test/unit/shared/shared-guard.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');
const FILES = ['shared/paths.js', 'platform/memory.js'];
const BANNED = ['fs', 'path', 'os', 'crypto', 'electron'];

test('paths.js and memory.js need no Node or Electron modules and no Buffer', () => {
  const bad = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1'); // without comments
    const code = src.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''"); // and without string contents
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const name = m[1].replace(/^node:/, '');
      if (BANNED.includes(name) || BANNED.some((b) => name.startsWith(b + '/'))) bad.push(`${f}: require('${m[1]}')`);
      if (!name.startsWith('.')) bad.push(`${f}: require('${m[1]}') is not a project file`);
    }
    if (/\bBuffer\b/.test(code)) bad.push(`${f}: Buffer`);
    for (const g of ['process.', '__dirname', 'document.', 'window.']) if (code.includes(g)) bad.push(`${f}: ${g}`);
  }
  assert.deepStrictEqual(bad, []);
});
