'use strict';

const BLOCK_BYTES = 64;

function encodeUtf8(text) {
  // Three bytes per UTF-16 unit also leaves room for four-byte surrogate pairs.
  const bytes = new Uint8Array(text.length * 3);
  let end = 0;
  for (let i = 0; i < text.length; i++) {
    let code = text.codePointAt(i);
    if (code > 0xffff) i++;
    else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;

    if (code < 0x80) {
      bytes[end++] = code;
    } else {
      if (code < 0x800) {
        bytes[end++] = 0xc0 | (code >>> 6);
      } else {
        if (code < 0x10000) {
          bytes[end++] = 0xe0 | (code >>> 12);
        } else {
          bytes[end++] = 0xf0 | (code >>> 18);
          bytes[end++] = 0x80 | ((code >>> 12) & 0x3f);
        }
        bytes[end++] = 0x80 | ((code >>> 6) & 0x3f);
      }
      bytes[end++] = 0x80 | (code & 0x3f);
    }
  }
  return bytes.subarray(0, end);
}

function visitBlocks(input, littleEndian, compress) {
  const bytes = typeof input === 'string' ? encodeUtf8(input) : input;
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]') {
    throw new TypeError('Expected a Uint8Array or a string');
  }

  // Read complete blocks from the original view and copy only the final partial block.
  const remainder = bytes.length % BLOCK_BYTES;
  const complete = bytes.length - remainder;
  const body = new DataView(bytes.buffer, bytes.byteOffset, complete);
  for (let offset = 0; offset < complete; offset += BLOCK_BYTES) compress(body, offset);

  const tail = new Uint8Array(remainder < BLOCK_BYTES - 8 ? BLOCK_BYTES : BLOCK_BYTES * 2);
  tail.set(bytes.subarray(complete));
  tail[remainder] = 0x80;

  // The bit length occupies two words. MD5 writes the low word first.
  const view = new DataView(tail.buffer);
  const low = (bytes.length * 8) >>> 0;
  const high = Math.floor(bytes.length / 0x20000000);
  view.setUint32(tail.length - 8, littleEndian ? low : high, littleEndian);
  view.setUint32(tail.length - 4, littleEndian ? high : low, littleEndian);
  for (let offset = 0; offset < tail.length; offset += BLOCK_BYTES) compress(view, offset);
}

function hex(words, littleEndian) {
  let result = '';
  for (const word of words) {
    for (let i = 0; i < 4; i++) {
      const shift = littleEndian ? 8 * i : 24 - 8 * i;
      const byte = (word >>> shift) & 0xff;
      result += byte.toString(16).padStart(2, '0');
    }
  }
  return result;
}

const rotl = (x, n) => (x << n) | (x >>> (32 - n));
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

// RFC 1321 round constants, as used by the memory platform adapter.
const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];
const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

function md5Hex(input) {
  // Signed 32-bit array writes keep accumulated words modulo 2^32.
  const state = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  const words = new Int32Array(16);
  visitBlocks(input, true, (view, offset) => {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + 4 * i, true);
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      let mix, word;
      if (i < 16) {
        mix = (b & c) | (~b & d);
        word = i;
      } else if (i < 32) {
        mix = (d & b) | (~d & c);
        word = (5 * i + 1) & 15;
      } else if (i < 48) {
        mix = b ^ c ^ d;
        word = (3 * i + 5) & 15;
      } else {
        mix = c ^ (b | ~d);
        word = (7 * i) & 15;
      }
      const shift = MD5_SHIFTS[(i >>> 4) * 4 + (i & 3)];
      const next = (b + rotl((a + mix + MD5_K[i] + words[word]) | 0, shift)) | 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
  });
  return hex(state, true);
}

const SHA1_K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

function sha1Hex(input) {
  const state = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const words = new Int32Array(80);
  visitBlocks(input, false, (view, offset) => {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + 4 * i);
    for (let i = 16; i < 80; i++) words[i] = rotl(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);

    let [a, b, c, d, e] = state;
    for (let i = 0; i < 80; i++) {
      let mix;
      if (i < 20) mix = (b & c) | (~b & d);
      else if (i >= 40 && i < 60) mix = (b & c) | (b & d) | (c & d);
      else mix = b ^ c ^ d;
      const next = (rotl(a, 5) + mix + e + SHA1_K[Math.floor(i / 20)] + words[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = next;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
  });
  return hex(state, false);
}

// FIPS 180-4 SHA-256 constants, as used by the memory platform adapter.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(input) {
  const state = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Int32Array(64);
  visitBlocks(input, false, (view, offset) => {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + 4 * i);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      words[i] = words[i - 16] + s0 + words[i - 7] + s1;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choose + SHA256_K[i] + words[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
  });
  return hex(state, false);
}

module.exports = { md5Hex, sha1Hex, sha256Hex };
