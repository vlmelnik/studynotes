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

test('API v2 in the fake host: ai, notebook read, preview and apply', async () => {
  const doc = { title: 'Notes', pages: [{ id: 'p1', kind: 'paper', w: 595, h: 842 }], data: { p1: { strokes: [], texts: [{ id: 'a', x: 40, y: 40, text: 'Gate oxide' }], items: [] } } };
  const host = fakeHost('demo', { ai: async ({ user }) => `echo:${user.length}`, doc });
  assert.ok(host.ai.ready());
  assert.match(await host.ai.request({ system: 's', user: 'abc' }), /^echo:3$/);
  assert.ok(host.notebook.read().text.includes('[p1 t:a] Gate oxide'));
  const plan = { version: 1, ops: [{ op: 'underline', page: 1, id: 'a', terms: ['oxide'] }, { op: 'addText', page: 7, text: 'x' }] };
  const pv = host.notebook.preview(plan);
  assert.ok(!pv.ok && pv.lines.length === 1 && pv.problems.length === 1);
  assert.deepStrictEqual(host.notebook.apply(plan).applied, 1);
  assert.strictEqual(doc.data.p1.texts[0].html, 'Gate <u>oxide</u>');
  await assert.rejects(fakeHost('demo').ai.request({}), /Set up/);
});
