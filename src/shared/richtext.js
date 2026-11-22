'use strict';
// Minimal rich text for text boxes and table cells.
// Stored HTML uses only <b> <i> <u> <br> <div> and
// <span data-fs="18" data-ff="serif" data-c="#d62828"> for size / font /
// colour of single words (the renderer sanitises to this subset), so it can
// be parsed here without a DOM – also in the main process for the PDF export.

const { escHtml } = require('./util');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function spanStyle(attrs) {
  const st = {};
  const get = (name) => {
    const m = new RegExp(`\\bdata-${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs) || new RegExp(`\\bdata-${name}\\s*=\\s*'([^']*)'`, 'i').exec(attrs);
    return m ? decode(m[1]) : null;
  };
  const fs = parseFloat(get('fs'));
  if (fs > 0 && fs < 1000) st.fs = fs;
  const ff = get('ff');
  if (ff && /^[a-z0-9_-]{1,32}$/i.test(ff)) st.ff = ff;
  const c = get('c');
  if (c && /^#[0-9a-f]{6}$/i.test(c)) st.c = c.toLowerCase();
  return st;
}

const INLINE_KIND = /^[a-z0-9-]+(?::[a-z0-9-]+)?$/;
function attrOf(attrs, name) {
  const m = new RegExp(`\\bdata-${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs) || new RegExp(`\\bdata-${name}\\s*=\\s*'([^']*)'`, 'i').exec(attrs);
  return m ? decode(m[1]) : null;
}
function inlineOf(attrs) {
  const x = attrOf(attrs, 'x');
  if (!x || !INLINE_KIND.test(x)) return null;
  return { x, v: attrOf(attrs, 'v') || '', disp: attrOf(attrs, 'display') === '1' };
}

// The export picture of an inline element is looked up by this key (built the
// same way in the renderer, which draws it, and in the export, which places it).
const inlineKey = (kind, value, display, fontSize, color) => [kind, value, display ? 1 : 0, Math.round((fontSize || 0) * 100) / 100, (color || '').toLowerCase()].join('|');

// html -> paragraphs: [[{ t, b, i, u, fs?, ff?, c? }]]
function parseRich(html, base = {}) {
  const paras = [[]];
  const stack = []; // 'b' | 'i' | 'u' | { span style }
  const style = () => {
    const st = { b: !!base.b, i: !!base.i, u: !!base.u };
    for (const t of stack) {
      if (typeof t === 'string') st[t] = true;
      else Object.assign(st, t);
    }
    return st;
  };
  // Known tags are interpreted, any other tag is dropped; a stray "<" is text.
  const re = /<(\/?)(b|i|u|br|div|span)\b([^>]*)>|<\/?[a-z][^>]*>|([^<]+)|(<)/gi;
  let m;
  let divOpen = 0;
  // An extension's inline element (<span data-x="kind" data-v="value">fallback</span>,
  // docs/EXTENSIONS.md) is one atomic run: its text is the fallback, x / v / disp
  // tell the export which picture replaces it (runs: ix = kind, iv = value).
  let inline = null;
  while ((m = re.exec(String(html || '')))) {
    if (inline) {
      if (m[2] && m[2].toLowerCase() === 'span' && m[1] === '/') {
        paras[paras.length - 1].push({ ...style(), t: inline.t, ix: inline.x, iv: inline.v, disp: inline.disp });
        inline = null;
      } else if (m[4] !== undefined || m[5] !== undefined) inline.t += decode(m[4] ?? '<').replace(/\n/g, ' ');
      continue;
    }
    if (m[2] && m[2].toLowerCase() === 'span' && m[1] !== '/') {
      const x = inlineOf(m[3] || '');
      if (x) { inline = { ...x, t: '' }; continue; }
    }
    if (m[4] !== undefined || m[5] !== undefined) {
      const t = decode(m[4] ?? '<');
      const parts = t.split('\n');
      parts.forEach((part, k) => {
        if (k > 0) paras.push([]);
        if (part) paras[paras.length - 1].push({ t: part, ...style() });
      });
      continue;
    }
    if (!m[2]) continue; // unknown tag
    const close = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'br') { paras.push([]); continue; }
    if (tag === 'div') {
      if (!close) {
        // A <div> starts a new line unless we're at the start of an empty one.
        if (paras[paras.length - 1].length || divOpen) paras.push([]);
        divOpen++;
      } else {
        divOpen = Math.max(0, divOpen - 1);
      }
      continue;
    }
    if (tag === 'span') {
      if (close) {
        for (let k = stack.length - 1; k >= 0; k--) if (typeof stack[k] === 'object') { stack.splice(k, 1); break; }
      } else {
        stack.push(spanStyle(m[3] || ''));
      }
      continue;
    }
    if (close) {
      const k = stack.lastIndexOf(tag);
      if (k >= 0) stack.splice(k, 1);
    } else {
      stack.push(tag);
    }
  }
  if (inline) paras[paras.length - 1].push({ ...style(), t: inline.t, ix: inline.x, iv: inline.v, disp: inline.disp }); // unclosed
  // "<div>a</div><div><br></div>" style empty paragraphs collapse sensibly.
  return paras;
}

function plainFromParas(paras) {
  return paras.map((p) => p.map((r) => r.t).join('')).join('\n');
}

function richToPlain(html) {
  return plainFromParas(parseRich(html));
}

function plainToHtml(text) {
  return String(text).split('\n').map((l) => escHtml(l)).join('<br>');
}

/**
 * Word-wrap paragraphs of styled runs.
 * measure(text, style) -> width. Returns lines: [{ runs: [{ t, b, i, u, x, w }], width }]
 */
function layoutRich(paras, maxWidth, measure) {
  const lines = [];
  for (const para of paras) {
    let line = { runs: [], width: 0 };
    const push = () => { lines.push(line); line = { runs: [], width: 0 }; };
    // Split into words keeping spaces attached to the following word boundary.
    const tokens = [];
    for (const run of para) {
      if (run.ix) { tokens.push({ ...run }); continue; } // an inline element never breaks
      for (const tok of run.t.split(/(\s+)/)) if (tok) tokens.push({ ...run, t: tok });
    }
    for (const tok of tokens) {
      const isSpace = /^\s+$/.test(tok.t);
      let w = measure(tok.t, tok);
      if (!isSpace && line.width + w > maxWidth && line.runs.length) {
        // Drop trailing spaces from the full line.
        while (line.runs.length && /^\s+$/.test(line.runs[line.runs.length - 1].t)) line.width -= line.runs.pop().w;
        push();
      }
      if (isSpace && !line.runs.length && lines.length && para.length) continue; // no leading spaces after a wrap
      let t = tok.t;
      // Words longer than a whole line are broken by characters.
      while (!isSpace && !tok.ix && w > maxWidth && t.length > 1) {
        let k = t.length - 1;
        while (k > 1 && measure(t.slice(0, k), tok) > maxWidth - line.width) k--;
        if (line.runs.length && measure(t.slice(0, k), tok) > maxWidth - line.width) { push(); continue; }
        const head = t.slice(0, k);
        const hw = measure(head, tok);
        line.runs.push({ ...tok, t: head, x: line.width, w: hw });
        line.width += hw;
        push();
        t = t.slice(k);
        w = measure(t, tok);
      }
      line.runs.push({ ...tok, t, x: line.width, w });
      line.width += w;
    }
    push();
  }
  return lines;
}

module.exports = { inlineKey, inlineOf, parseRich, richToPlain, plainToHtml, plainFromParas, layoutRich, decode };
