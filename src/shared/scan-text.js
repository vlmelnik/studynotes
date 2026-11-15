'use strict';
// Recognised text to editable text: font choice, bold, languages, umlauts,
// line merging, tilt, paragraphs, paper and ink colours.
// Pure functions on OCR results and RGBA ImageData-like objects: unit-tested.
// (moved unchanged from src/renderer/scan-edit.js)

const { FONTS } = require('./fonts');
const { round2 } = require('./geometry');
const { paragraphs } = require('./scan-layout');
const { LINE_H, escHtml, median, medianOr0 } = require('./util');

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

/** Stroke thickness of every word of a line in pixels (0: too short to measure). */
function wordWeights(li, words) {
  return words.map((w) => {
    const letters = (String(w.text || '').match(/[\p{L}\p{N}]/gu) || []).length;
    if (!w.bbox || letters < 3) return 0;
    const x0 = Math.max(0, Math.round(w.bbox.x0 - li.box.x0)), x1 = Math.min(li.w, Math.round(w.bbox.x1 - li.box.x0));
    if (x1 - x0 < 4) return 0;
    const ink = new Uint8Array((x1 - x0) * li.h);
    for (let y = 0; y < li.h; y++) ink.set(li.ink.subarray(y * li.w + x0, y * li.w + x1), y * (x1 - x0));
    return strokeWeight({ w: x1 - x0, h: li.h, ink });
  });
}

/**
 * Words printed in bold inside a regular line ("the **deposit** is due"):
 * their strokes are clearly thicker than those of the line's other words.
 * Returns one flag per word (all false when unsure).
 */
function boldWords(li, words) {
  const ws = wordWeights(li, words);
  const ok = ws.filter((v) => v > 0).sort((a, b) => a - b);
  if (ok.length < 3) return words.map(() => false);
  const med = ok[ok.length >> 1];
  // (thin strokes of one or two pixels: too coarse to tell)
  if (med < 1.5) return words.map(() => false);
  const flags = ws.map((v) => v > 0 && v >= med * 1.35 && v - med >= 0.8);
  // most of the line bold is a bold line, not bold words
  return flags.filter(Boolean).length * 2 > ok.length ? words.map(() => false) : flags;
}

/**
 * Bold on a page of text, from its words: most words of a document are
 * regular, so a word whose strokes are clearly thicker than the page's typical
 * word (at its size) is bold. A line is bold when (nearly) all its words are;
 * a line with a few such words is regular with those words in bold ("**Wer**
 * muss den Unfall anzeigen?") – a whole-line measure lands in between and
 * says "bold" for one line and "regular" for the next.
 * weights: per line the stroke thickness of its words (see wordWeights; null:
 * not measured), sizes: letter size per line, lineBolds: what the line
 * measure says (boldLines) – it stays where the words say nothing: a page
 * with too few words, or one whose words all weigh about the same (all
 * regular, or all bold).
 * Returns { lines: [bold?], words: [flags per word | null] }.
 */
