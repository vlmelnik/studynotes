'use strict';

const { decode } = require('./richtext');
const { escHtml } = require('./util');

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

const VOID_TAG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
const RAW_TAG = /^(?:script|style|title|textarea|noscript)$/;
const NAMED = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', le: '≤', ge: '≥', ne: '≠', asymp: '≈', equiv: '≡', minus: '−',
  plusmn: '±', times: '×', divide: '÷', middot: '·', radic: '√', sum: '∑', prod: '∏', int: '∫', infin: '∞',
  rarr: '→', larr: '←', harr: '↔', deg: '°', bull: '•', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodeClipboard(text) {
  // Decode once: &amp;le; is the literal string &le;, not a second entity.
  return text.replace(/&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]*);/g, (entity) => {
    const name = entity.slice(1, -1);
    return Object.hasOwn(NAMED, name) ? NAMED[name] : decode(entity);
  });
}

function htmlAttrs(raw) {
  const attrs = Object.create(null);
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const [, name, double, single, bare] of raw.matchAll(re)) {
    const key = name.toLowerCase();
    if (!(key in attrs)) attrs[key] = decodeClipboard(double ?? single ?? bare ?? '');
  }
  return attrs;
}

// A clipboard fragment is not a document. Track tag boundaries and source offsets,
// so a formula can be replaced without rewriting unrelated markup.
function clipboardTags(html) {
  const re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<(\/?)([a-z][\w:-]*)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'"<>])*)>/gi;
  const opens = new Map();
  const tags = [];
  let m;
  while ((m = re.exec(html))) {
    const tag = { start: m.index, end: re.lastIndex };
    tags.push(tag);
    if (!m[2]) continue;
    tag.name = m[2].toLowerCase();
    tag.closing = m[1] === '/';
    if (tag.closing) {
      const open = opens.get(tag.name)?.pop();
      if (open) open.close = tags.length - 1;
      continue;
    }
    tag.attrs = htmlAttrs(m[3]);
    if (RAW_TAG.test(tag.name)) {
      const end = new RegExp(`</${tag.name}\\s*>`, 'gi');
      end.lastIndex = re.lastIndex;
      const close = end.exec(html);
      tag.rawText = html.slice(tag.end, close?.index ?? html.length);
      tag.complete = !!close;
      tag.end = re.lastIndex = close ? end.lastIndex : html.length;
    } else if (!VOID_TAG.test(tag.name) && !/\/$/.test(m[3])) {
      if (!opens.has(tag.name)) opens.set(tag.name, []);
      opens.get(tag.name).push(tag);
    } else tag.single = true;
  }
  return tags;
}

function formulaHtml(tex, display) {
  const src = escHtml(tex).replace(/"/g, '&quot;');
  return `<span data-x="rich-paste:math" data-v="${src}"${display ? ' data-display="1"' : ''}></span>`;
}

const classHas = (tag, name) => (tag.attrs.class ?? '').split(/\s+/).includes(name);

function displayTag(tag) {
  return tag.attrs.display === 'block' || tag.attrs.display === 'true' || tag.attrs['data-display'] === '1'
    || classHas(tag, 'katex-display') || classHas(tag, 'MathJax_Display') || classHas(tag, 'MathJax_SVG_Display');
}

function recoveredFormulas(html, tags) {
  const formulas = new Map();
  const mathJaxFrames = new Map();
  const displays = [];
  const katex = [];
  const set = (i, tex, display) => {
    if (tex?.trim() && !formulas.has(i)) formulas.set(i, { tex, display });
  };
  for (let i = 0; i < tags.length; i++) {
    while (katex.length && tags[katex.at(-1)].close <= i) katex.pop();
    while (displays.length && tags[displays.at(-1)].close <= i) displays.pop();
    const tag = tags[i];
    if (!tag.attrs) continue;
    const display = displays.at(-1);
    const ownDisplay = displayTag(tag);
    if (tag.name === 'span' && tag.close !== undefined && classHas(tag, 'katex')) katex.push(i);
    if (tag.name === 'annotation' && tag.close !== undefined && katex.length
      && tag.attrs.encoding?.toLowerCase() === 'application/x-tex') {
      const wrapper = katex.at(-1);
      const frame = tags[wrapper];
      const outer = display !== undefined && display < wrapper && classHas(tags[display], 'katex-display')
        && !html.slice(tags[display].end, frame.start).trim()
        && !html.slice(tags[frame.close].end, tags[tags[display].close].start).trim();
      const tex = decodeClipboard(html.slice(tag.end, tags[tag.close].start));
      // Only remove a display wrapper that encloses nothing else.
      set(outer ? display : wrapper, tex, display !== undefined || displayTag(frame));
    }
    if (tag.name === 'script' && tag.complete && /^math\/tex\s*(?:;|$)/i.test(tag.attrs.type ?? '')) {
      set(i, decodeClipboard(tag.rawText), ownDisplay || display !== undefined || /;\s*mode\s*=\s*display\b/i.test(tag.attrs.type));
    } else if (tag.close !== undefined || tag.single) {
      set(i, tag.attrs['data-latex'], ownDisplay || display !== undefined);
      if (tag.attrs.id?.endsWith('-Frame') && /(?:^|\s)(?:MathJax|MathJax_SVG|mjx-chtml)(?:\s|$)/.test(tag.attrs.class ?? '')) {
        mathJaxFrames.set(tag.attrs.id, i);
      }
    }
    if (ownDisplay && tag.close !== undefined) displays.push(i);
  }
  // The MathJax v2 frame is visual output; the separately identified script holds the source.
  for (const [i] of formulas) {
    if (tags[i].name !== 'script' || !tags[i].attrs.id) continue;
    const frame = mathJaxFrames.get(`${tags[i].attrs.id}-Frame`);
    if (frame !== undefined) formulas.set(frame, { tex: null });
  }
  return formulas;
}

function mathFromHtml(html) {
  const tags = clipboardTags(html);
  const formulas = recoveredFormulas(html, tags);
  const output = [];
  let start = 0;
  for (let i = 0; i < tags.length; i++) {
    const formula = formulas.get(i);
    if (!formula) continue;
    const tag = tags[i];
    output.push(html.slice(start, tag.start), formula.tex === null ? '' : formulaHtml(formula.tex, formula.display));
    i = tag.close ?? i;
    start = tags[i].end;
  }
  return output.length ? output.join('') + html.slice(start) : html;
}

module.exports = { findMath, mathFromHtml, formulaHtml, clipboardTags, decodeClipboard };
