'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findMath, mathFromHtml } = require('../../../src/shared/paste-math');

const plain = (text) => ({ type: 'text', text });
const math = (tex, display = false) => ({ type: 'math', tex, display });

test('finds the four delimiter pairs in order and leaves surrounding text intact', () => {
  assert.deepStrictEqual(findMath('Use $x^2$, \\(y=1\\), $$z_1$$, and \\[a=b\\].'), [
    plain('Use '), math('x^2'), plain(', '), math('y=1'), plain(', '), math('z_1', true),
    plain(', and '), math('a=b', true), plain('.'),
  ]);
});

test('keeps prices and loosely spaced single dollars as plain text', () => {
  const text = 'Prices are $5 and $10; use $ x$ or $y $. Compare $25$.';
  assert.deepStrictEqual(findMath(text), [plain(text)]);
  assert.deepStrictEqual(findMath('$5 and $10, then $x$.'), [plain('$5 and $10, then '), math('x'), plain('.')]);
  assert.deepStrictEqual(findMath('$2=2$ and $α$'), [math('2=2'), plain(' and '), math('α')]);
});

test('unescapes dollar signs in text and keeps their LaTeX escapes inside formulas', () => {
  assert.deepStrictEqual(findMath('Costs \\$5. Use \\(a + \\$b\\) or $a\\$b$.'), [
    plain('Costs $5. Use '), math('a + \\$b'), plain(' or '), math('a\\$b'), plain('.'),
  ]);
  assert.deepStrictEqual(findMath('Backslashes \\\\(literal) and \\\\$x$.'), [
    plain('Backslashes \\\\(literal) and \\\\'), math('x'), plain('.'),
  ]);
});

test('preserves nested braces and boxed display LaTeX exactly', () => {
  assert.deepStrictEqual(findMath('$\\frac{du_C}{dt}$ and \\[ \\boxed{a_{b_c}} \\]'), [
    math('\\frac{du_C}{dt}'), plain(' and '), math(' \\boxed{a_{b_c}} ', true),
  ]);
});

test('keeps unclosed delimiters as text and still recognizes later formulas', () => {
  for (const text of ['Unclosed $x', 'Unclosed $$x', 'Unclosed \\(x', 'Unclosed \\[x', 'Loose \\) and \\]']) {
    assert.deepStrictEqual(findMath(text), [plain(text)]);
  }
  assert.deepStrictEqual(findMath('Unclosed \\( here, then \\(x\\), and $$ open $y$.'), [
    plain('Unclosed \\( here, then '), math('x'), plain(', and $$ open '), math('y'), plain('.'),
  ]);
});

test('allows a single line break but stops formulas at blank lines', () => {
  assert.deepStrictEqual(findMath('$$a\r\n+b$$ then \\[c\n+d\\]'), [
    math('a\r\n+b', true), plain(' then '), math('c\n+d', true),
  ]);
  const text = '$x\n \ny$ and $$a\r\n\t\r\nb$$ and \\[c\r\rd\\].';
  assert.deepStrictEqual(findMath(text), [plain(text)]);
});

test('returns no empty segments and preserves ordinary blank text', () => {
  assert.deepStrictEqual(findMath(''), []);
  assert.deepStrictEqual(findMath(' \n\t'), [plain(' \n\t')]);
  assert.deepStrictEqual(findMath('\\(\\) and $$ $$'), [plain('\\(\\) and $$ $$')]);
  assert.deepStrictEqual(findMath('\\(x\\)\\[y\\]'), [math('x'), math('y', true)]);
});

test('splits adjacent dollar-delimited formulas at their shared boundaries', () => {
  assert.deepStrictEqual(findMath('$x$$y$'), [math('x'), math('y')]);
  assert.deepStrictEqual(findMath('$$x$$$$y$$'), [math('x', true), math('y', true)]);
  assert.deepStrictEqual(findMath('$x$$$y$$'), [math('x'), math('y', true)]);
});

test('recovers KaTeX sources without retaining visual duplicates or losing surrounding HTML', () => {
  const katex = '<span class="katex"><span class="katex-mathml"><math><semantics>'
    + '<mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x &lt; 2</annotation>'
    + '</semantics></math></span><span class="katex-html" aria-hidden="true"><span>x</span></span></span>';
  assert.strictEqual(mathFromHtml(`<p>Use ${katex} or <span class="katex-display">${katex}</span>.</p>`),
    '<p>Use <span data-x="rich-paste:math" data-v="x &lt; 2"></span> or '
    + '<span data-x="rich-paste:math" data-v="x &lt; 2" data-display="1"></span>.</p>');
});

test('recovers MathJax attributes and scripts with display mode and escaped sources', () => {
  const html = '<mjx-container class="MathJax" display="true" data-latex=\'a &gt; &quot;b&quot;\'><mjx-math /></mjx-container>'
    + '<script type="math/tex">x &amp; y</script><script TYPE="math/tex; mode=display">&#x3b1;</script>';
  assert.strictEqual(mathFromHtml(html), '<span data-x="rich-paste:math" data-v="a &gt; &quot;b&quot;" data-display="1"></span>'
    + '<span data-x="rich-paste:math" data-v="x &amp; y"></span>'
    + '<span data-x="rich-paste:math" data-v="α" data-display="1"></span>');
});

test('leaves MathJax display wrappers in place when only their child contains the source', () => {
  assert.strictEqual(mathFromHtml('<div class="MathJax_Display"><span data-latex="x">visible</span></div>'),
    '<div class="MathJax_Display"><span data-x="rich-paste:math" data-v="x" data-display="1"></span></div>');
});

test('leaves unrelated markup and incomplete rendered formulas exactly as supplied', () => {
  const html = '<p title="1 > 0">A &amp; B</p><!-- <script type="math/tex">no</script> -->'
    + '<span class="katex"><span>no source</span></span><annotation encoding="application/x-tex">orphan</annotation>'
    + '<script type="text/plain">a <b data-latex="no">b</b></script>';
  assert.strictEqual(mathFromHtml(html), html);
});

test('replaces a MathJax v2 frame and its matching source script only once', () => {
  const html = '<span id="equation-Frame" class="MathJax">x + 1</span>'
    + '<script type="math/tex" id="equation">x+1</script><span id="unrelated-Frame">x + 1</span>';
  assert.strictEqual(mathFromHtml(html), '<span data-x="rich-paste:math" data-v="x+1"></span>'
    + '<span id="unrelated-Frame">x + 1</span>');
});

test('decodes common named math entities exactly once', () => {
  const html = '<span data-latex="&alpha;&minus;x &le; 2 &amp;le; y">visual</span>';
  assert.strictEqual(mathFromHtml(html), '<span data-x="rich-paste:math" data-v="α−x ≤ 2 &amp;le; y"></span>');
});

test('preserves unrelated children in a display wrapper', () => {
  const html = '<span class="katex-display"><em>Equation 1</em><span class="katex">'
    + '<annotation encoding="application/x-tex">a=b</annotation></span></span>';
  assert.strictEqual(mathFromHtml(html), '<span class="katex-display"><em>Equation 1</em>'
    + '<span data-x="rich-paste:math" data-v="a=b" data-display="1"></span></span>');
});
