'use strict';

const { richToPlain } = require('./richtext');
const { escHtml } = require('./util');

const HEADING = [1.6, 1.35, 1.15];
const LINE_BREAK = /\r\n?|\n/;
const INLINE = /(?<![\w*])\*\*(?!\s)([^*]+?)(?<!\s)\*\*(?!\*)|(?<!\w)__(?!\s)((?:[^_]|_(?!_))+?)(?<!\s)__(?!\w)|(?<![\w*])\*(?![\s*])([^*]+?)(?<!\s)\*(?![\w*])/g;

function headingHtml(content, level, baseSize = 16) {
  const size = Math.round(baseSize * HEADING[level - 1] * 2) / 2;
  return `<span data-fs="${size}"><b>${content}</b></span>`;
}

const paragraphHtml = (content) => `<div>${content || '<br>'}</div>`;

function renderMarkdownLines(lines, baseSize) {
  let marks = 0;
  const rendered = lines.map((line) => {
    const heading = /^(#{1,3})[ \t]+(?=\S)/.exec(line);
    const list = /^\s*([-*]|\d+\.)[ \t]+(?=\S)/.exec(line);
    let prefix = '';
    if (heading || list) {
      marks++;
      line = line.slice((heading || list)[0].length);
      if (list) prefix = /^\d/.test(list[1]) ? `${list[1]} ` : '• ';
    }
    let start = 0;
    let content = prefix;
    for (const m of line.matchAll(INLINE)) {
      marks++;
      const tag = m[3] === undefined ? 'b' : 'i';
      content += `${escHtml(line.slice(start, m.index))}<${tag}>${escHtml(m[1] ?? m[2] ?? m[3])}</${tag}>`;
      start = m.index + m[0].length;
    }
    content += escHtml(line.slice(start));
    return heading ? headingHtml(content, heading[1].length, baseSize) : content;
  });
  return { converted: marks >= 2, lines: marks >= 2 ? rendered : lines.map(escHtml) };
}

function markdownToRich(text, baseSize) {
  const html = renderMarkdownLines(text.split(LINE_BREAK), baseSize).lines.map(paragraphHtml).join('');
  return { html, plain: richToPlain(html) };
}

module.exports = { markdownToRich, renderMarkdownLines, headingHtml, paragraphHtml };
