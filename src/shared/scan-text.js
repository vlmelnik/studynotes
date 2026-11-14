'use strict';
// Recognised text to editable text: font choice, bold, languages, umlauts,
// line merging, tilt, paragraphs, paper and ink colours.
// Pure functions on OCR results and RGBA ImageData-like objects: unit-tested.
// (moved unchanged from src/renderer/scan-edit.js)

const { FONTS } = require('./fonts');
const { round2 } = require('./geometry');
const { paragraphs } = require('./scan-layout');
// line height of a text box (× font size), as in the editor
const LINE_H = 1.3;

// ---------- font ----------
// Every typeface with a kind can be matched. The classic office fonts are
// the most likely in documents: another one has to fit a little better.
const CLASSIC = new Set(['carlito', 'sans', 'serif', 'mono']);

const PRIOR = 0.006; // per line, in correlation

const familiesFor = (cyr) => Object.keys(FONTS).filter((f) => FONTS[f].kind && FONTS[f].kind !== 'hand' && (!cyr || FONTS[f].cyr !== false));

const HAND = Object.keys(FONTS).filter((f) => FONTS[f].kind === 'hand');

/**
 * How blurred the letters are (Gaussian sigma in pixels), from the letters'
 * edges alone – independent of the font: a step from paper to ink blurred by
 * sigma has its steepest slope = contrast / (sigma·√2π). A perfectly sharp
 * edge still measures ≈ 0.8 px (pixels are whole), which is taken out.
 */
