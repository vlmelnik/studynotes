'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createHash } = require('node:crypto');
const { md5Hex, sha1Hex, sha256Hex } = require('../../../src/shared/hash');

const hashes = { md5: md5Hex, sha1: sha1Hex, sha256: sha256Hex };
const native = (algorithm, input) => createHash(algorithm).update(input).digest('hex');

test('MD5, SHA-1 and SHA-256 match standard vectors', () => {
  const vectors = [
    ['', [
      'd41d8cd98f00b204e9800998ecf8427e',
      'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ]],
    ['abc', [
      '900150983cd24fb0d6963f7d28e17f72',
      'a9993e364706816aba3e25717850c26c9cd0d89d',
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ]],
    ['The quick brown fox jumps over the lazy dog', [
      '9e107d9d372bb6826bd81d3542a419d6',
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ]],
  ];
  for (const [input, expected] of vectors) {
    assert.deepStrictEqual(Object.values(hashes).map((hash) => hash(input)), expected);
  }
});

test('padding boundaries and byte offsets agree with Node crypto', () => {
  const source = Uint8Array.from({ length: 80 }, (_, i) => i * 73);
  const original = source.slice();
  for (const length of [55, 56, 63, 64, 65]) {
    const input = source.subarray(7, 7 + length);
    for (const [algorithm, hash] of Object.entries(hashes)) {
      assert.strictEqual(hash(input), native(algorithm, input), algorithm + ' at ' + length + ' bytes');
    }
  }
  assert.deepStrictEqual(source, original);
});

test('strings use UTF-8 for multibyte characters and unmatched surrogates', () => {
  const input = 'Café notes — 𝄞 \ud800x\udc00';
  const bytes = new Uint8Array([
    0x43, 0x61, 0x66, 0xc3, 0xa9, 0x20, 0x6e, 0x6f, 0x74, 0x65, 0x73, 0x20, 0xe2, 0x80, 0x94,
    0x20, 0xf0, 0x9d, 0x84, 0x9e, 0x20, 0xef, 0xbf, 0xbd, 0x78, 0xef, 0xbf, 0xbd,
  ]);
  for (const [algorithm, hash] of Object.entries(hashes)) {
    assert.strictEqual(hash(input), native(algorithm, bytes), algorithm);
  }
});

test('one mebibyte agrees with Node crypto and reports digest timings', (t) => {
  const input = Uint8Array.from({ length: 1024 * 1024 }, (_, i) => i * 29);
  for (const [algorithm, hash] of Object.entries(hashes)) {
    const start = performance.now();
    const digest = hash(input);
    const duration = performance.now() - start;
    assert.strictEqual(digest, native(algorithm, input), algorithm);
    t.diagnostic(algorithm + ' on 1 MiB: ' + duration.toFixed(1) + ' ms');
  }
});
