'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeName, uniqueName, caseOnlyRename, renamePlan } = require('../../../src/shared/names');

test('safeName replaces invalid characters and normalizes spacing', () => {
  for (const char of '<>:"/\\|?*\x00\x1f\x7f\x85') {
    assert.equal(safeName(`Unit${char}one`), 'Unit one');
  }
  assert.equal(safeName('  Week\t\t one   ...  '), 'Week one');
  for (const name of ['', '  ...  ', '/\\?']) assert.equal(safeName(name), 'Untitled');
});

test('safeName prefixes Windows device names even with an extension', () => {
  for (const name of ['CON', 'prn', 'AuX', 'NUL.txt', 'COM1', 'com9.log', 'LPT1', 'lpt9 .txt', 'LPT³', 'COM¹.txt', 'COM²']) {
    assert.equal(safeName(name), `_${name}`);
  }
  for (const name of ['COM0', 'COM10', 'LPT0', 'lpt10', 'Auxiliary']) assert.equal(safeName(name), name);
});

test('safeName caps names without splitting UTF-16 pairs or exposing a trailing dot', () => {
  const stem = 'a'.repeat(119);
  assert.equal(safeName(stem + '📘x'), stem);
  assert.equal(safeName('a'.repeat(118) + '📘x'), 'a'.repeat(118) + '📘');
  assert.equal(safeName(stem + '.txt'), stem);
  assert.equal(safeName('CON.' + 'a'.repeat(120)), '_CON.' + 'a'.repeat(115));
});

test('uniqueName selects the first free suffix without changing the input', () => {
  const taken = Object.freeze(['notes', 'NOTES (2)', 'Notes (4)']);
  assert.equal(uniqueName('Notes', taken), 'Notes (3)');
  assert.equal(uniqueName('Draft', taken), 'Draft');
  assert.equal(uniqueName('Notes', ['NOTES']), 'Notes (2)');
});

test('uniqueName keeps the suffix and avoids splitting a surrogate pair at the limit', () => {
  const base = 'x'.repeat(115) + '📘end';
  assert.equal(uniqueName(base, [base]), 'x'.repeat(115) + ' (2)');
});

test('an Android filename and its collision suffix fit within 255 UTF-8 bytes', () => {
  const name = '語'.repeat(85);
  assert.equal(safeName(name + '次'), name);
  assert.equal(safeName('語'.repeat(83) + '📘last'), '語'.repeat(83) + '📘la');
  assert.equal(uniqueName(name, [name]), '語'.repeat(83) + ' (2)');
});

test('caseOnlyRename needs different spellings with the same case-insensitive name', () => {
  assert.equal(caseOnlyRename('notes', 'Notes'), true);
  assert.equal(caseOnlyRename('ÉTUDE', 'étude'), true);
  assert.equal(caseOnlyRename('Notes', 'Notes'), false);
  assert.equal(caseOnlyRename('Notes', 'Notes (2)'), false);
});

test('renamePlan cleans the target, handles existing siblings, and skips no-ops', () => {
  const taken = Object.freeze(['Draft', 'UNIT ONE', 'Unit one (2)']);
  assert.deepEqual(renamePlan('Draft', ' Unit:one... ', taken), [['Draft', 'Unit one (3)']]);
  assert.deepEqual(renamePlan('Draft', 'Draft', taken), []);
  assert.deepEqual(renamePlan('Draft', ' Draft... ', taken), []);
  assert.deepEqual(renamePlan('notes', 'Notes', ['notes', 'Notes']), [['notes', 'Notes (2)']]);
});

test('renamePlan keeps a long case-only temporary name within the same length limit', () => {
  const from = 'a'.repeat(120);
  const to = 'A' + 'a'.repeat(119);
  const tmp = 'a'.repeat(111) + '.renaming';
  assert.deepEqual(renamePlan(from, to, [from]), [[from, tmp], [tmp, to]]);
});

test('a collision on a long temporary name leaves the renaming marker intact', () => {
  const from = 'a'.repeat(120);
  const to = 'A' + 'a'.repeat(119);
  const occupied = 'a'.repeat(111) + '.renaming';
  const tmp = 'a'.repeat(107) + '.renaming (2)';
  assert.deepEqual(renamePlan(from, to, [from, occupied]), [[from, tmp], [tmp, to]]);
});

test('ordinal case matching recognizes both lowercase forms of Greek sigma', () => {
  assert.equal(caseOnlyRename('ΟΣ', 'οσ'), true);
  assert.equal(uniqueName('οσ', ['ΟΣ']), 'οσ (2)');
  assert.deepEqual(renamePlan('Draft', 'οσ', ['Draft', 'ΟΣ']), [['Draft', 'οσ (2)']]);
  assert.deepEqual(renamePlan('ΟΣ', 'οσ', ['ΟΣ']), [['ΟΣ', 'ΟΣ.renaming'], ['ΟΣ.renaming', 'οσ']]);
  assert.equal(caseOnlyRename('Straße', 'STRASSE'), false);
});

test('a case-only plan can be applied without overwriting any library sibling', () => {
  const payload = { pages: 5 };
  const files = new Map([['notes', payload], ['NOTES.renaming', 'another note'], ['Draft', 'keep me']]);
  const taken = [...files.keys()];
  const plan = renamePlan('notes', 'Notes', taken);
  assert.deepEqual(plan, [['notes', 'notes.renaming (2)'], ['notes.renaming (2)', 'Notes']]);
  for (const [from, to] of plan) {
    assert.ok(files.has(from));
    assert.ok(![...files.keys()].some((name) => name.toLowerCase() === to.toLowerCase()));
    const item = files.get(from);
    files.delete(from);
    files.set(to, item);
  }
  assert.deepEqual([...files], [['NOTES.renaming', 'another note'], ['Draft', 'keep me'], ['Notes', payload]]);
  assert.deepEqual(taken, ['notes', 'NOTES.renaming', 'Draft']);
});