function boldByWords(weights, sizes, lineBolds) {
  const keep = { lines: lineBolds, words: weights.map(() => null) };
  const rel = weights.map((ws, k) => (ws && sizes[k] > 0 ? ws.map((v) => v / sizes[k]) : null));
  const all = rel.flatMap((r) => (r || []).filter((v) => v > 0));
  if (all.length < 6) return keep;
  // two kinds of words? (thin and thick strokes: two heaps of values)
  const sorted = all.slice().sort((x, y) => x - y);
  let lo = sorted[Math.floor(sorted.length * 0.25)], hi = sorted[sorted.length - 1], nHi = 0;
  for (let pass = 0; pass < 12; pass++) {
    let a = 0, na = 0, b = 0, nb = 0;
    for (const v of sorted) { if (Math.abs(v - lo) <= Math.abs(v - hi)) { a += v; na++; } else { b += v; nb++; } }
    if (!na || !nb) return keep;
    lo = a / na; hi = b / nb; nHi = nb;
  }
  // (bold strokes are a good fifth thicker at least; most words are regular)
  if (hi < lo * 1.2 || nHi > sorted.length * 0.45) return keep;
  const thr = (lo + hi) / 2;
  const heavy = (k, i) => rel[k][i] >= thr && weights[k][i] - lo * sizes[k] >= 0.5;
  const light = (k, i) => rel[k][i] > 0 && rel[k][i] <= lo * 1.08;
  const flags = rel.map((r, k) => (r ? r.map((v, i) => v > 0 && heavy(k, i)) : null));
  if (!flags.some((f) => f && f.some(Boolean))) return keep;
  const lines = lineBolds.slice(), words = weights.map(() => null);
  flags.forEach((f, k) => {
    if (!f) return;
    const n = rel[k].filter((v) => v > 0).length, nb = f.filter(Boolean).length;
    if (!n) return;
    if (nb >= n * 0.75) { lines[k] = true; return; }
    // (a heading in larger letters: its strokes are a little thinner for its
    // size – bold by the line's measure and no word as thin as regular ones)
    if (lineBolds[k] && !nb && !rel[k].some((v, i) => light(k, i))) return;
    lines[k] = false;
    if (!nb) return;
    // short words (not measured) between or beside bold ones belong to them
    const out = f.slice();
    const bold = (i) => i >= 0 && i < f.length && f[i];
    for (let i = 0; i < f.length; i++) {
      if (rel[k][i] > 0) continue;
      let a = i - 1, b = i + 1;
      while (a >= 0 && !(rel[k][a] > 0)) a--;
      while (b < f.length && !(rel[k][b] > 0)) b++;
      out[i] = (a < 0 || bold(a)) && (b >= f.length || bold(b)) && (a >= 0 || b < f.length);
    }
    words[k] = out;
  });
  return { lines, words };
}

/**
 * One font for the whole text (documents use one typeface; a line may only
 * differ when it clearly fits another one better), bold / italic per line.
 * Bold only when the strokes are clearly thicker than in the other lines.
 */
const bestOf = (sc, ff, pred = () => true) => sc.filter((c) => c.ff === ff && pred(c)).sort((x, y) => y.score - x.score)[0];

/**
 * The typeface for the whole text: the one that fits best – when it is
 * clearly ahead of the next one of its kind. A text set in a typeface the
 * app does not have fits several similar ones about equally, and which of
 * them wins changes with the picture (PT Sans, then Noto Sans, then
 * Roboto …): then the everyday typeface of that kind is taken instead, the
 * same one every time.
 */
function familyChoice(all) {
  const fams = [...new Set(all.flat().map((c) => c.ff))];
  const total = (ff) => all.reduce((sum, sc) => { const c = bestOf(sc, ff); return sum + (c ? c.score + c.prior : 0); }, 0);
  const ranked = fams.slice().sort((x, y) => total(y) - total(x));
  const best = ranked[0];
  if (!best || !FONTS[best]) return { ff: best, sure: false };
  const kind = FONTS[best].kind;
  const second = ranked.find((f) => f !== best && FONTS[f] && FONTS[f].kind === kind);
  // sure: recognised, not just the nearest of several look-alikes
  const sure = !second || (total(best) - total(second)) / Math.max(1, all.length) >= CLEAR_LEAD;
  const everyday = ranked.find((f) => CLASSIC.has(f) && FONTS[f] && FONTS[f].kind === kind);
  return { ff: sure || CLASSIC.has(best) || !everyday ? best : everyday, sure };
}
const mainFamily = (all) => familyChoice(all).ff;
// lead over the next typeface of the kind (correlation per line) from which
// the best fit counts as recognised
const CLEAR_LEAD = 0.025;

/**
 * Which lines are bold. q = real stroke thickness ÷ the regular letters'
 * thickness drawn at the same size and blur (print and photos thicken all
 * strokes a little, so compare with the typical line): clearly thicker →
 * bold; headings much larger than the text are usually set bold, so less is
 * needed there; small print looks thicker without being bold.
 *
 * That comparison alone misses a text that is bold throughout. Two measures
 * that need no other line (m, all optional):
 * - ps: where the strokes stand between the regular (0) and the bold (1)
 *   letters – sure on a sharp picture (soft = blur ÷ letter size is small),
 *   useless on a blurred one (small blurred print looks bolder than bold);
 * - ds: how much better the bold letters fit than the regular ones (score
 *   difference) – holds on blurred pictures too, but not for monospaced
 *   typefaces (mono), whose bold letters always fit a little better.
 * Both compare with the letters of the chosen typeface, so they count only
 * when that typeface was recognised (m.known): the strokes of an unknown,
 * heavier typeface would pass for bold.
 */
