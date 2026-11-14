'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CloudSync } = require('../../../src/main/cloud');

// Google reading: two calls at the same time must not overlap, or the
// clean-up at the start of the second deletes the temporary docs of the first.
test('cloud: Google text reading runs one call at a time', async () => {
  const c = new CloudSync({ userData: '/tmp', libraryRoot: () => '/tmp', getConfig: () => ({}), electron: {}, onStatus: () => {}, openNotebooks: () => [] });
  let active = 0, most = 0, cleanups = 0;
  const remote = {
    ocrCleanup: async () => { cleanups++; },
    ocrImage: async (buf) => { active++; most = Math.max(most, active); await new Promise((r) => setTimeout(r, 20)); active--; return 'text ' + buf[0]; },
  };
  c.ocrRemote = async () => remote;
  // a call that fails does not block the next one
  const [a, b] = await Promise.allSettled([c.ocrImages([new Uint8Array([1]), new Uint8Array([2])]), c.ocrImages([new Uint8Array([3])])]);
  assert.deepStrictEqual(a.value, ['text 1', 'text 2']);
  assert.deepStrictEqual(b.value, ['text 3']);
  remote.ocrImage = async () => { throw new Error('offline'); };
  await assert.rejects(c.ocrImages([new Uint8Array([4])]), /offline/);
  remote.ocrImage = async () => 'ok';
  assert.deepStrictEqual(await c.ocrImages([new Uint8Array([5])]), ['ok']);
  // (the first call alone used two parallel requests; never mixed with the second call)
  assert.ok(most <= 2, `at most the parallel requests of one call, got ${most}`);
  assert.strictEqual(cleanups, 4);
});
