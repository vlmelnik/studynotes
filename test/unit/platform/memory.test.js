'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createMemoryPlatform, md5Hex, sha256Hex } = require('../../../src/platform/memory');
const contract = require('./contract');

contract('memory', async () => ({ platform: createMemoryPlatform() }));

test('memory: injected clock and ids are used', async () => {
  let t = 1000;
  let n = 0;
  const P = createMemoryPlatform({ now: () => t, uuid: () => `id-${++n}` });
  await P.fs.writeAtomic('a/b.json', 'x');
  assert.strictEqual((await P.fs.stat('a/b.json')).mtimeMs, 1000);
  t = 2000;
  await P.fs.writeAtomic('a/b.json', 'y');
  assert.strictEqual((await P.fs.stat('a/b.json')).mtimeMs, 2000);
  assert.strictEqual((await P.fs.stat('a')).mtimeMs, 1000, 'the folder keeps its creation time');
  assert.strictEqual(P.now(), 2000);
  assert.deepStrictEqual([P.uuid(), P.uuid()], ['id-1', 'id-2']);
  await P.fs.rename('a/b.json', 'c.json');
  assert.strictEqual((await P.fs.stat('c.json')).mtimeMs, 2000, 'rename keeps the mtime');
});

test('memory: pure-JS md5 and sha256 match Node crypto for many lengths', () => {
  // Lengths around the 55/56/64-byte padding edges and several blocks.
  for (const len of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 4097]) {
    const b = crypto.randomBytes(len);
    const bytes = new Uint8Array(b.buffer, b.byteOffset, b.length);
    assert.strictEqual(md5Hex(bytes), crypto.createHash('md5').update(b).digest('hex'), `md5 len ${len}`);
    assert.strictEqual(sha256Hex(bytes), crypto.createHash('sha256').update(b).digest('hex'), `sha256 len ${len}`);
  }
  assert.strictEqual(md5Hex('Заметки'), crypto.createHash('md5').update('Заметки', 'utf8').digest('hex'));
});

test('memory: works without Node globals or WebCrypto (as in a plain WebView)', async () => {
  // Load memory.js and paths.js into a bare VM context: no require of Node
  // modules, no Node byte buffers, no process, no globalThis.crypto. This also
  // exercises the pure-JS SHA-256 and the fallback uuid.
  const vm = require('vm');
  const fs = require('fs');
  const path = require('path');
  const srcDir = path.join(__dirname, '..', '..', '..', 'src');
  const ctx = vm.createContext({ TextEncoder, TextDecoder });
  const load = (rel, requireFn) => {
    const module = { exports: {} };
    const code = fs.readFileSync(path.join(srcDir, rel), 'utf8');
    vm.runInContext(`(function (module, exports, require) {${code}\n})`, ctx)(module, module.exports, requireFn);
    return module.exports;
  };
  const paths = load('shared/paths.js', (m) => { throw new Error('paths.js may not require ' + m); });
  const mem = load('platform/memory.js', (m) => {
    if (m === '../shared/paths') return paths;
    throw new Error('memory.js may not require ' + m);
  });
  assert.strictEqual(vm.runInContext('typeof crypto + typeof Buffer + typeof process', ctx), 'undefinedundefinedundefined');
  const P = mem.createMemoryPlatform();
  await P.fs.writeAtomic('Übung/x.json', '{"ok":true}');
  assert.strictEqual(await P.fs.readText('Übung/x.json'), '{"ok":true}');
  assert.strictEqual(await P.hash.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.strictEqual(await P.hash.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.match(P.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