function boldLines(qs, sizes, m = {}) {
  const ok = qs.map((q, k) => (q > 0 && sizes[k] > 0 ? k : -1)).filter((k) => k >= 0);
  if (!ok.length) return qs.map(() => null);
  const mq = median(ok.map((k) => qs[k])), ms = median(ok.map((k) => sizes[k]));
  const relative = (q, k) => {
    if (ok.length < 3) return q > 1.45; // nothing to compare with: only clearly bold
    const r = q / mq, s = sizes[k] / ms;
    if (s >= 1.6) return r > 0.95;
    if (s >= 1.2) return r > 1.08;
    if (s < 0.85) return r > 1.4;
    return r > 1.25;
  };
  const ps = m.ps || [], ds = m.ds || [];
  const known = m.known !== false;
  const sharp = known && m.soft != null && m.soft < SHARP;
  // a blurred picture: is the typical line bold?
  const dOk = ok.map((k) => ds[k]).filter((d) => d != null);
  const allBold = known && !sharp && !m.mono && dOk.length > 0 && median(dOk) > 0.004;
  return qs.map((q, k) => {
    if (!(q > 0) || !(sizes[k] > 0)) return null;
    if (sharp && ps[k] != null) return ps[k] >= 0.55;
    // the typical line is bold: so is this one, unless clearly thinner
    if (allBold) return q / mq > 0.82 || relative(q, k);
    return relative(q, k);
  });
}
// blur ÷ letter size below which stroke thickness can be trusted
const SHARP = 0.015;

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
    if (own && inMain && kind(own.ff) !== kind(main) && own.score - inMain.score > 0.08) {
      // … and then that kind's everyday typeface, unless one of its kind is clearly ahead on this line
      const next = sc.filter((c) => c.ff !== own.ff && kind(c.ff) === kind(own.ff)).sort((x, y) => y.score - x.score)[0];
      const everyday = sc.filter((c) => CLASSIC.has(c.ff) && kind(c.ff) === kind(own.ff)).sort((x, y) => y.score - x.score)[0];
      ff = !next || own.score - next.score >= CLEAR_LEAD || !everyday ? own.ff : everyday.ff;
    }
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
 * Is the whole text handwritten? jitters: how unevenly the letters of each
 * surely read line stand compared with the best printed typeface (0 = like
 * print), confs: how sure the reading of those lines is (0–100).
 * The typical line decides – but only from three lines on: with one or two,
 * a single odd line (a label with an index, a date, a line full of
 * underscores) would turn printed text into "handwriting", so there every
 * line has to stand unevenly.
 */
function handwrittenPage(jitters, confs) {
  if (jitters.length < 2) return false;
  if (jitters.length < 3) return jitters.every((j) => j > 0.3);
  const j = medianOr0(jitters);
  return j > 0.25 || (medianOr0(confs) < 80 && j > 0.15);
}

/**
 * The lines every typeface is tried on when a text is long (indexes into
 * lines): up to `max` lines spread evenly over the text, preferring long ones
 * (more letters, a surer match), plus every line of clearly another size
 * (headings may be set in another typeface). All lines when there are few.
 */
