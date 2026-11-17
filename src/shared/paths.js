'use strict';
// Library-relative paths, POSIX style ('Physics/Mechanics/notebook.json').
// '' is the library root. Pure string code with no Node `path` module, so the
// same rules apply on the desktop, in tests and in the Android WebView.
//
// normalize() is the single gate every platform adapter passes paths through:
// anything that could leave the library (absolute paths, '..' above the root,
// backslashes that Windows reads as separators, NUL bytes) is refused there.

function fail(p, why) {
  throw new Error(`Invalid library path ${JSON.stringify(String(p))}: ${why}`);
}

/**
 * Collapse '.', empty segments ('a//b', trailing '/') and 'x/..' pairs.
 * Throws when the path is not a string, is absolute, contains a backslash or
 * a NUL character, or climbs above the root with '..'.
 * @param {string} p
 * @returns {string} normalized path, '' for the root
 */
function normalize(p) {
  if (typeof p !== 'string') fail(p, 'not a string');
  if (p.includes('\u0000')) fail(p, 'contains a NUL character');
  if (p.includes('\\')) fail(p, 'contains a backslash (use "/")');
  if (p.startsWith('/')) fail(p, 'absolute paths are not allowed');
  // "C:foo" / "C:/foo" would be a drive path on Windows.
  if (/^[A-Za-z]:/.test(p)) fail(p, 'drive paths are not allowed');
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) fail(p, 'leaves the library root');
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

/** Join parts with '/' and normalize. Empty parts are skipped. */
function join(...parts) {
  return normalize(parts.filter((x) => x !== '').join('/'));
}

/** Parent folder: 'a/b/c' -> 'a/b', 'a' -> '', '' -> ''. */
function dirname(p) {
  const n = normalize(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : n.slice(0, i);
}

/** Last segment: 'a/b.json' -> 'b.json', '' -> ''. */
function basename(p) {
  const n = normalize(p);
  return n.slice(n.lastIndexOf('/') + 1);
}

/** Extension with the dot: 'a/b.json' -> '.json'; '.view' and 'README' -> '' (like Node). */
function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}

/**
 * True when `child` is `parent` itself or lies below it ('' contains
 * everything). Compares whole segments, so 'ab' is not inside 'a'.
 */
function isInside(parent, child) {
  const p = normalize(parent);
  const c = normalize(child);
  return p === '' || c === p || c.startsWith(p + '/');
}

module.exports = { normalize, join, dirname, basename, extname, isInside };
