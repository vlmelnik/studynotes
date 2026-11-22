'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakeHost } = require('./fake-host');

test('the fake host records what an extension registers and behaves like the app', async () => {
  const host = fakeHost('demo', { settings: { on: true } });
  const ext = {
    id: 'demo', apiVersion: 1,
    activate(h) {
      h.paste.addTransform(({ text }) => (text === 'x' ? { html: h.inline.html('demo:val', 'x<1') } : null));
      h.paste.addTransform(() => ({ html: 'late' }), { priority: -1 });
      h.inline.register('demo:val', { render() {}, toText: (v) => `[${v}]` });
      h.menus.add('textbox-more', { label: 'Do', when: (c) => !!c.textbox, run() {} });
    },
  };
  ext.activate(host);
  assert.deepStrictEqual(host.paste.run({ html: '', text: 'x' }), { html: '<span data-x="demo:val" data-v="x&lt;1">[x&lt;1]</span>' });
  assert.deepStrictEqual(host.paste.run({ html: '', text: 'y' }), { html: 'late' });
  assert.strictEqual(host.menus.visible('textbox-more', { textbox: {} }).length, 1);
  assert.strictEqual(host.menus.visible('textbox-more', {}).length, 0);
  assert.throws(() => host.inline.register('other', { render() {}, toText() {} }));
  assert.strictEqual(host.settings.get('on'), true);
  let seen; host.settings.onChange('on', (v) => { seen = v; }); host.settings.set('on', false);
  assert.strictEqual(seen, false);
});
