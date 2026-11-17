'use strict';
// One behaviour contract for every platform adapter (src/platform/types.js).
// Each implementation's test file calls this with a factory; a new adapter
// (Android / Capacitor) must pass the same suite.
//
//   require('./contract')('memory', async () => ({ platform, cleanup }))

const test = require('node:test');
const assert = require('node:assert');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (s) => new TextEncoder().encode(s);

module.exports = function contract(name, makePlatform) {
  // Fresh platform per test; cleanup (if any) runs even when the test fails.
  const t = (title, fn) => test(`${name}: ${title}`, async () => {
    const { platform, cleanup } = await makePlatform();
    try { await fn(platform, platform.fs); } finally { if (cleanup) await cleanup(); }
  });

  t('round trip of bytes and text, non-ASCII names and content', async (P, fs) => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    await fs.writeAtomic('bin/data.bin', bytes);
    const back = await fs.readFile('bin/data.bin');
    assert.ok(back instanceof Uint8Array);
    assert.strictEqual(Object.getPrototypeOf(back), Uint8Array.prototype, 'a plain Uint8Array, not a Node Buffer');
    assert.deepStrictEqual([...back], [...bytes]);

    const name = 'Übung/Заметки/note 1.json';
    const text = '{"title":"Квантовая механика – Übung 1 ✓ 𝄞"}';
    await fs.writeAtomic(name, text);
    assert.strictEqual(await fs.readText(name), text);
    assert.deepStrictEqual([...(await fs.readFile(name))], [...enc(text)], 'strings are stored as UTF-8 without BOM');
    assert.deepStrictEqual((await fs.list('Übung')).map((e) => e.name), ['Заметки']);
    assert.deepStrictEqual((await fs.list('Übung/Заметки')).map((e) => e.name), ['note 1.json']);
  });

  t('readText drops a leading BOM; empty files work', async (P, fs) => {
    await fs.writeAtomic('bom.txt', new Uint8Array([0xef, 0xbb, 0xbf, 0x41]));
    assert.strictEqual(await fs.readText('bom.txt'), 'A');
    await fs.writeAtomic('empty', '');
    assert.strictEqual(await fs.readText('empty'), '');
    assert.strictEqual((await fs.readFile('empty')).length, 0);
    assert.strictEqual((await fs.stat('empty')).size, 0);
  });

  t('the returned bytes are not tied to the stored file', async (P, fs) => {
    const data = new Uint8Array([1, 2, 3]);
    await fs.writeAtomic('x', data);
    data[0] = 9; // caller edits its array after writing
    const r = await fs.readFile('x');
    r[1] = 9; // and the array it read
    assert.deepStrictEqual([...(await fs.readFile('x'))], [1, 2, 3]);
  });

  t('readFile / readText of a missing file reject with ENOENT', async (P, fs) => {
    await assert.rejects(fs.readFile('nope.json'), { code: 'ENOENT' });
    await assert.rejects(fs.readText('a/b/nope.json'), { code: 'ENOENT' });
  });

  t('writeAtomic creates parents and replaces existing content', async (P, fs) => {
    await fs.writeAtomic('a/b/c/file.txt', 'first version, longer');
    assert.strictEqual((await fs.stat('a/b')).dir, true);
    await fs.writeAtomic('a/b/c/file.txt', 'second');
    assert.strictEqual(await fs.readText('a/b/c/file.txt'), 'second');
    assert.deepStrictEqual((await fs.list('a/b/c')).map((e) => [e.name, e.size]), [['file.txt', 6]]);
    await assert.rejects(fs.writeAtomic('a/b', 'x'), 'a folder is not replaced by a file');
    await assert.rejects(fs.writeAtomic('a/b/c/file.txt/inner', 'x'), 'a file is not used as a folder');
    await assert.rejects(fs.writeAtomic('x', 42), TypeError);
    await assert.rejects(fs.writeAtomic('', 'x'), /library root/);
  });

  t('list: sorted, folder flag, sizes; missing folder gives []', async (P, fs) => {
    await fs.writeAtomic('lib/b.json', '12345');
    await fs.writeAtomic('lib/A.json', '1');
    await fs.writeAtomic('lib/a/inner.json', 'xx');
    await fs.mkdirp('lib/empty');
    await fs.writeAtomic('lib/.view.json', '{}');
    const l = await fs.list('lib');
    assert.deepStrictEqual(l.map((e) => [e.name, e.dir, e.size]), [
      ['.view.json', false, 2],
      ['A.json', false, 1],
      ['a', true, 0],
      ['b.json', false, 5],
      ['empty', true, 0],
    ]);
    for (const e of l) assert.ok(Number.isFinite(e.mtimeMs) && e.mtimeMs > 0, e.name);
    assert.deepStrictEqual(await fs.list('missing'), []);
    assert.deepStrictEqual(await fs.list('lib/missing/deeper'), []);
    assert.deepStrictEqual((await fs.list('')).map((e) => e.name), ['lib']);
    assert.deepStrictEqual(await fs.list('lib/'), l, 'paths are normalized');
    await assert.rejects(fs.list('lib/b.json'), { code: 'ENOTDIR' });
  });

  t('stat: file, folder, root; null when missing', async (P, fs) => {
    await fs.writeAtomic('d/f.txt', 'abc');
    const f = await fs.stat('d/f.txt');
    assert.strictEqual(f.dir, false);
    assert.strictEqual(f.size, 3);
    assert.ok(f.mtimeMs > 0);
    assert.strictEqual((await fs.stat('d')).dir, true);
    assert.strictEqual((await fs.stat('')).dir, true);
    assert.strictEqual(await fs.stat('d/missing'), null);
    assert.strictEqual(await fs.stat('d/f.txt/below'), null);
  });

  t('mkdirp: nested, idempotent, refuses a file in the way', async (P, fs) => {
    await fs.mkdirp('x/y/z');
    await fs.mkdirp('x/y/z');
    await fs.mkdirp('');
    assert.strictEqual((await fs.stat('x/y/z')).dir, true);
    assert.deepStrictEqual(await fs.list('x/y/z'), []);
    await fs.writeAtomic('x/file', '1');
    await assert.rejects(fs.mkdirp('x/file'));
    await assert.rejects(fs.mkdirp('x/file/sub'));
  });

  t('rename: file over an existing file, folder to a new place, parents created', async (P, fs) => {
    await fs.writeAtomic('r/new.json', 'NEW');
    await fs.writeAtomic('r/old.json', 'OLD content');
    await fs.rename('r/new.json', 'r/old.json');
    assert.strictEqual(await fs.readText('r/old.json'), 'NEW');
    assert.strictEqual(await fs.stat('r/new.json'), null);

    await fs.writeAtomic('nb/pages/p1.json', 'p1');
    await fs.writeAtomic('nb/notebook.json', '{}');
    await fs.rename('nb', 'Folder/Sub/nb2');
    assert.strictEqual(await fs.stat('nb'), null);
    assert.strictEqual(await fs.readText('Folder/Sub/nb2/pages/p1.json'), 'p1');
    assert.deepStrictEqual((await fs.list('Folder/Sub/nb2')).map((e) => e.name), ['notebook.json', 'pages']);

    await fs.rename('r/old.json', 'r/old.json'); // same path: nothing happens
    assert.strictEqual(await fs.readText('r/old.json'), 'NEW');
    await assert.rejects(fs.rename('r/missing', 'r/x'), { code: 'ENOENT' });
    await assert.rejects(fs.rename('Folder', 'Folder/Sub/inside'), { code: 'EINVAL' });
    await fs.mkdirp('other');
    await assert.rejects(fs.rename('Folder', 'other'), 'a folder does not replace an existing folder');
    await assert.rejects(fs.rename('r/old.json', 'other'), 'a file does not replace a folder');
    assert.strictEqual(await fs.readText('Folder/Sub/nb2/notebook.json'), '{}');
  });

  t('remove: non-empty folder, file, missing path', async (P, fs) => {
    await fs.writeAtomic('rm/a/b/c.txt', '1');
    await fs.writeAtomic('rm/a/d.txt', '2');
    await fs.writeAtomic('rm/keep.txt', '3');
    await fs.remove('rm/a');
    assert.strictEqual(await fs.stat('rm/a'), null);
    assert.strictEqual(await fs.stat('rm/a/b/c.txt'), null);
    assert.deepStrictEqual((await fs.list('rm')).map((e) => e.name), ['keep.txt']);
    await fs.remove('rm/keep.txt');
    assert.deepStrictEqual(await fs.list('rm'), [], 'the folder stays after its last file is removed');
    assert.strictEqual((await fs.stat('rm')).dir, true);
    await fs.remove('rm/missing');
    await fs.remove('nothing/here/at/all');
    await assert.rejects(fs.remove(''), /library root/);
  });

  t('copy: file (replacing) and folder with contents', async (P, fs) => {
    await fs.writeAtomic('src/notebook.json', '{"a":1}');
    await fs.writeAtomic('src/pages/p.json', 'page');
    await fs.copy('src/notebook.json', 'dst/one/copy.json');
    assert.strictEqual(await fs.readText('dst/one/copy.json'), '{"a":1}');
    await fs.writeAtomic('dst/two.json', 'old old old');
    await fs.copy('src/notebook.json', 'dst/two.json');
    assert.strictEqual(await fs.readText('dst/two.json'), '{"a":1}');

    await fs.copy('src', 'Copies/src copy');
    assert.strictEqual(await fs.readText('Copies/src copy/pages/p.json'), 'page');
    assert.strictEqual(await fs.readText('Copies/src copy/notebook.json'), '{"a":1}');
    assert.strictEqual(await fs.readText('src/pages/p.json'), 'page', 'the source is kept');
    await fs.writeAtomic('Copies/src copy/pages/p.json', 'changed');
    assert.strictEqual(await fs.readText('src/pages/p.json'), 'page', 'the copy is independent');

    await assert.rejects(fs.copy('src/missing', 'x'), { code: 'ENOENT' });
    await assert.rejects(fs.copy('src', 'src/inside'), { code: 'EINVAL' });
    const names = (await fs.list('dst')).map((e) => e.name);
    assert.deepStrictEqual(names, ['one', 'two.json'], 'no temp files left');
  });

  t('mtime grows on rewrite', async (P, fs) => {
    await fs.writeAtomic('m.txt', 'v1');
    const m1 = (await fs.stat('m.txt')).mtimeMs;
    await sleep(25);
    await fs.writeAtomic('m.txt', 'v2');
    const m2 = (await fs.stat('m.txt')).mtimeMs;
    assert.ok(m2 > m1, `${m2} > ${m1}`);
    assert.strictEqual((await fs.list('')).find((e) => e.name === 'm.txt').mtimeMs, m2);
  });

  t('path escapes are rejected by every method and touch nothing', async (P, fs) => {
    await fs.writeAtomic('in/file.txt', 'x');
    const bad = ['../x', '/abs', 'a/../../x', 'a\\b', '..', 'in/../../x', 'nul\u0000x'];
    const ok = 'in/file.txt';
    const calls = [
      ['readFile', (p) => fs.readFile(p)],
      ['readText', (p) => fs.readText(p)],
      ['writeAtomic', (p) => fs.writeAtomic(p, 'evil')],
      ['list', (p) => fs.list(p)],
      ['stat', (p) => fs.stat(p)],
      ['mkdirp', (p) => fs.mkdirp(p)],
      ['rename from', (p) => fs.rename(p, 'in/r')],
      ['rename to', (p) => fs.rename(ok, p)],
      ['remove', (p) => fs.remove(p)],
      ['copy from', (p) => fs.copy(p, 'in/c')],
      ['copy to', (p) => fs.copy(ok, p)],
    ];
    for (const p of bad) {
      for (const [m, call] of calls) {
        await assert.rejects(Promise.resolve().then(() => call(p)), /Invalid library path/, `${m}(${JSON.stringify(p)})`);
      }
    }
    assert.strictEqual(await fs.readText(ok), 'x');
    assert.deepStrictEqual((await fs.list('in')).map((e) => e.name), ['file.txt']);
    assert.deepStrictEqual((await fs.list('')).map((e) => e.name), ['in']);
  });

  t('md5 / sha256 of known vectors', async (P) => {
    const vec = {
      '': ['d41d8cd98f00b204e9800998ecf8427e', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      abc: ['900150983cd24fb0d6963f7d28e17f72', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      'The quick brown fox jumps over the lazy dog': ['9e107d9d372bb6826bd81d3542a419d6', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
    };
    for (const [s, [md5, sha]] of Object.entries(vec)) {
      assert.strictEqual(await P.hash.md5(enc(s)), md5, `md5(${s})`);
      assert.strictEqual(await P.hash.sha256(enc(s)), sha, `sha256(${s})`);
      assert.strictEqual(await P.hash.md5(s), md5, 'strings hash as UTF-8');
    }
    // Multi-block input with a length that crosses the 56-byte padding edge.
    const long = 'a'.repeat(1000);
    assert.strictEqual(await P.hash.md5(long), 'cabe45dcc9ae5b66ba86600cca6b8ba8');
    assert.strictEqual(await P.hash.sha256(long), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  t('uuid: version 4 format, unique', async (P) => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const u = P.uuid();
      assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      seen.add(u);
    }
    assert.strictEqual(seen.size, 200);
    assert.strictEqual(typeof P.now(), 'number');
  });

  t('concurrent writeAtomic to one path leaves one complete content and no temp file', async (P, fs) => {
    const versions = [];
    for (let i = 0; i < 12; i++) versions.push(String(i).repeat(20000 + i * 997)); // different lengths
    await fs.writeAtomic('c/notebook.json', 'start');
    await Promise.all(versions.map((v) => fs.writeAtomic('c/notebook.json', v)));
    const got = await fs.readText('c/notebook.json');
    assert.ok(versions.includes(got), `one of the written versions (got ${got.length} chars)`);
    assert.deepStrictEqual((await fs.list('c')).map((e) => e.name), ['notebook.json']);
    assert.strictEqual((await fs.stat('c/notebook.json')).size, got.length);
  });
};