function sampleLines(lines, max = 10) {
  const n = lines.length;
  if (n <= max) return lines.map((_, k) => k);
  const hs = lines.map((l) => l.bbox.y1 - l.bbox.y0), sorted = hs.slice().sort((a, b) => a - b), med = sorted[n >> 1];
  const pick = new Set();
  // (headings: at most as many again, the largest first)
  hs.map((h, k) => [h, k]).filter(([h]) => h > med * 1.25 || h < med * 0.75).sort((a, b) => b[0] - a[0]).slice(0, max).forEach(([, k]) => pick.add(k));
  // one line from each of `max` stretches of the text: the longest there
  for (let i = 0; i < max; i++) {
    const a = Math.floor((i * n) / max), b = Math.floor(((i + 1) * n) / max);
    let best = a;
    for (let k = a; k < b; k++) if (lines[k].text.trim().length > lines[best].text.trim().length) best = k;
    pick.add(best);
  }
  return [...pick].sort((a, b) => a - b);
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
/**
 * Lines with letters of a script the page is not written in: on a page that
 * is Latin throughout a "word" in Cyrillic letters is a misreading ("zur" →
 * "гиг", "z. B." → "2. В.") however sure the reader was. Returns
 * { langs, idx } – the lines to read once more and the languages for it – or
 * null (too little text, a mixed page, or more than a few such lines).
 */
function strayScript(lines) {
  const CYR = /[\u0400-\u04ff]/g, LAT = /[a-zA-ZäöüÄÖÜß]/g;
  let lat = 0, cyr = 0;
  const per = lines.map((l) => { const a = (l.text.match(LAT) || []).length, b = (l.text.match(CYR) || []).length; lat += a; cyr += b; return [a, b]; });
  if (lat + cyr < 40) return null;
  const main = lat >= (lat + cyr) * 0.95 ? 0 : cyr >= (lat + cyr) * 0.95 ? 1 : -1;
  if (main < 0) return null;
  // (Latin letters in a Russian text may be a name or a unit: only whole lines)
  const idx = per.map((n, k) => (main === 0 ? n[1] > 0 : n[0] > 0 && n[1] === 0) ? k : -1).filter((k) => k >= 0);
  if (!idx.length || idx.length > Math.max(3, lines.length * 0.25)) return null;
  return { langs: main === 0 ? ['deu', 'eng'] : ['rus', 'eng'], idx };
}

/** "l. Heading", "Il. Heading": a Roman numeral read as small L's. */
const romanStart = (text) => String(text).replace(/^([Il]{1,3})\.(?=\s+\p{Lu})/u, (m, n) => (n.includes('l') ? n.replace(/l/g, 'I') + '.' : m));

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
/**
 * One size for text of one size: every line's size is measured, so lines of
 * the same print come out a few percent apart (10.0, 10.4, 9.8 pt) and the
 * page looks uneven. Sizes within 8 % of each other, three lines or more, take
 * their typical value. sizes: [number | null (leave as it is)].
 */
function evenSizes(sizes) {
  const out = sizes.slice();
  const idx = sizes.map((v, k) => (v > 0 ? k : -1)).filter((k) => k >= 0).sort((a, b) => sizes[a] - sizes[b]);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && sizes[idx[j + 1]] <= sizes[idx[i]] * 1.08) j++;
    if (j - i >= 2) { const m = round2(median(idx.slice(i, j + 1).map((k) => sizes[k]))); for (let q = i; q <= j; q++) out[idx[q]] = m; }
    i = j + 1;
  }
  return out;
}

function joinParagraphs(texts, lines, fonts, r, S) {
  // (straight printed lines only; the line stays centred where it was)
  const even = evenSizes(texts.map((t, k) => (fonts[k].hand || t.q || t.r ? null : t.fs)));
  texts = texts.map((t, k) => (even[k] && even[k] !== t.fs ? { ...t, fs: even[k], y: round2(t.y + ((t.fs - even[k]) * LINE_H) / 2) } : t));
  const items = texts.map((t, k) => ({
    x0: r.x0 + lines[k].bbox.x0 / S, x1: r.x0 + lines[k].bbox.x1 / S, cy: t.y + (t.fs * LINE_H) / 2,
    fs: t.fs, ff: t.ff, c: t.c, b: !!t.b, text: t.text, hand: !!fonts[k].hand, warp: !!(t.q || t.r),
  }));
  const groups = paragraphs(items);
  const boxes = [], lineOf = texts.map((t) => ({ id: t.id, j: 0 }));
  for (const g of groups) {
    const ts = g.idx.map((k) => texts[k]);
    if (ts.length === 1) { boxes.push(ts[0]); continue; }
    // one size for the block: its lines' typical one (each was measured)
    const first = { ...ts[0], fs: round2(medianOr0(ts.map((t) => t.fs))) };
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
    delete box.cg; // (one box: no per-line colour stops)
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

module.exports = { handwrittenPage, sampleLines, CLASSIC, PRIOR, familiesFor, HAND, edgeSoftness, strokeWeight, boldWords, wordWeights, boldByWords, bestOf, mainFamily, familyChoice, boldLines, chooseFonts, narrowLangs, strayScript, romanStart, fixUmlauts, paperColor, isDark, darkShare, mergeLines, invert, invertHex, skewOf, dilateMask, evenSizes, joinParagraphs };
