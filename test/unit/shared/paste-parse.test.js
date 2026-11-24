'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pasteToRich } = require('../../../src/shared/paste-parse');
const { parseRich } = require('../../../src/shared/richtext');

test('converts a chat answer without interpreting the LaTeX as Markdown', () => {
  const source = String.raw`# Ratio

- **Use $x_1$** for the input.
- Then simplify:
\[ \frac{400}{230}\approx 1{,}73=\sqrt{3} \]`;
  const result = pasteToRich(Object.freeze({ text: source }), 15);
  assert.equal(result.formulas, 2);
  assert.equal(result.plain, String.raw`Ratio

• Use $x_1$ for the input.
• Then simplify:
$$ \frac{400}{230}\approx 1{,}73=\sqrt{3} $$`);
  const paragraphs = parseRich(result.html);
  const inline = paragraphs[2].find((run) => run.ix);
  assert.equal(inline.iv, 'x_1');
  assert.equal(inline.b, true);
  assert.equal(paragraphs[4].length, 1);
  assert.equal(paragraphs[4][0].disp, true);
});

test('prefers rendered KaTeX HTML and keeps only supported formatting', () => {
  const html = '<h2>Formula</h2><ul><li><strong>Use</strong> <em>this</em> <u>identity</u>:</li></ul>'
    + '<p><span class="katex" style="color:red"><math><semantics>'
    + '<annotation encoding="application/x-tex">a &lt; b &amp; c</annotation>'
    + '</semantics></math><span aria-hidden="true">rendered twice</span></span></p>'
    + '<p><a href="https://example.com">More</a><br> details</p>';
  const result = pasteToRich({ html, text: 'Should not win' }, 20);
  assert.equal(result.formulas, 1);
  assert.equal(result.plain, 'Formula\n• Use this identity:\n$a < b & c$\nMore\ndetails');
  assert.match(result.html, /data-fs="27"/);
  assert.match(result.html, /<b>Use<\/b> <i>this<\/i> <u>identity<\/u>/);
  assert.doesNotMatch(result.html, /style=|<a\b|aria-hidden|rendered twice/);
});

test('isolates display formulas recovered from MathJax, preserving surrounding text', () => {
  const result = pasteToRich({ html: '<p>Before <script type="math/tex; mode=display">a=b</script> after.</p>' });
  assert.equal(result.plain, 'Before\n$$a=b$$\nafter.');
  assert.deepEqual(parseRich(result.html).map((runs) => runs.length), [1, 1, 1]);
  assert.equal(result.formulas, 1);
});

test('only uses the clipboard plain text when HTML has no recovered formula', () => {
  assert.equal(pasteToRich({ html: '<b>text</b>', text: 'Prices are $5 and $10.' }), null);
  assert.equal(pasteToRich({ text: '# A single mark' }), null);
  assert.equal(pasteToRich({}), null);
  assert.deepEqual(pasteToRich({ html: '<p>Other</p>', text: '# Topic\n- Item' }, 10), {
    html: '<div><span data-fs="16"><b>Topic</b></span></div><div>• Item</div>', plain: 'Topic\n• Item', formulas: 0,
  });
});

test('keeps one display formula and removes its delimiters only from the stored source', () => {
  const input = String.raw`\[ \frac{400}{230}\approx 1{,}73=\sqrt{3} \]`;
  const result = pasteToRich({ text: input });
  assert.equal(result.formulas, 1);
  assert.equal(result.plain, String.raw`$$ \frac{400}{230}\approx 1{,}73=\sqrt{3} $$`);
  assert.equal(parseRich(result.html)[0][0].iv, String.raw` \frac{400}{230}\approx 1{,}73=\sqrt{3} `);
});

test('drops non-content and escapes decoded text before storing it', () => {
  const html = '<p>&lt;sample&gt; <span data-latex="a=b">visual</span></p>'
    + '<script type="text/plain">not visible</script><style>.note{color:red}</style>'
    + '<!-- not visible --><strong title="1 > 0">Text</strong>';
  const result = pasteToRich({ html });
  assert.equal(result.plain, '<sample> $a=b$\nText');
  assert.match(result.html, /&lt;sample&gt;/);
  assert.doesNotMatch(result.html, /not visible|color:red|<sample|title=/);
});

test('keeps ordered and unordered markers with the first paragraph of a list item', () => {
  const html = '<ol start="4"><li><p>Use <span data-latex="x+1">visual</span></p><p>More &ndash; and y&ge;0.</p></li>'
    + '<li><p>Then simplify</p></li></ol><ul><li><div>Check</div></li></ul>';
  assert.equal(pasteToRich({ html }).plain, '4. Use $x+1$\nMore – and y≥0.\n5. Then simplify\n• Check');
});
