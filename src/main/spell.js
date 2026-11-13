'use strict';
// Text recognition makes typical mistakes a dictionary can spot: a Russian
// word read with Latin look-alike letters ("Tak" for "Так"), similar letters
// mixed up ("ymn" for "чип", "rn" for "m"), a lost space ("сконтакторами").
// For each word that is in no dictionary, look-alike variants are tried and
// the one that is a real word (in the line's language) is taken. Offline:
// Hunspell dictionaries (Russian, English) and a German word list.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'assets', 'dict');

let dicts = null, idle = null;
function load() {
  clearTimeout(idle);
  idle = setTimeout(() => { dicts = null; }, 120000); // free the memory when not used
  if (idle.unref) idle.unref();
  if (dicts) return dicts;
  const nspell = require('nspell');
  const read = (f) => fs.readFileSync(path.join(DIR, f));
  const de = new Set();
  for (const w of read('de.txt').toString('utf8').split('\n')) if (w) de.add(w.toLowerCase());
  dicts = { ru: nspell(read('ru.aff'), read('ru.dic')), en: nspell(read('en.aff'), read('en.dic')), de };
  return dicts;
}

const CYR = /[Ѐ-ӿ]/, LAT = /[a-zA-ZäöüÄÖÜß]/;
// below this recognition confidence a lone small Latin letter in Russian text
// counts as a misread Russian word
const UNSURE = 85;

function known(word, script) {
  const d = load();
  if (script === 'cyr') return d.ru.correct(word) || d.ru.correct(word.toLowerCase());
  const lw = word.toLowerCase();
  return d.de.has(lw) || d.en.correct(word) || d.en.correct(lw);
}

// letters the recogniser mixes up: Latin read for Cyrillic …
const TO_CYR = {
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'уч', k: 'к', m: 'мти', n: 'пи', u: 'и', r: 'г', b: 'ьвб', h: 'нь', t: 'т', i: 'і',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У', '3': 'зЗ', '6': 'б', '0': 'оО',
};
// … Cyrillic read for Latin …
const TO_LAT = {
  а: 'a', с: 'c', е: 'e', о: 'o', р: 'p', х: 'x', у: 'y', к: 'k', м: 'm', т: 't', и: 'u', п: 'n', г: 'r', н: 'h',
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y',
};
// … and similar letters within a script
const SAME = { f: 't', t: 'f', l: 'Ii1', I: 'l1', '1': 'lI', ä: 'a', ö: 'o', ü: 'u', a: 'ä', o: 'ö', u: 'ü', B: 'ß', ß: 'B', e: 'c', c: 'e', ё: 'е', е: 'ё', ш: 'щ', щ: 'ш', и: 'й', й: 'и' };

/**
 * Variants of `w` with letters swapped for look-alikes, each with a cost
 * (the first look-alike of a letter is the likeliest): [[variant, cost]].
 */
function variants(w, table, max = 2, limit = 800) {
  const chars = [...w];
  const out = new Map();
  const add = (v, c) => { if (v !== w && (!out.has(v) || out.get(v) > c)) out.set(v, c); };
  // every letter that has look-alikes swapped at once ("Tak" → "Так")
  const pos = chars.map((ch, i) => (table[ch] ? i : -1)).filter((i) => i >= 0);
  if (pos.length) {
    let all = [[chars.slice(), 0]];
    for (const i of pos) {
      const next = [];
      for (const [v, c] of all) [...table[chars[i]]].forEach((alt, k) => { const n = v.slice(); n[i] = alt; next.push([n, c + k]); });
      all = next.sort((p, q) => p[1] - q[1]).slice(0, limit);
    }
    for (const [v, c] of all) add(v.join(''), c);
  }
  // one or two letters swapped
  const one = (src, base) => [...src].forEach((ch, i) => [...(table[ch] || '')].forEach((alt, k) => { const n = [...src]; n[i] = alt; add(n.join(''), base + 1 + k); }));
  one(w, 0);
  if (max >= 2) for (const [v, c] of [...out].filter(([, c]) => c <= 1).slice(0, 80)) one(v, c);
  return [...out].sort((p, q) => p[1] - q[1]);
}

/**
 * Corrects the words of recognised lines. lines: [{ text, words: [{ text, conf? }] }]
 * (conf: the reader's confidence 0–100, optional).
 * Returns the lines with corrected text (and words), plus how many words changed.
 */
