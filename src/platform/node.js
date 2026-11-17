'use strict';
// Desktop platform adapter: Node fs.promises + crypto under one library root.
// Behaviour is defined in ./types.js and checked by test/unit/platform/contract.js.

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const paths = require('../shared/paths');

// Same numbers as atomicWrite in src/main/library.js: Windows sync clients and
// antivirus scanners lock files for a moment, so a rename that fails with one
// of these codes is retried 8 times, waiting 50, 100, ... 400 ms.
const LOCK_CODES = ['EPERM', 'EBUSY', 'EACCES'];
const LOCK_ATTEMPTS = 8;
const LOCK_DELAY_MS = 50;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fsError(code, message) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  return err;
}

async function renameRetry(from, to) {
  let lastErr;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      if (!LOCK_CODES.includes(err.code)) break;
      await sleep(LOCK_DELAY_MS * (attempt + 1));
    }
  }
  throw lastErr;
}

// A Buffer would let callers use Buffer-only methods that do not exist on
// Android; hand out a plain Uint8Array view of the same memory instead.
function plainBytes(buf) {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function checkData(data) {
  if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
    throw new TypeError('writeAtomic: data must be a Uint8Array or a string');
  }
}

function hashHex(algo, bytes) {
  if (typeof bytes !== 'string' && !(bytes instanceof Uint8Array)) {
    throw new TypeError(`${algo}: expected a Uint8Array or a string`);
  }
  return crypto.createHash(algo).update(bytes).digest('hex'); // strings: UTF-8
}

/**
 * @param {string} rootDir  absolute or cwd-relative library folder (need not exist yet)
 * @returns {import('./types').Platform}
 */
function createNodePlatform(rootDir) {
  if (typeof rootDir !== 'string' || !rootDir) throw new Error('createNodePlatform: rootDir is required');
  const root = path.resolve(rootDir);

  // Library-relative path -> absolute path. normalize() already refuses
  // escapes; the prefix check is a second line of defence.
  function abs(p) {
    const n = paths.normalize(p);
    if (!n) return root;
    const a = path.join(root, ...n.split('/'));
    if (!a.startsWith(root + path.sep)) throw new Error('Path outside library: ' + p);
    return a;
  }

  // Same, for operations that change something: never the root itself.
  function absTarget(p, op) {
    const a = abs(p);
    if (a === root) throw new Error(`${op}: refusing to act on the library root`);
    return a;
  }

  async function statAbs(a) {
    try { return await fsp.stat(a); } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw err;
    }
  }

  const tmpName = (a) => `${a}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;

  // Fill a temp file next to `a` with `fill(tmp)`, then rename it over `a`.
  async function replaceVia(a, fill) {
    await fsp.mkdir(path.dirname(a), { recursive: true });
    const tmp = tmpName(a);
    try {
      await fill(tmp);
      await renameRetry(tmp, a);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  const fs = {
    async readFile(p) {
      return plainBytes(await fsp.readFile(abs(p)));
    },

    async readText(p) {
      // TextDecoder drops a leading BOM, like the memory and Android adapters.
      return new TextDecoder('utf-8').decode(await fsp.readFile(abs(p)));
    },

    async writeAtomic(p, data) {
      const a = absTarget(p, 'writeAtomic');
      checkData(data);
      await replaceVia(a, async (tmp) => {
        // Flush before the rename: after a power cut the file is then the old
        // or the new version, never empty or half written.
        const fh = await fsp.open(tmp, 'w');
        try {
          await fh.writeFile(data);
          await fh.sync();
        } finally {
          await fh.close();
        }
      });
    },

    async list(dir) {
      const a = abs(dir);
      let entries;
      try {
        entries = await fsp.readdir(a, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
      const out = [];
      for (const e of entries) {
        // Like the existing library and sync code: symlinks and other special
        // entries are not followed.
        if (!e.isFile() && !e.isDirectory()) continue;
        const st = await statAbs(path.join(a, e.name));
        if (!st) continue; // removed meanwhile
        out.push({ name: e.name, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs });
      }
      return out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    },

    async stat(p) {
      const st = await statAbs(abs(p));
      if (!st) return null;
      const dir = st.isDirectory();
      return { dir, size: dir ? 0 : st.size, mtimeMs: st.mtimeMs };
    },

    async mkdirp(p) {
      await fsp.mkdir(abs(p), { recursive: true });
    },

    async rename(from, to) {
      const a = absTarget(from, 'rename');
      const b = absTarget(to, 'rename');
      const src = await statAbs(a);
      if (!src) throw fsError('ENOENT', `no such file or directory, rename '${from}'`);
      if (a === b) return;
      if (paths.isInside(from, to)) throw fsError('EINVAL', `cannot move '${from}' into itself`);
      // Check up front so desktop and memory agree (POSIX would let a folder
      // replace an empty folder, Windows would not).
      const dst = await statAbs(b);
      if (dst && (src.isDirectory() || dst.isDirectory())) {
        throw fsError(dst.isDirectory() ? 'EISDIR' : 'EEXIST', `rename '${from}' -> '${to}': target exists`);
      }
      await fsp.mkdir(path.dirname(b), { recursive: true });
      await renameRetry(a, b);
    },

    async remove(p) {
      await fsp.rm(absTarget(p, 'remove'), { recursive: true, force: true });
    },

    async copy(from, to) {
      const a = abs(from);
      const b = absTarget(to, 'copy');
      const src = await statAbs(a);
      if (!src) throw fsError('ENOENT', `no such file or directory, copy '${from}'`);
      if (src.isDirectory()) {
        if (paths.isInside(from, to)) throw fsError('EINVAL', `cannot copy '${from}' into itself`);
        await fsp.mkdir(path.dirname(b), { recursive: true });
        await fsp.cp(a, b, { recursive: true, force: true });
        return;
      }
      const dst = await statAbs(b);
      if (dst && dst.isDirectory()) throw fsError('EISDIR', `copy '${from}' -> '${to}': target is a folder`);
      await replaceVia(b, (tmp) => fsp.copyFile(a, tmp));
    },
  };

  return {
    fs,
    hash: {
      md5: async (bytes) => hashHex('md5', bytes),
      sha256: async (bytes) => hashHex('sha256', bytes),
    },
    uuid: () => crypto.randomUUID(),
    now: () => Date.now(),
  };
}

module.exports = { createNodePlatform };
