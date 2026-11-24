'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeHost, load } = require('./fake-host');

const context = (mode, pageKind = 'pdf', effect = true, isExternal = false) => ({ pageKind, effect, isExternal,
  settings: { get: (key, fallback) => key === 'mode' ? mode ?? fallback : fallback } });

async function setup() {
  const ext = await load('dark-view');
  const host = fakeHost('dark-view');
  ext.activate(host);
  return { ext, host };
}

test('Dark View is opt-in and an unknown notebook mode does no canvas readback', async () => {
  const { ext, host } = await setup();
  assert.equal(ext.defaultEnabled, false);
  for (const mode of [undefined, 'off', 'future-mode']) {
    await host.view.runPagePasses({ ...context(mode), ctx: { getImageData() { assert.fail('read pixels with Dark View off'); } } });
  }
});

test('one extension uses the current mode of each rendering notebook', async () => {
  const { host } = await setup();
  const run = async (mode) => {
    const im = { width: 3, height: 1, data: new Uint8ClampedArray([255,255,255,255, 0,0,0,255, 12,60,140,255]) };
    await host.view.runPagePasses({ ...context(mode), canvas: { width: 3, height: 1 }, ctx: { getImageData: () => im, putImageData() {} }, imageRegions: [{ x0: 2, y0: 0, x1: 3, y1: 1 }] });
    return [...im.data];
  };
  assert.deepEqual(await run('full'), [31,31,31,255, 224,224,224,255, 12,60,140,255]);
  assert.deepEqual(await run('background'), [30,30,30,255, 0,0,0,255, 12,60,140,255]);
  assert.deepEqual(await run('off'), [255,255,255,255, 0,0,0,255, 12,60,140,255]);
});

test('the View menu changes and refreshes only the notebook it was opened from', async () => {
  const { host } = await setup();
  const a = fakeHost('dark-view').settings.notebook;
  const b = fakeHost('dark-view', { notebook: { mode: 'background' } }).settings.notebook;
  let refreshesA = 0;
  const ctx = { notebookSettings: a, refreshView: () => { refreshesA++; } };
  const items = host.menus.visible('view', ctx);
  assert.equal(host.menus.visible('view', { ...ctx, isExternal: true }).length, 0);
  const full = items.find((i) => i.id === 'full');
  assert.equal(items.find((i) => i.checked(ctx)).id, 'off');
  full.run(ctx);
  assert.equal(items.find((i) => i.checked(ctx)).id, 'full');
  assert.equal(a.get('mode'), 'full');
  assert.equal(b.get('mode'), 'background');
  assert.equal(refreshesA, 1);
  full.run(ctx);
  assert.equal(refreshesA, 1, 'choosing the current mode does not redraw');
});

test('only a PDF with Dark View on has lighter ink and screen blending', async () => {
  const { host } = await setup();
  for (const ctx of [context('full'), context('background')]) {
    assert.equal(host.calls.ink('#000000', ctx), '#e0e0e0');
    assert.equal(host.calls.blend(ctx), 'screen');
  }
  for (const ctx of [context('off'), context('future-mode'), context('full', 'paper'), context('full', 'board'),
    context('full', 'pdf', false), context('full', 'pdf', true, true)]) {
    assert.equal(host.calls.ink('#000000', ctx), '#000000');
    assert.equal(host.calls.blend(ctx), null);
  }
});