function edgeSoftness(im, b, extra = 0) {
  const x0 = Math.max(1, Math.floor(b.x0)), x1 = Math.min(im.width - 1, Math.ceil(b.x1));
  const y0 = Math.max(1, Math.floor(b.y0)), y1 = Math.min(im.height - 1, Math.ceil(b.y1));
  if (x1 - x0 < 8 || y1 - y0 < 6) return null;
  const d = im.data, W = im.width;
  const g = (x, y) => { const i = (y * W + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
  const vals = [], grads = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    vals.push(g(x, y));
    const gx = (g(x + 1, y) - g(x - 1, y)) / 2, gy = (g(x, y + 1) - g(x, y - 1)) / 2;
    grads.push(Math.hypot(gx, gy));
  }
  vals.sort((p, q) => p - q); grads.sort((p, q) => p - q);
  const contrast = vals[Math.floor(vals.length * 0.95)] - vals[Math.floor(vals.length * 0.03)];
  const steep = grads[Math.floor(grads.length * 0.985)];
  if (contrast < 40 || !(steep > 0)) return null;
  const sigma = contrast / (steep * Math.sqrt(2 * Math.PI));
  // (× 1.2: strokes thinner than the blur lose some contrast – checked against
  // pictures blurred by a known amount in the bench)
  return Math.sqrt(Math.max(0, sigma * sigma - 0.64 - extra * extra)) * 1.2;
}

/** Typical thickness of the strokes in pixels (median horizontal ink run). */
function strokeWeight(li) {
  const runs = [];
  for (let y = 0; y < li.h; y++) {
    let run = 0;
    for (let x = 0; x <= li.w; x++) {
      const v = x < li.w ? li.ink[y * li.w + x] : 0;
      if (v) run++; else if (run) { runs.push(run); run = 0; }
    }
  }
  if (!runs.length) return 0;
  runs.sort((a, b) => a - b);
  // mean of the middle half: finer than the median of whole pixels
  const mid = runs.slice(Math.floor(runs.length * 0.25), Math.ceil(runs.length * 0.75));
  return mid.reduce((a, v) => a + v, 0) / mid.length;
}

/**
 * Words printed in bold inside a regular line ("the **deposit** is due"):
 * their strokes are clearly thicker than those of the line's other words.
 * Returns one flag per word (all false when unsure).
 */
function boldWords(li, words) {
  const ws = words.map((w) => {
    const letters = (String(w.text || '').match(/[\p{L}\p{N}]/gu) || []).length;
    if (!w.bbox || letters < 3) return 0;
    const x0 = Math.max(0, Math.round(w.bbox.x0 - li.box.x0)), x1 = Math.min(li.w, Math.round(w.bbox.x1 - li.box.x0));
    if (x1 - x0 < 4) return 0;
    const ink = new Uint8Array((x1 - x0) * li.h);
    for (let y = 0; y < li.h; y++) ink.set(li.ink.subarray(y * li.w + x0, y * li.w + x1), y * (x1 - x0));
    return strokeWeight({ w: x1 - x0, h: li.h, ink });
  });
  const ok = ws.filter((v) => v > 0).sort((a, b) => a - b);
  if (ok.length < 3) return words.map(() => false);
  const med = ok[ok.length >> 1];
  // (thin strokes of one or two pixels: too coarse to tell)
  if (med < 1.5) return words.map(() => false);
  const flags = ws.map((v) => v > 0 && v >= med * 1.35 && v - med >= 0.8);
  // most of the line bold is a bold line, not bold words
  return flags.filter(Boolean).length * 2 > ok.length ? words.map(() => false) : flags;
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One font for the whole text (documents use one typeface; a line may only
 * differ when it clearly fits another one better), bold / italic per line.
 * Bold only when the strokes are clearly thicker than in the other lines.
 */
const bestOf = (sc, ff, pred = () => true) => sc.filter((c) => c.ff === ff && pred(c)).sort((x, y) => y.score - x.score)[0];

/** The typeface that fits the whole text best. */
function mainFamily(all) {
  const fams = [...new Set(all.flat().map((c) => c.ff))];
  const total = (ff) => all.reduce((sum, sc) => { const c = bestOf(sc, ff); return sum + (c ? c.score + c.prior : 0); }, 0);
  return fams.slice().sort((x, y) => total(y) - total(x))[0];
}

/**
 * Which lines are bold. q = real stroke thickness ÷ the regular letters'
 * thickness drawn at the same size and blur (print and photos thicken all
 * strokes a little, so compare with the typical line): clearly thicker →
 * bold; headings much larger than the text are usually set bold, so less is
 * needed there; small print looks thicker without being bold.
 */
function boldLines(qs, sizes) {
  const ok = qs.map((q, k) => (q > 0 && sizes[k] > 0 ? k : -1)).filter((k) => k >= 0);
  if (!ok.length) return qs.map(() => null);
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const mq = med(ok.map((k) => qs[k])), ms = med(ok.map((k) => sizes[k]));
  return qs.map((q, k) => {
    if (!(q > 0) || !(sizes[k] > 0)) return null;
    if (ok.length < 3) return q > 1.45; // nothing to compare with: only clearly bold
    const r = q / mq, s = sizes[k] / ms;
    if (s >= 1.6) return r > 0.95;
    if (s >= 1.2) return r > 1.08;
    if (s < 0.85) return r > 1.4;
    return r > 1.25;
  });
}

function chooseFonts(all, bolds) {
  const main = mainFamily(all);
  // italic: clearly better than upright, and more than in the other lines (a
  // photo taken at a slant leans every line a little – that is not italic)
  const gainOf = (sc) => { const r = bestOf(sc, main, (c) => !c.b && !c.i), it = bestOf(sc, main, (c) => c.i); return r && it ? it.score - r.score : 0; };
  const gains = all.map(gainOf).sort((x, y) => x - y);
  const medGain = all.length >= 3 ? gains[gains.length >> 1] : 0;
  return all.map((sc, k) => {
    let ff = main;
    const own = sc.slice().sort((x, y) => y.score - x.score)[0];
    const inMain = bestOf(sc, main);
    // another kind of typeface (serif / sans / mono) only when it clearly fits
    // better – never switch between two similar sans fonts line by line
    const kind = (f) => FONTS[f].kind;
    if (own && inMain && kind(own.ff) !== kind(main) && own.score - inMain.score > 0.08) ff = own.ff;
    // bold: the real strokes compared with the regular and the bold letters
    // drawn at the same size and blur (0 = as thin as regular, 1 = as thick
    // as bold); semibold headings count as bold
    const rb = bestOf(sc, ff, (c) => !c.b && !c.i), bb = bestOf(sc, ff, (c) => c.b);
    const bold = bolds[k] !== null ? bolds[k] : !!(rb && bb && bb.score - rb.score > 0.04);
    const r = bestOf(sc, ff, (c) => c.b === bold && !c.i), it = bestOf(sc, ff, (c) => c.i && !bold);
    return it && r && it.score - r.score > Math.max(0.06, medGain + 0.05) ? it : (r || bestOf(sc, ff) || own);
  });
}

/**
 * The languages to read with once the first reading shows the script: a
 * German / English page read with Russian too gets stray Cyrillic look-alikes
 * ("Рог" for "Fior") in blurry places, and the other way round. null = keep all.
 */
function narrowLangs(lines) {
  let lat = 0, cyr = 0;
  const words = lines.flatMap((l) => l.words || []);
  for (const w of words) {
    if (w.conf < 60) continue;
    lat += (w.text.match(/[a-zA-ZäöüÄÖÜß]/g) || []).length;
    cyr += (w.text.match(/[\u0400-\u04ff]/g) || []).length;
  }
  if (lat + cyr < 20) return null;
  // (a real quote in the other script is read with confidence: keep all then)
  const stray = (re) => words.some((w) => re.test(w.text)) && !words.some((w) => re.test(w.text) && w.conf >= 85 && w.text.length >= 3);
  if (lat >= (lat + cyr) * 0.9 && stray(/[\u0400-\u04ff]/)) return ['deu', 'eng'];
  if (cyr >= (lat + cyr) * 0.9 && stray(/[äöüÄÖÜß]/)) return ['rus', 'eng'];
  return null;
}

// A word read without its umlaut (big or blurry letters lose the dots) while
// the same word appears with it elsewhere in the text: use that spelling.
function fixUmlauts(lines) {
  const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const known = new Map();
  for (const l of lines) for (const w of l.text.split(/[^\p{L}]+/u)) if (w && w !== plain(w)) known.set(plain(w).toLowerCase(), w);
  if (!known.size) return lines;
  const fix = (t) => t.replace(/\p{L}+/gu, (w) => {
    if (w !== plain(w)) return w;
    const k = known.get(w.toLowerCase());
    if (!k) return w;
    return w[0] === w[0].toUpperCase() ? k[0].toUpperCase() + k.slice(1) : k[0].toLowerCase() + k.slice(1);
  });
  return lines.map((l) => ({ ...l, text: fix(l.text), words: (l.words || []).map((w) => ({ ...w, text: fix(w.text) })) }));
}

/** Typical paper colour (bright pixels). */
function paperColor(im) {
  const d = im.data, px = [];
  for (let i = 0; i < d.length; i += 4 * 97) px.push([d[i] + d[i + 1] + d[i + 2], d[i], d[i + 1], d[i + 2]]);
  px.sort((a, b) => b[0] - a[0]);
  const p = px[Math.floor(px.length * 0.2)] || [0, 255, 255, 255];
  return [p[1], p[2], p[3]];
}

/** Light text on a dark background (dark mode screenshots, menus, signs)? */
function isDark(im) {
  const d = im.data, v = [];
  for (let i = 0; i < d.length; i += 4 * 53) v.push(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
  v.sort((a, b) => a - b);
  return v.length > 0 && v[v.length >> 1] < 100;
}

/** Share of clearly dark pixels. */
function darkShare(im) {
  const d = im.data;
  let n = 0, all = 0;
  for (let i = 0; i < d.length; i += 4 * 29) { all++; if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 100) n++; }
  return all ? n / all : 0;
}

/** Lines from a second reading where the first found nothing (or something worse). */
function mergeLines(a, b) {
  const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  const inter = (p, q) => area({ x0: Math.max(p.x0, q.x0), y0: Math.max(p.y0, q.y0), x1: Math.min(p.x1, q.x1), y1: Math.min(p.y1, q.y1) });
  const out = a.slice();
  for (const l of b) {
    if (!(l.conf >= 50)) continue;
    const hit = out.filter((o) => inter(o.bbox, l.bbox) > 0.3 * Math.min(area(o.bbox), area(l.bbox)));
    if (!hit.length) { out.push(l); continue; }
    // (only the lines it really covers count, not a neighbour it touches)
    const main = hit.filter((o) => inter(o.bbox, l.bbox) > 0.5 * area(o.bbox));
    if (main.length && main.every((o) => l.conf > o.conf + 5)) { for (const o of main) out.splice(out.indexOf(o), 1); out.push(l); }
  }
  return out.sort((p, q) => p.bbox.y0 - q.bbox.y0);
}

function invert(im) {
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
}

const invertHex = (c) => '#' + (0xffffff ^ parseInt(String(c).slice(1, 7), 16)).toString(16).padStart(6, '0');

/** Tilt of the text in degrees (median of the long lines' baselines). */
function skewOf(lines) {
  const a = lines.filter((l) => l.baseline && l.baseline.x1 - l.baseline.x0 > 80)
    .map((l) => (Math.atan2(l.baseline.y1 - l.baseline.y0, l.baseline.x1 - l.baseline.x0) * 180) / Math.PI)
    .filter((v) => Math.abs(v) < 20).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0;
}

function dilateMask(m, w, h, r) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) out[Y * w + X] = 1;
    }
  }
  return out;
}