function correctLines(lines) {
  let changed = 0;
  // the last word of the previous line: a line start is a sentence start
  // only after a full stop (or on the first line)
  let lastTok = null;
  const out = lines.map((l) => {
    const text = String(l.text || '');
    const nCyr = (text.match(/[Ѐ-ӿ]/g) || []).length, nLat = (text.match(/[a-zA-ZäöüÄÖÜß]/g) || []).length;
    // the line's script: what most of its letters are (Russian with a few Latin terms stays Russian)
    const script = nCyr >= nLat ? 'cyr' : 'lat';
    // ctx: { prev, next, conf } – the neighbouring words and the reader's confidence
    const fix = (raw, count = false, ctx = {}) => {
      const m = raw.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’-]*[\p{L}\p{N}]|[\p{L}\p{N}])([^\p{L}\p{N}]*)$/u);
      if (!m) return raw;
      const [, pre, w, post] = m;
      if (w.length < 2 || /\d/.test(w.replace(/[03]/g, '')) && !/[Ѐ-ӿ]/.test(w)) return raw; // numbers, codes
      const hasC = CYR.test(w), hasL = LAT.test(w);
      // two letters: a symbol or unit far more often than a misread word
      // ("tf", "lc", "dt", "eV"); only a whole Latin look-alike of a short
      // Russian word in a Russian line is taken ("no" → "по")
      if (w.length <= 2) {
        if (script !== 'cyr' || !hasL) return raw;
        const v = [...w].map((ch) => (CYR.test(ch) ? ch : TO_CYR[ch] && TO_CYR[ch][0]));
        if (v.some((ch) => !ch)) return raw;
        const c = v.join('');
        if (!known(c, 'cyr')) return raw;
        // an English word ("no", "he") counts as a misread only between
        // Russian words or when the reader was unsure (mixed letters always)
        const cyrSide = (x) => !x || CYR.test(x);
        if (!hasC && known(w, 'lat') && !(cyrSide(ctx.prev) && cyrSide(ctx.next) && (ctx.prev || ctx.next)) && !(ctx.conf != null && ctx.conf < UNSURE)) return raw;
        if (count) changed++;
        return pre + c + post;
      }
      // hyphenated: each part on its own
      if (w.includes('-')) return pre + w.split('-').map((p) => fix(p, count)).join('-') + post;
      // acronyms and terms in capitals (TCP, RS) and words already right stay
      if (!hasC && w.length <= 5 && w === w.toUpperCase()) return raw;
      const ws = hasC && !hasL ? 'cyr' : hasL && !hasC ? 'lat' : 'mixed';
      if (ws !== 'mixed' && known(w, ws)) return raw;
      // candidates in the line's script first, then in the word's own script
      const tryScript = (sc) => {
        const cands = (sc === 'cyr' ? variants(w, TO_CYR) : variants(w, TO_LAT)).concat(variants(w, SAME, 1).map(([v, c]) => [v, c + 0.5]));
        cands.sort((p, q) => p[1] - q[1]);
        let hit = null;
        for (const [c, cost] of cands) {
          if (hit && cost > hit[1]) break;
          const cs = CYR.test(c) && !LAT.test(c) ? 'cyr' : LAT.test(c) && !CYR.test(c) ? 'lat' : null;
          if (cs !== sc || !known(c, sc)) continue;
          if (hit) return null; // two real words fit as well: unsure, leave it
          hit = [c, cost];
        }
        return hit ? hit[0] : null;
      };
      let best = null;
      if (ws === 'mixed') best = tryScript(script) || tryScript(script === 'cyr' ? 'lat' : 'cyr');
      else if (ws === 'lat' && script === 'cyr' && w.length <= 12 && w !== w.toUpperCase()) best = tryScript('cyr') || tryScript('lat'); // a Russian word read in Latin?
      else best = tryScript(ws);
      // a lost space after a short Russian preposition ("сконтакторами" → "с контакторами")
      if (!best && ws === 'cyr' && w.length >= 6) {
        const m2 = w.match(/^(с|в|к|и|у|о|а|я|на|по|за|из|от|до|не|без|для|под|над|при|про)(.{4,})$/i);
        if (m2 && known(m2[2], 'cyr')) best = m2[1] + ' ' + m2[2];
      }
      if (!best) return raw;
      if (count) changed++;
      return pre + best + post;
    };
    // a one-letter Russian word read in Latin ("K сожалению" → "К сожалению"):
    // only before a Russian word, only letters that are Russian words. Inside
    // a sentence a Latin letter is usually a variable ("поле B равно",
    // "пусть a равно"), so a capital is taken only at the start of a
    // sentence, a small letter only when the reader was unsure about it.
    const single = (part, next, prev, conf) => {
      if (script !== 'cyr' || !/^[A-Za-z]$/.test(part) || !next || !/^[Ѐ-ӿ]/.test(next) || /^(и|или|а|но|да)$/i.test(next)) return null; // ("точка A и B": a label)
      const c = TO_CYR[part] && TO_CYR[part][0];
      if (!c || !/^[авкосуяиАВКОСУЯИ]$/.test(c)) return null;
      const starts = !prev || /[.!?…:]["»)]*$/.test(prev);
      if (part === part.toUpperCase() ? !starts : !(conf != null && conf < UNSURE)) return null;
      return c;
    };
    const ws = l.words || [];
    const prevLine = lastTok;
    const words = ws.map((wd, i) => {
      const t = String(wd.text || '');
      const prev = i ? String(ws[i - 1].text || '') : prevLine, next = ws[i + 1] && String(ws[i + 1].text || '');
      return { ...wd, text: single(t, next, prev, wd.conf) || fix(t, false, { prev, next, conf: wd.conf }) };
    });
    const parts = text.split(/(\s+)/);
    // the words' confidence, when the text splits into the same words
    const toks = parts.filter((p) => p && !/^\s+$/.test(p));
    const confOf = toks.length === ws.length ? (k) => ws[k].conf : () => undefined;
    let k = -1;
    const fixed = parts.map((part, i) => {
      if (/^\s+$/.test(part) || !part) return part;
      k++;
      const prev = k ? toks[k - 1] : prevLine, next = toks[k + 1];
      const s1 = single(part, next, prev, confOf(k));
      if (s1) { changed++; return s1; }
      return fix(part, true, { prev, next, conf: confOf(k) });
    }).join('');
    if (toks.length) lastTok = toks[toks.length - 1];
    return { ...l, text: fixed, words };
  });
  return { lines: out, changed };
}

module.exports = { correctLines, variants };
