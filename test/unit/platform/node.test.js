'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNodePlatform } = require('../../../src/platform/node');
const contract = require('./contract');

// Each test gets a fresh temp folder as library root, removed afterwards.
async function makePlatform() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sn-platform-'));
  return {
    platform: createNodePlatform(root),
    cleanup: () => fs.promises.rm(root, { recursive: true, force: true }),
    root,
  };
}

contract('node', makePlatform);

test('node: files land under the root at the expected place, nothing outside', async () => {
  const { platform, cleanup, root } = await makePlatform();
  try {
    await platform.fs.writeAtomic('Übung/Заметки/note 1.json', 'x');
    assert.strictEqual(fs.readFileSync(path.join(root, 'Übung', 'Заметки', 'note 1.json'), 'utf8'), 'x');
    await assert.rejects(platform.fs.writeAtomic('../escape.txt', 'x'));
    assert.strictEqual(fs.existsSync(path.join(path.dirname(root), 'escape.txt')), false);
  } finally { await cleanup(); }
});

test('node: a missing root folder lists as empty and is created by the first write', async () => {
  const { cleanup, root } = await makePlatform();
  try {
    const p = createNodePlatform(path.join(root, 'not', 'yet'));
    assert.deepStrictEqual(await p.fs.list(''), []);
    assert.strictEqual(await p.fs.stat(''), null);
    await p.fs.writeAtomic('a.json', '{}');
    assert.strictEqual((await p.fs.stat('')).dir, true);
  } finally { await cleanup(); }
});

test('node: a failed write leaves the old file and no temp file', async () => {
  const { platform, cleanup, root } = await makePlatform();
  try {
    await platform.fs.writeAtomic('d/f.json', 'old');
    // Writing a file over a non-empty folder fails at the final rename.
    await platform.fs.mkdirp('d/sub/x');
    await assert.rejects(platform.fs.writeAtomic('d/sub', 'new'));
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'd')).sort(), ['f.json', 'sub']);
    assert.strictEqual(fs.readFileSync(path.join(root, 'd', 'f.json'), 'utf8'), 'old');
  } finally { await cleanup(); }
});

test('node: symlinks are not listed (like the existing sync and library code)', { skip: process.platform === 'win32' && 'symlinks need rights on Windows' }, async () => {
  const { platform, cleanup, root } = await makePlatform();
  try {
    await platform.fs.writeAtomic('real.txt', 'x');
    fs.symlinkSync(path.join(root, 'real.txt'), path.join(root, 'link.txt'));
    assert.deepStrictEqual((await platform.fs.list('')).map((e) => e.name), ['real.txt']);
  } finally { await cleanup(); }
});
