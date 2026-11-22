'use strict';

const CLOSE_FOR = new Map([['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]']]);
const TOKEN = /\\[\\$()[\]]|\$+|(?:\r?\n|\r(?!\n))[^\S\r\n]*(?:\r?\n|\r(?!\n))/g;
const INLINE_MATH = /[\p{L}\\^_=]/u;

function pairedTokens(text) {
  const tokens = Array.from(text.matchAll(TOKEN), (match) => ({ value: match[0], index: match.index }));
  const nextClose = new Map();

  // Looking backwards assigns each opener its next closer without rescanning unclosed text.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    const { value } = token;
    if (value[0] === '\n' || value[0] === '\r') {
      nextClose.clear();
      continue;
    }
    if (value[0] === '$') {
      token.singleCloseIndex = nextClose.get('$');
      token.closeIndex = nextClose.get('$$');
      nextClose.set('$', i);
      if (value.length >= 2) nextClose.set('$$', i);
    } else if (value === '\\)' || value === '\\]') {
      nextClose.set(value, i);
    } else if (CLOSE_FOR.has(value)) {
      const closer = CLOSE_FOR.get(value);
      token.closeIndex = nextClose.get(closer);
      // An explicit closer belongs to the nearest opener of its kind.
      nextClose.delete(closer);
    }
  }
  return tokens;
}

function findMath(text) {
  const tokens = pairedTokens(text);
  const segments = [];
  let start = 0;
  let plain = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const index = Math.max(start, token.index);
    const value = token.value.slice(index - token.index);
    if (value === '\\$') {
      plain += text.slice(start, index) + '$';
      start = index + value.length;
      continue;
    }
    const closer = CLOSE_FOR.get(value);
    const closeIndex = value === '$' ? token.singleCloseIndex : token.closeIndex;
    if (!closer || closeIndex === undefined) continue;

    const close = tokens[closeIndex];
    const tex = text.slice(index + value.length, close.index);
    if (!/\S/.test(tex)) continue;
    // Single dollars also mark prices, so require tight edges and a math cue.
    if (value === '$' && (/\s/.test(tex[0]) || /\s/.test(tex[tex.length - 1]) || !INLINE_MATH.test(tex))) continue;

    plain += text.slice(start, index);
    if (plain) segments.push({ type: 'text', text: plain });
    segments.push({ type: 'math', tex, display: value === '$$' || value === '\\[' });
    plain = '';
    start = close.index + closer.length;
    // A run of dollars can close one formula and immediately open the next.
    i = start < close.index + close.value.length ? closeIndex - 1 : closeIndex;
  }

  plain += text.slice(start);
  if (plain) segments.push({ type: 'text', text: plain });
  return segments;
}

module.exports = { findMath };
