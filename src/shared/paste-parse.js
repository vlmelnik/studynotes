'use strict';

const { parseRich } = require('./richtext');
const { escHtml } = require('./util');
const { findMath, mathFromHtml, formulaHtml, clipboardTags, decodeClipboard } = require('./paste-math');
const { renderMarkdownLines, headingHtml, paragraphHtml } = require('./paste-markdown');

const LINE_BREAK = /\r\n?|\n/;
const INLINE_TAG = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u' };
const BLOCK_TAG = /^(?:div|p|li|[ou]l|h[123])$/;

function resultFor(html) {
  let formulas = 0;
  const plain = parseRich(html).map((line) => line.map((run) => {
    if (run.ix !== 'rich-paste:math') return run.t;
    formulas++;
    const delimiter = run.disp ? '$$' : '$';
    return delimiter + run.iv + delimiter;
  }).join('')).join('\n');
  return { html, plain, formulas };
}

function reformattedHtml(html, baseSize) {
  const tags = clipboardTags(html);
  const lines = [];
  const styles = [];
  const lists = [];
  let heading = 0;
  let content = '';
  let space = false;
  let listMarker = '';
  const flush = (blank = false) => {
    if (content || blank) lines.push(paragraphHtml(content && heading ? headingHtml(content, heading, baseSize) : content));
    content = '';
    space = false;
  };
  const inline = (part) => {
    if (listMarker) {
      content += `${listMarker} `;
      listMarker = '';
      space = false;
    }
    if (space && content) content += ' ';
    space = false;
    for (let j = styles.length - 1; j >= 0; j--) part = `<${styles[j]}>${part}</${styles[j]}>`;
    content += part;
  };
  const appendText = (raw) => {
    if (!raw) return;
    const text = decodeClipboard(raw).replace(/[ \t\r\n\f]+/g, ' ');
    if (text.startsWith(' ')) space = true;
    const body = text.replace(/^ | $/g, '');
    if (body) inline(escHtml(body));
    if (text.endsWith(' ')) space = true;
  };
  let start = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    appendText(html.slice(start, tag.start));
    start = tag.end;
    if (tag.name === 'span' && tag.attrs?.['data-x'] === 'rich-paste:math' && tag.attrs['data-v']?.trim()
      && tag.close === i + 1 && tags[i + 1].start === tag.end) {
      const display = tag.attrs['data-display'] === '1';
      const span = formulaHtml(tag.attrs['data-v'], display);
      if (display) {
        if (listMarker) { content = listMarker; listMarker = ''; }
        flush();
        lines.push(paragraphHtml(span));
      } else inline(span);
      start = tags[++i].end;
    } else if (tag.name === 'br' && !tag.closing) {
      flush(true);
    } else if (BLOCK_TAG.test(tag.name)) {
      flush();
      if (tag.name[0] === 'h') heading = tag.closing ? 0 : Number(tag.name[1]);
      if (tag.name === 'ol' || tag.name === 'ul') {
        if (tag.closing) lists.pop();
        else lists.push({ ordered: tag.name === 'ol', next: Number.parseInt(tag.attrs.start, 10) || 1 });
      } else if (tag.name === 'li') {
        // An enclosing list marker belongs with the text, even after an opening <p>.
        const list = lists.at(-1);
        listMarker = tag.closing ? '' : list?.ordered ? `${list.next++}.` : '•';
      }
    } else if (Object.hasOwn(INLINE_TAG, tag.name)) {
      const style = INLINE_TAG[tag.name];
      if (!tag.closing) styles.push(style);
      else {
        const j = styles.lastIndexOf(style);
        if (j >= 0) styles.splice(j, 1);
      }
    }
  }
  appendText(html.slice(start));
  flush();
  return lines.join('');
}

function reformattedText(text, baseSize) {
  const segments = findMath(text);
  const formulas = [];
  const lines = [];
  const displays = new Map();
  let current = '';
  let afterDisplay = false;
  // Inline formulas are opaque to Markdown, including when they are inside bold text.
  let id = 0;
  let marker;
  do { marker = `\u0000${id++}:`; } while (text.includes(marker));
  for (const segment of segments) {
    if (segment.type === 'math') {
      const span = formulaHtml(segment.tex, segment.display);
      if (segment.display) {
        if (current.trim()) lines.push(current);
        displays.set(lines.length, span);
        lines.push('');
        current = '';
        afterDisplay = true;
      } else {
        current += `${marker}${formulas.push(span) - 1}\u0000`;
        afterDisplay = false;
      }
    } else {
      const parts = segment.text.split(LINE_BREAK);
      if (afterDisplay && !parts[0].trim()) parts.shift();
      else if (afterDisplay) parts[0] = parts[0].trimStart();
      if (!parts.length) continue;
      current += parts.shift();
      for (const part of parts) {
        lines.push(current);
        current = part;
      }
      afterDisplay = false;
    }
  }
  if (!afterDisplay) lines.push(current);
  const rendered = renderMarkdownLines(lines, baseSize);
  if (!formulas.length && !displays.size && !rendered.converted) return null;
  const slot = new RegExp(`${marker}(\\d+)\u0000`, 'g');
  const html = rendered.lines.map((line, i) => paragraphHtml(displays.get(i)
    ?? line.replace(slot, (_, n) => formulas[n]))).join('');
  return resultFor(html);
}

function pasteToRich({ html = '', text = '' } = {}, baseSize) {
  const recovered = mathFromHtml(html);
  if (recovered !== html) {
    const result = resultFor(reformattedHtml(recovered, baseSize));
    if (result.formulas) return result;
  }
  return reformattedText(text, baseSize);
}

module.exports = { pasteToRich };
