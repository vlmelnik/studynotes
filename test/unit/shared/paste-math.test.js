'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findMath } = require('../../../src/shared/paste-math');

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
