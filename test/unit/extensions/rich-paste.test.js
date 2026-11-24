'use strict';

const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
const { fakeHost, load } = require('./fake-host');
const { parseRich, richToPlain } = require('../../../src/shared/richtext');

const KIND = 'rich-paste:math';
const SOURCE = String.raw`\frac{400}{230}\approx 1{,}73=\sqrt{3}`;
let ext;

before(async () => {
  // Node tests activation without styles; the application build tests the CSS imports.
  const hook = registerHooks({ load(url, context, next) {
    if (url.endsWith('/rich-paste/styles.css') || url.endsWith('/katex/dist/katex.min.css')) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return next(url, context);
  } });
  try { ext = await load('rich-paste'); } finally { hook.deregister(); }
});

function start(options) {
  const host = fakeHost('rich-paste', options);
  ext.activate(host);
  return host;
}

test('off by default; on activation paste stores recoverable source and readable fallback', () => {
  assert.equal(ext.defaultEnabled, false);
  assert.equal(ext.apiVersion, 1);
  const host = start();
  const clip = { text: `# Ratio\n- **Result**: $x_1$\n\\[${SOURCE}\\]`, target: 'textbox' };
  const html = host.paste.run(clip).html;
  assert.equal(richToPlain(html), `Ratio\n• Result: $x_1$\n$$${SOURCE}$$`);
  const atoms = parseRich(html).flat().filter((r) => r.ix);
  assert.deepEqual(atoms.map(({ ix, iv, disp }) => [ix, iv, disp]), [[KIND, 'x_1', false], [KIND, SOURCE, true]]);
  assert.match(html, /<b>Result<\/b>/);
});

test('KaTeX clipboard annotation round-trips through the host, including quotes and entities', () => {
  const host = start();
  const html = '<span class="katex"><annotation encoding="application/x-tex">a &lt; b &amp; &quot;c&quot;</annotation></span>';
  const result = host.paste.run({ html, text: 'unused', target: 'page' });
  assert.equal(richToPlain(result.html), '$a < b & "c"$');
  assert.equal(parseRich(result.html)[0][0].iv, 'a < b & "c"');
  assert.equal(host.paste.run({ text: 'It costs $5.' }), null);
});

test('the paste setting toggles parsing without disabling the manual menu', () => {
  const host = start({ settings: { convertOnPaste: false } });
  const clip = { text: '$x_1$' };
  const visible = () => host.menus.visible('view', {});
  assert.equal(host.paste.run(clip), null);
  assert.equal(visible().length, 1);
  assert.match(visible()[0].label, /Enable/);
  visible()[0].run({});
  assert.equal(richToPlain(host.paste.run(clip).html), '$x_1$');
  assert.match(visible()[0].label, /Disable/);
  visible()[0].run({});
  assert.equal(host.paste.run(clip), null);
  assert.equal(host.menus.visible('textbox-more', { textbox: clip }).length, 1);
});

test('manual conversion commits once, and does not reformat an already converted or plain box', () => {
  const host = start();
  const htmls = [];
  const ctx = { textbox: { text: '# Topic\n- Use $x$.', setHtml: (html) => htmls.push(html) } };
  const menu = host.menus.visible('textbox-more', ctx);
  assert.equal(menu.length, 1);
  menu[0].run(ctx);
  assert.equal(htmls.length, 1);
  assert.equal(richToPlain(htmls[0]), 'Topic\n• Use $x$.');
  assert.equal(host.menus.visible('textbox-more', { textbox: { text: richToPlain(htmls[0]), html: htmls[0] } }).length, 0);
  assert.equal(host.menus.visible('textbox-more', { textbox: { text: 'Already plain' } }).length, 0);
});

test('manual conversion does not replace existing per-run formatting with plain text', () => {
  const host = start();
  const textbox = { text: 'Important $x_1$', html: '<span data-fs="24" data-c="#d62828"><b>Important</b></span> $x_1$' };
  assert.equal(host.menus.visible('textbox-more', { textbox }).length, 0);
});

test('KaTeX copy HTML includes source, uses display mode and falls back for invalid TeX', () => {
  const def = start().calls.inline.get(KIND);
  assert.equal(def.toText('x', {}), '$x$');
  assert.equal(def.toText('x', { display: true }), '$$x$$');
  const html = def.toHtml(SOURCE, { display: true });
  assert.match(html, /class="katex-display"/);
  assert.ok(html.includes(`<annotation encoding="application/x-tex">${SOURCE}</annotation>`));
  const bad = def.toHtml('x_{', {});
  assert.match(bad, /class="katex-error"/);
  assert.match(bad, />x_\{<\/span>/);
});

test('formula editing supplies the raw source and passes on apply or cancel', async () => {
  const prompts = [];
  const def = start({ prompt: async (opts) => { prompts.push(opts); return prompts.length === 1 ? 'y^2' : null; } }).calls.inline.get(KIND);
  assert.equal(await def.edit('x^2'), 'y^2');
  assert.equal(await def.edit('y^2'), null);
  assert.deepEqual(prompts, [{ title: 'Edit formula', value: 'x^2' }, { title: 'Edit formula', value: 'y^2' }]);
});

test('editing preserves TeX comment line boundaries in a single-line host prompt', async () => {
  const prompts = [];
  const source = ' x% comment\ny ';
  const def = start({ prompt: async (opts) => {
    prompts.push(opts);
    const value = opts.value.replace(/[\r\n]/g, '').trim();
    return prompts.length === 1 ? value : value.replace(/y$/, 'z');
  } }).calls.inline.get(KIND);
  assert.equal(await def.edit(source), source);
  assert.equal(await def.edit(source), 'x% comment\nz');
  assert.doesNotMatch(prompts[0].value, /[\r\n]/);
});
