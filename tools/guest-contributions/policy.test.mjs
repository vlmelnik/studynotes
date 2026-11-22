import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permittedPath } from './policy.mjs';

test('guest scope: docs, shared code, extensions and their tests only', () => {
  for (const ok of ['docs/NOTES-PASTE.md', 'docs/SPEC-PASTE.md', 'src/shared/outline.js', 'test/unit/shared/outline.test.js',
    'src/extensions/rich-paste/index.js', 'src/extensions/rich-paste/styles.css',
    'test/unit/extensions/rich-paste.test.js', 'test/e2e/extensions/rich-paste.js']) assert.ok(permittedPath(ok), ok);
  for (const no of ['docs/contributions/tasks.json', 'docs/contributions/PLANNING.md', 'src/renderer/editor.js',
    'src/main/main.js', 'src/extensions/index.js', 'src/extensions/a/b/c.js', 'src/extensions/Rich/index.js',
    'src/extensions/x/data.json', 'test/e2e/harness/app.js', 'test/unit/main/extensions-guard.test.js',
    'test/e2e/extensions/x/y.js', 'package.json', '.github/workflows/ci.yml']) assert.ok(!permittedPath(no), no);
});
