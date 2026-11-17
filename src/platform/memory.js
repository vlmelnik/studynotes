'use strict';
// In-memory platform adapter for unit tests and the browser / WebView.
// Behaviour is defined in ./types.js and checked by test/unit/platform/contract.js.
//
// Must run without Node: no fs, path, os, crypto or Node byte buffers. Only
// TextEncoder / TextDecoder are required; globalThis.crypto is used when the
// host has it (random ids, SHA-256) and a pure-JS fallback otherwise. MD5 is
// not part of WebCrypto, so it is always computed here (Google Drive reports
// MD5 checksums, which the sync code compares against).

const paths = require('../shared/paths');

function fsError(code, message) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  return err;
}

const utf8 = new TextEncoder();

// Checked by tag, not instanceof: arrays made in another realm (an iframe,
// a vm context) have a different Uint8Array constructor.
const isBytes = (x) => ArrayBuffer.isView(x) && Object.prototype.toString.call(x) === '[object Uint8Array]';

function toBytes(data, what) {
  if (typeof data === 'string') return utf8.encode(data);
  if (isBytes(data)) return data;
  throw new TypeError(`${what}: expected a Uint8Array or a string`);
}

const hex = (words, littleEndian) => {
  let s = '';
  for (const w of words) {
    for (let i = 0; i < 4; i++) {
      const b = littleEndian ? (w >>> (8 * i)) & 0xff : (w >>> (24 - 8 * i)) & 0xff;
      s += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return s;
};

// Message padding shared by MD5 and SHA-256: 0x80, zeros, 64-bit bit length.
function pad(bytes, littleEndian) {
  const len = bytes.length;
  const total = (((len + 8) >>> 6) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  const lo = (len * 8) >>> 0;
  const hi = Math.floor(len / 0x20000000);
  if (littleEndian) { view.setUint32(total - 8, lo, true); view.setUint32(total - 4, hi, true); }
  else { view.setUint32(total - 8, hi); view.setUint32(total - 4, lo); }
  return view;
}

// ---------------------------------------------------------------- MD5 (RFC 1321)
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
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

/** MD5 of bytes (or a UTF-8 string) as lowercase hex. Synchronous, pure JS. */
function md5Hex(input) {
  const view = pad(toBytes(input, 'md5'), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getInt32(off + 4 * j, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      const s = MD5_S[(i >> 4) * 4 + (i & 3)];
      A = D; D = C; C = B;
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  return hex([a0, b0, c0, d0], true);
}

// ---------------------------------------------------------------- SHA-256 (FIPS 180-4)
const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 of bytes (or a UTF-8 string) as lowercase hex. Synchronous, pure JS. */
function sha256Hex(input) {
  const view = pad(toBytes(input, 'sha256'), false);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Int32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getInt32(off + 4 * t);
    for (let t = 16; t < 64; t++) {
      const x = W[t - 15], y = W[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[t] + W[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return hex(H, false);
}

// ---------------------------------------------------------------- ids

function randomBytes16() {
  const c = globalThis.crypto;
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); // last resort, not for secrets
  return b;
}

function randomUuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = randomBytes16();
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  let s = '';
  for (let i = 0; i < 16; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16) + ([3, 5, 7, 9].includes(i) ? '-' : '');
  return s;
}

// ---------------------------------------------------------------- platform

/**
 * @param {{ now?: () => number, uuid?: () => string }} [opts]  injectable clock and id source
 * @returns {import('./types').Platform & { _files: Map, _dirs: Map }}
 */
function createMemoryPlatform({ now = () => Date.now(), uuid = randomUuid } = {}) {
  // Every folder is recorded explicitly (also the parents created by a write),
  // so a folder stays after its last file is removed, as on a real disk.
  // The root '' always exists.
  const files = new Map(); // path -> { data: Uint8Array, mtimeMs }
  const dirs = new Map();  // path -> { mtimeMs }

  const isDir = (n) => n === '' || dirs.has(n);
  const under = (n, k) => k === n || k.startsWith(n + '/');

  function target(p, op) {
    const n = paths.normalize(p);
    if (!n) throw new Error(`${op}: refusing to act on the library root`);
    return n;
  }

  // Create the folder n and its parents; a file on the way is an error.
  function ensureDir(n) {
    if (!n) return;
    const segs = n.split('/');
    for (let i = 1; i <= segs.length; i++) {
      const d = segs.slice(0, i).join('/');
      if (files.has(d)) throw fsError(i === segs.length ? 'EEXIST' : 'ENOTDIR', `not a folder: '${d}'`);
      if (!dirs.has(d)) dirs.set(d, { mtimeMs: now() });
    }
  }

  function getFile(n, p) {
    const f = files.get(n);
    if (f) return f;
    if (isDir(n)) throw fsError('EISDIR', `is a folder: '${p}'`);
    throw fsError('ENOENT', `no such file or directory: '${p}'`);
  }

  // Everything at or below n: [[path, entry, isDir]].
  function subtree(n) {
    const out = [];
    for (const [k, v] of dirs) if (under(n, k)) out.push([k, v, true]);
    for (const [k, v] of files) if (under(n, k)) out.push([k, v, false]);
    return out;
  }

  const fs = {
    async readFile(p) {
      return getFile(paths.normalize(p), p).data.slice(); // a copy: callers may not edit the store
    },

    async readText(p) {
      return new TextDecoder('utf-8').decode(getFile(paths.normalize(p), p).data);
    },

    async writeAtomic(p, data) {
      const n = target(p, 'writeAtomic');
      const bytes = toBytes(data, 'writeAtomic').slice();
      if (isDir(n)) throw fsError('EISDIR', `is a folder: '${p}'`);
      ensureDir(paths.dirname(n));
      files.set(n, { data: bytes, mtimeMs: now() }); // one synchronous step: atomic by nature
    },

    async list(dir) {
      const n = paths.normalize(dir);
      if (files.has(n)) throw fsError('ENOTDIR', `not a folder: '${dir}'`);
      if (!isDir(n)) return [];
      const out = [];
      const prefix = n ? n + '/' : '';
      const child = (k) => k.startsWith(prefix) && k.length > prefix.length && !k.includes('/', prefix.length);
      for (const [k, v] of dirs) if (child(k)) out.push({ name: k.slice(prefix.length), dir: true, size: 0, mtimeMs: v.mtimeMs });
      for (const [k, v] of files) if (child(k)) out.push({ name: k.slice(prefix.length), dir: false, size: v.data.length, mtimeMs: v.mtimeMs });
      return out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    },

    async stat(p) {
      const n = paths.normalize(p);
      const f = files.get(n);
      if (f) return { dir: false, size: f.data.length, mtimeMs: f.mtimeMs };
      if (n === '') return { dir: true, size: 0, mtimeMs: 0 };
      const d = dirs.get(n);
      return d ? { dir: true, size: 0, mtimeMs: d.mtimeMs } : null;
    },

    async mkdirp(p) {
      ensureDir(paths.normalize(p));
    },

    async rename(from, to) {
      const a = target(from, 'rename');
      const b = target(to, 'rename');
      const srcIsDir = dirs.has(a);
      if (!srcIsDir && !files.has(a)) throw fsError('ENOENT', `no such file or directory, rename '${from}'`);
      if (a === b) return;
      if (paths.isInside(a, b)) throw fsError('EINVAL', `cannot move '${from}' into itself`);
      const dstIsDir = dirs.has(b);
      if ((srcIsDir || dstIsDir) && (dstIsDir || files.has(b))) {
        throw fsError(dstIsDir ? 'EISDIR' : 'EEXIST', `rename '${from}' -> '${to}': target exists`);
      }
      ensureDir(paths.dirname(b));
      const moved = subtree(a);
      for (const [k, , d] of moved) (d ? dirs : files).delete(k);
      for (const [k, v, d] of moved) (d ? dirs : files).set(b + k.slice(a.length), v); // mtime kept, as on disk
    },

    async remove(p) {
      const n = target(p, 'remove');
      for (const [k, , d] of subtree(n)) (d ? dirs : files).delete(k);
    },

    async copy(from, to) {
      const a = paths.normalize(from);
      const b = target(to, 'copy');
      if (!isDir(a)) {
        const f = getFile(a, from);
        if (isDir(b)) throw fsError('EISDIR', `copy '${from}' -> '${to}': target is a folder`);
        ensureDir(paths.dirname(b));
        files.set(b, { data: f.data.slice(), mtimeMs: now() });
        return;
      }
      if (paths.isInside(a, b)) throw fsError('EINVAL', `cannot copy '${from}' into itself`);
      if (files.has(b)) throw fsError('EEXIST', `copy '${from}' -> '${to}': target is a file`);
      ensureDir(b);
      const rebase = (k) => b + k.slice(a.length); // a is never the root here (isInside above)
      for (const [k, , d] of subtree(a)) {
        if (k === a) continue;
        if (d) ensureDir(rebase(k));
        else files.set(rebase(k), { data: files.get(k).data.slice(), mtimeMs: now() });
      }
    },
  };

  async function sha256(bytes) {
    const data = toBytes(bytes, 'sha256');
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    // WebCrypto exists only in secure contexts; fall back to pure JS elsewhere.
    if (subtle) return bufHex(await subtle.digest('SHA-256', data));
    return sha256Hex(data);
  }

  return {
    fs,
    hash: { md5: async (bytes) => md5Hex(bytes), sha256 },
    uuid,
    now,
    // For tests only: the raw store.
    _files: files,
    _dirs: dirs,
  };
}

function bufHex(result) {
  let s = '';
  for (const b of new Uint8Array(result)) s += (b < 16 ? '0' : '') + b.toString(16);
  return s;
}

module.exports = { createMemoryPlatform, md5Hex, sha256Hex };
