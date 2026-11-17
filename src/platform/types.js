'use strict';
// The platform adapter: the only things the library, sync, backup and export
// logic may need from the device. Desktop uses Node fs (./node.js), tests and
// the browser use memory (./memory.js), Android will use Capacitor. The
// behaviour every implementation must show is pinned down by
// test/unit/platform/contract.js; these typedefs only describe the shape.
//
// Paths: every `p` below is a library-relative POSIX path ('' = the library
// root) and goes through src/shared/paths.js `normalize`. A path that escapes
// the root ('../x', '/abs', 'a/../../x', 'a\\b', NUL) makes the call reject;
// nothing is touched on disk. Methods that change something (writeAtomic,
// rename, remove, copy target) also refuse the root itself.
//
// Errors: a missing file rejects with an Error whose `code` is 'ENOENT'
// (readFile, readText, rename and copy sources). Other failures carry the
// usual Node-style codes where the platform provides them.

/**
 * @typedef {Object} PlatformEntry  one item of a folder listing
 * @property {string} name     file or folder name (no slashes)
 * @property {boolean} dir     true for a folder
 * @property {number} size     bytes; 0 for folders
 * @property {number} mtimeMs  last change, ms since 1970 (may have a fraction)
 */

/**
 * @typedef {Object} PlatformStat
 * @property {boolean} dir
 * @property {number} size     bytes; 0 for folders
 * @property {number} mtimeMs
 */

/**
 * @typedef {Object} PlatformFs
 * @property {(p: string) => Promise<Uint8Array>} readFile
 *   Whole file as a plain Uint8Array (not a Node Buffer).
 * @property {(p: string) => Promise<string>} readText
 *   Whole file decoded as UTF-8; a leading byte-order mark is dropped.
 * @property {(p: string, data: Uint8Array|string) => Promise<void>} writeAtomic
 *   Replaces the file in one step: a reader sees the old or the new content,
 *   never a half-written file, also after a crash. Strings are written as
 *   UTF-8. Creates missing parent folders. Concurrent writes to one path:
 *   one complete content wins. While a write runs, a `<name>.<…>.tmp` file
 *   may be visible next to the target (the sync code already ignores *.tmp).
 * @property {(dir: string) => Promise<PlatformEntry[]>} list
 *   Direct children sorted by name (plain code-unit order). A missing folder
 *   gives []. Only files and folders are listed (desktop: symlinks and other
 *   special entries are skipped).
 * @property {(p: string) => Promise<PlatformStat|null>} stat
 *   null when nothing exists at p.
 * @property {(p: string) => Promise<void>} mkdirp
 *   Creates the folder and its parents; an existing folder is fine.
 * @property {(from: string, to: string) => Promise<void>} rename
 *   Moves a file or folder. A file replaces an existing file at `to`; a
 *   folder may only move to a path that does not exist yet. Creates the
 *   parent folders of `to`.
 * @property {(p: string) => Promise<void>} remove
 *   Deletes a file, or a folder with everything in it. Missing: no error.
 * @property {(from: string, to: string) => Promise<void>} copy
 *   Copies a file (replacing an existing file at `to`, never leaving a
 *   half-written copy) or a folder with its contents (merged into `to`).
 *   Creates parent folders. The copy's mtime is not specified.
 */

/**
 * @typedef {Object} PlatformHash
 * @property {(bytes: Uint8Array|string) => Promise<string>} md5     lowercase hex; strings as UTF-8
 * @property {(bytes: Uint8Array|string) => Promise<string>} sha256  lowercase hex; strings as UTF-8
 */

/**
 * @typedef {Object} Platform
 * @property {PlatformFs} fs
 * @property {PlatformHash} hash
 * @property {() => string} uuid  random RFC 4122 version 4 id, lowercase
 * @property {() => number} now   current time in ms since 1970
 */

module.exports = {};
