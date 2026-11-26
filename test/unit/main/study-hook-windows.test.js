'use strict';
// The study session's Windows hook (C# compiled by PowerShell): it compiles (CI on Windows).
const test = require('node:test');
const assert = require('node:assert');
const { startHook } = require('../../../src/main/study');

test('study hook script compiles on Windows', { skip: process.platform !== 'win32' && 'needs Windows', timeout: 120000 }, async () => {
  const lines = [];
  const ps = startHook((l) => lines.push(l), { STUDY_HOOK_CHECK: '1' });
  await new Promise((r) => ps.on('close', r));
  assert.deepStrictEqual(lines, ['compiled']);
});
