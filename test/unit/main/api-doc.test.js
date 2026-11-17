'use strict';
// docs/api.md must list exactly the methods that preload.js exposes as
// window.api. Both files are read as text; electron is not loaded.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const PRELOAD = path.join(ROOT, 'src', 'main', 'preload.js');
const DOC = path.join(ROOT, 'docs', 'api.md');

// Keys of the object literal passed to contextBridge.exposeInMainWorld('api', {...}).
// A small scanner: it skips comments and string/template literals and only
// reads keys at the top level of the object, so arrow-function bodies and
// their braces or colons do not confuse it.
function preloadMethods(src) {
  const m = /exposeInMainWorld\(\s*(['"`])api\1\s*,\s*\{/.exec(src);
  assert.ok(m, 'preload.js: contextBridge.exposeInMainWorld(\'api\', { ... }) not found');
  const names = [];
  let depth = 1; // inside the object literal
  let expectKey = true; // at the start of an entry
  let i = m.index + m[0].length;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
      i++;
      expectKey = false;
      continue;
    }
    if (depth === 1 && expectKey && /[A-Za-z_$]/.test(c)) {
      const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))[0];
      let j = i + id.length;
      while (/\s/.test(src[j])) j++;
      // `name:` (property), `name(` (method) or `name,` / `name }` (shorthand)
      if (src[j] === ':' || src[j] === '(' || src[j] === ',' || src[j] === '}') names.push(id);
      expectKey = false;
      i += id.length;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 1) expectKey = true;
    i++;
  }
  assert.strictEqual(depth, 0, 'preload.js: the api object literal is not closed');
  return names;
}

// First column of the table rows: | `name` | ...
function docMethods(md) {
  const names = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\|\s*`([A-Za-z_$][\w$]*)`\s*\|/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

const dupes = (list) => list.filter((n, i) => list.indexOf(n) !== i);

test('api doc: preload.js exposes methods and the extraction finds them', () => {
  const names = preloadMethods(fs.readFileSync(PRELOAD, 'utf8'));
  assert.ok(names.length > 20, `only ${names.length} methods found in preload.js; the extraction is probably broken`);
  assert.ok(names.includes('readNotebook') && names.includes('onLibraryChanged') && names.includes('pathForFile'));
  assert.deepStrictEqual(dupes(names), [], 'preload.js lists a method twice');
});

test('api doc: docs/api.md lists exactly the methods of window.api', () => {
  const inPreload = new Set(preloadMethods(fs.readFileSync(PRELOAD, 'utf8')));
  const md = fs.readFileSync(DOC, 'utf8');
  const listed = docMethods(md);
  const inDoc = new Set(listed);
  const missing = [...inPreload].filter((n) => !inDoc.has(n));
  const extra = [...inDoc].filter((n) => !inPreload.has(n));
  const problems = [];
  if (missing.length) problems.push(`In preload.js but missing in docs/api.md: ${missing.join(', ')}`);
  if (extra.length) problems.push(`In docs/api.md but not in preload.js: ${extra.join(', ')}`);
  if (dupes(listed).length) problems.push(`Listed twice in docs/api.md: ${[...new Set(dupes(listed))].join(', ')}`);
  assert.strictEqual(problems.length, 0, '\n' + problems.join('\n'));
});

test('api doc: every row has an Android 2.0 status', () => {
  const bad = [];
  for (const line of fs.readFileSync(DOC, 'utf8').split(/\r?\n/)) {
    const m = /^\|\s*`([A-Za-z_$][\w$]*)`\s*\|/.exec(line);
    if (!m) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5 || !['needed', 'later', 'desktop-only'].includes(cells[4])) bad.push(m[1]);
  }
  assert.deepStrictEqual(bad, [], 'rows without a valid status (needed, later or desktop-only): ' + bad.join(', '));
});