/**
 * Lines → text boxes: lines that belong together (see shared/scan-layout.js)
 * become one box with the lines one under the other, in the scan's spacing
 * and alignment. Returns the boxes and, for every line, its box and row.
 */
function joinParagraphs(texts, lines, fonts, r, S) {
  const items = texts.map((t, k) => ({
    x0: r.x0 + lines[k].bbox.x0 / S, x1: r.x0 + lines[k].bbox.x1 / S, cy: t.y + (t.fs * LINE_H) / 2,
    fs: t.fs, ff: t.ff, c: t.c, hand: !!fonts[k].hand, warp: !!(t.q || t.r || t.cg),
  }));
  const groups = paragraphs(items);
  const boxes = [], lineOf = texts.map((t) => ({ id: t.id, j: 0 }));
  for (const g of groups) {
    const ts = g.idx.map((k) => texts[k]);
    if (ts.length === 1) { boxes.push(ts[0]); continue; }
    const first = ts[0];
    const lh = Math.round((g.pitch / first.fs) * 100) / 100;
    // bold / italic / underlined: for the box when all its lines are, else per line
    const all = (key) => ts.every((t) => t[key]);
    const base = { b: all('b'), i: all('i'), u: all('u') };
    const rich = ts.some((t) => t.html || ['b', 'i', 'u'].some((key) => !!t[key] !== base[key]));
    const row = (t) => {
      let x = t.html || escHtml(t.text);
      if (t.b && !base.b) x = `<b>${x}</b>`;
      if (t.i && !base.i) x = `<i>${x}</i>`;
      if (t.u && !base.u) x = `<u>${x}</u>`;
      return x;
    };
    const x0 = Math.min(...ts.map((t) => t.x)), x1 = Math.max(...g.idx.map((k) => items[k].x1)) + first.fs * 0.2;
    const box = { ...first, y: round2(items[g.idx[0]].cy - (lh * first.fs) / 2), text: ts.map((t) => t.text).join('\n'), lh, b: base.b || undefined, i: base.i || undefined, u: base.u || undefined };
    if (rich) box.html = ts.map(row).join('\n'); else delete box.html;
    // the blur of the scan: the box's lines' typical value
    const looks = ts.map((t) => t.look || 0).sort((p, q) => p - q);
    if (looks[looks.length >> 1] > 0) { box.look = looks[looks.length >> 1]; box.fx = box.look; } else { delete box.look; delete box.fx; }
    if (g.al === 'left') { box.x = round2(x0); box.aw = true; box.w = round2(x1 - x0 + first.fs); } else {
      // centred / right: a fixed width (a little wider: our font may be wider)
      const slack = (x1 - x0) * 0.06 + first.fs;
      box.al = g.al; delete box.aw;
      box.x = round2(g.al === 'center' ? x0 - slack / 2 : x0 - slack); box.w = round2(x1 - x0 + slack);
    }
    boxes.push(box);
    g.idx.forEach((k, j) => { lineOf[k] = { id: box.id, j }; });
  }
  return { boxes, lineOf };
}

module.exports = { CLASSIC, PRIOR, familiesFor, HAND, edgeSoftness, strokeWeight, boldWords, escHtml, bestOf, mainFamily, boldLines, chooseFonts, narrowLangs, fixUmlauts, paperColor, isDark, darkShare, mergeLines, invert, invertHex, skewOf, dilateMask, joinParagraphs };
