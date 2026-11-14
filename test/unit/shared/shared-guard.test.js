'use strict';
// src/shared is used by the desktop main process, the renderer and (2.0) the
// Android build: it must not depend on Node, Electron or the DOM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', '..', 'src', 'shared');

test('src/shared needs no Node, Electron or browser APIs', () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 10);
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1'); // without comments
    const code = src.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''"); // and without string contents
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) if (!m[1].startsWith('./')) bad.push(`${f}: require('${m[1]}')`);
    for (const g of ['document.', 'window.', 'navigator.', 'localStorage', 'process.', '__dirname']) if (code.includes(g)) bad.push(`${f}: ${g}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('every shared module loads in plain Node', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) assert.doesNotThrow(() => require(path.join(dir, f)), f);
});
