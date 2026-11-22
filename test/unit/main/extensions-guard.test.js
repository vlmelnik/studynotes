'use strict';
// Extensions (src/extensions/<id>/) can come from outside contributors. They
// run in the renderer, so they must reach the app only through the host object
// handed to activate() (docs/EXTENSIONS.md) – never through window.api (files,
// network, settings of other parts), the network or code built from strings.
// This file is outside the contributors' file scope on purpose.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..', 'src', 'extensions');
// packages an extension may import (added to package.json by the maintainer)
const PACKAGES = ['katex'];

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

function problems(id, file, src) {
  const bad = [];
  const code = stripComments(src);
  const plain = code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");
  for (const m of code.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1] || m[2] || m[3];
    const own = spec.startsWith('./');
    const shared = /^\.\.\/\.\.\/shared\/[a-z0-9-]+\.js$/.test(spec);
    const pkg = PACKAGES.some((p) => spec === p || spec.startsWith(p + '/'));
    if (!own && !shared && !pkg) bad.push(`${id}/${file}: import '${spec}'`);
  }
  if (/\bimport\s*\(\s*[^'"\s]/.test(code)) bad.push(`${id}/${file}: import() of a computed name`);
  for (const g of ['require(', 'window.api', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'eval(', 'Function(',
    'importScripts', 'navigator.sendBeacon', 'localStorage', 'indexedDB', 'process.', 'globalThis.api']) {
    if (plain.includes(g)) bad.push(`${id}/${file}: ${g}`);
  }
  return bad;
}

const list = () => (fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

test('extensions use only the host, their own files, src/shared and allowed packages', () => {
  const bad = [];
  for (const id of list()) {
    if (!/^[a-z0-9-]+$/.test(id)) bad.push(`${id}: folder name`);
    const dir = path.join(root, id);
    if (!fs.existsSync(path.join(dir, 'index.js'))) bad.push(`${id}: no index.js`);
    for (const f of fs.readdirSync(dir)) {
      if (fs.statSync(path.join(dir, f)).isDirectory()) { bad.push(`${id}/${f}: sub folders are not allowed`); continue; }
      if (f.endsWith('.js')) bad.push(...problems(id, f, fs.readFileSync(path.join(dir, f), 'utf8')));
      else if (f.endsWith('.css')) { if (/@import|url\(\s*['"]?(?:https?:|\/\/)/i.test(fs.readFileSync(path.join(dir, f), 'utf8'))) bad.push(`${id}/${f}: remote CSS`); }
      else bad.push(`${id}/${f}: only .js and .css files`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('the guard itself catches the forbidden things', () => {
  const p = (s) => problems('x', 'index.js', s);
  assert.deepStrictEqual(p("import { a } from './a.js';\nimport { findMath } from '../../shared/paste-math.js';\nimport katex from 'katex';\nexport default { id: 'x' };"), []);
  assert.ok(p("import fs from 'fs';").length);
  assert.ok(p("import x from '../../renderer/editor.js';").length);
  assert.ok(p("export { y } from '../other/index.js';").length);
  assert.ok(p('window.api.readFile("a")').length);
  assert.ok(p('fetch("https://example.com")').length);
  assert.ok(p('const m = await import(name);').length);
  assert.ok(p('new Function("return 1")').length);
  assert.deepStrictEqual(p("// fetch( in a comment\nconst s = 'fetch(';"), []);
});
