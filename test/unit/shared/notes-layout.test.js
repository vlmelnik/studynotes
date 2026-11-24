'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../../../src/shared/notes-layout');
const { parseRich } = require('../../../src/shared/richtext');

// width estimate: half the font size per character (bold a bit wider)
const measure = (t, r) => t.length * (r.fs || 15) * (r.b ? 0.56 : 0.5);
let n = 0;
const ctx = (pages, data = {}, more = {}) => ({
  pages, data: (id) => data[id], style: L.notesStyle(), measure, newId: () => 'id' + (++n),
  newPage: (ref) => ({ id: 'np' + (++n), kind: 'paper', paper: ref.kind === 'pdf' ? 'lined' : ref.paper, pc: ref.pc, w: ref.w, h: ref.h }), ...more,
});
const A4 = { w: 595.28, h: 841.89 };
const lined = (id, pc) => ({ id, kind: 'paper', paper: 'lined', pc, ...A4 });

test('pageRows: lined paper uses its 24 pt lines and the margin line', () => {
  const g = L.pageRows(lined('a'), 15);
  assert.strictEqual(g.rows[1] - g.rows[0], 24);
  assert.strictEqual(g.rows[0], 72);
  assert.strictEqual(g.left, 68);
});

test('pageRows: blank paper gets an even spacing, grid paper every second line', () => {
  const b = L.pageRows({ id: 'b', kind: 'paper', paper: 'blank', ...A4 }, 15);
  assert.strictEqual(b.rows[1] - b.rows[0], 24);
  const g = L.pageRows({ id: 'g', kind: 'paper', paper: 'grid', ...A4 }, 15);
  assert.ok(Math.abs(g.rows[1] - g.rows[0] - 2 * 5 * 2.8346) < 0.1, String(g.rows[1] - g.rows[0]));
});

test('inlineHtml: bold in the accent colour, italic, underline, formulas as inline elements', () => {
  const h = L.inlineHtml('A **key** term, *soft*, __line__ and $U_2 > U_1$.', '#ff0000');
  assert.ok(h.includes('<span data-c="#ff0000"><b>key</b></span>'));
  assert.ok(h.includes('<i>soft</i>') && h.includes('<u>line</u>'));
  assert.ok(h.includes('data-x="rich-paste:math" data-v="U_2 &gt; U_1"'), h);
  const runs = parseRich(h).flat();
  assert.ok(runs.some((r) => r.ix === 'rich-paste:math' && r.iv === 'U_2 > U_1'));
});

test('checkBlocks: keeps good blocks, names the bad ones', () => {
  const r = L.checkBlocks([{ type: 'heading', text: 'T', level: 1 }, { type: 'image' }, { type: 'list', items: [] }, { type: 'formula', latex: '$$a=b$$' }]);
  assert.deepStrictEqual(r.blocks.map((b) => b.type), ['heading', 'formula']);
  assert.strictEqual(r.blocks[1].latex, 'a=b');
  assert.strictEqual(r.problems.length, 2);
});

test('layoutNotes: every line sits on a ruled line, inside the margins, in the notes style', () => {
  const p = lined('a');
  const { blocks } = L.checkBlocks([
    { type: 'heading', level: 1, text: 'Ferranti effect' },
    { type: 'paragraph', text: 'On a long **unloaded** line the voltage at the end can be higher than at the start.' },
    { type: 'list', items: ['capacitive charging current', 'line inductance'] },
    { type: 'formula', latex: 'U_1 = (1-\\omega^2 LC) U_2' },
    { type: 'box', title: 'Remember', text: 'The capacitance and the inductance together raise the voltage.' },
  ]);
  const r = L.layoutNotes(blocks, 0, ctx([p]));
  const texts = r.changes[0].after.texts;
  assert.strictEqual(texts.length, 6);
  const g = L.pageRows(p, 15);
  for (const t of texts) {
    // the line box is centred on k rows ending on a ruled line
    const L0 = t.fs * t.lh;
    const baseline = t.y + L0 / 2 + t.fs * 0.32 + (t.bg ? 4 : 0);
    assert.ok(g.rows.some((y) => Math.abs(y - 2 - baseline) < 0.05), `${t.text} baseline ${baseline}`);
    assert.ok(Math.abs((L0 % 24)) < 0.05 || Math.abs((L0 % 24) - 24) < 0.05, `line height ${L0} is a multiple of the ruling`);
    assert.ok(t.x >= 68 && t.x + t.w <= p.w - 40 + 0.01);
  }
  const [h1, para] = texts;
  const st = L.notesStyle();
  assert.ok(h1.fs > para.fs && h1.b && h1.c === st.light.h1 && para.c === st.light.text);
  assert.ok(texts[4].html.includes('data-display="1"'));
  assert.strictEqual(texts[5].bg, st.light.boxBg);
  // the letters of one block never reach into the next (last baseline + descent < next cap height)
  const base = (t) => t.y + (t.fs * t.lh) / 2 + t.fs * 0.32 + (t.bg ? 4 : 0);
  const s = texts.slice().sort((a, b) => a.y - b.y);
  for (let i = 1; i < s.length; i++) {
    const prevLast = base(s[i - 1]) + (s[i - 1].lines - 1) * s[i - 1].fs * s[i - 1].lh;
    assert.ok(prevLast + s[i - 1].fs * 0.25 < base(s[i]) - s[i].fs * 0.75, `${s[i].text} runs into ${s[i - 1].text}`);
  }
});

test('layoutNotes: dark paper gets the light colours', () => {
  const r = L.layoutNotes([{ type: 'paragraph', text: 'x' }], 0, ctx([lined('d', 'dark')]));
  assert.strictEqual(r.changes[0].after.texts[0].c, L.notesStyle().dark.text);
});

test('layoutNotes: starts below what is on the page', () => {
  const p = lined('a');
  const data = { a: { strokes: [{ p: [100, 300, 0.5, 120, 310, 0.5] }], texts: [], items: [] } };
  const r = L.layoutNotes([{ type: 'paragraph', text: 'after the ink' }], 0, ctx([p], data));
  const t = r.changes[0].after.texts[0];
  assert.ok(t.y > 310, String(t.y));
  assert.strictEqual(r.changes[0].after.strokes.length, 1);
});

test('layoutNotes: a long text goes on to new pages, never past the bottom', () => {
  const p = lined('a');
  const long = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} explains one more detail of the topic.`).join(' ');
  const r = L.layoutNotes([{ type: 'heading', level: 2, text: 'Long' }, { type: 'paragraph', text: long }], 0, ctx([p]));
  assert.ok(r.added.length >= 2, String(r.added.length));
  assert.strictEqual(r.pages.length, 1 + r.added.length);
  for (const c of r.changes) for (const t of c.after.texts) assert.ok(t.y + t.h <= p.h - 20, `${t.y + t.h}`);
  // nothing is lost
  const all = r.changes.flatMap((c) => c.after.texts).map((t) => t.text).join(' ');
  assert.ok(all.includes('Sentence number 0 ') && all.includes('Sentence number 119 '));
});

test('layoutNotes: never writes over a PDF page', () => {
  const pdf = { id: 'p', kind: 'pdf', pdfPage: 0, ...A4 };
  const r = L.layoutNotes([{ type: 'paragraph', text: 'summary' }], 0, ctx([pdf]));
  assert.strictEqual(r.pages[1].paper, 'lined');
  assert.ok(!r.changes.some((c) => c.pageId === 'p' && c.after.texts.length));
});

test('notesStyle: app and notebook settings override the defaults, bad values are ignored', () => {
  const s = L.notesStyle({ fs: 13, ff: 'serif', dark: { text: '#ffffff' } }, { light: { h1: 'red' }, fs: 99 });
  assert.strictEqual(s.fs, 13);
  assert.strictEqual(s.ff, 'serif');
  assert.strictEqual(s.dark.text, '#ffffff');
  assert.strictEqual(s.light.h1, L.DEFAULT_STYLE.light.h1);
});

test('pageSummary names ink, pictures and how full the page is', () => {
  const s = L.pageSummary(lined('a', 'dark'), { strokes: [{ p: [0, 400, 1] }], items: [{ type: 'img', y: 0, h: 10 }], texts: [] });
  assert.ok(/lined paper, dark/.test(s) && /1 handwritten stroke/.test(s) && /1 picture/.test(s) && /48%/.test(s), s);
});

test('place "free": fills the empty rows between old notes, one empty row apart, without touching them', () => {
  const p = lined('a');
  // old notes: a text box near the top and ink in the lower half
  const data = { a: { strokes: [{ p: [100, 500, 0.5, 400, 560, 0.5] }], texts: [{ id: 'o', x: 70, y: 60, w: 300, h: 24, fs: 15, lines: 1 }], items: [] } };
  const r = L.layoutNotes([{ type: 'paragraph', text: 'fits in the gap' }, { type: 'paragraph', text: 'also' }], 0, ctx([p], data, { place: 'free' }));
  const ts = r.changes[0].after.texts.filter((t) => t.id !== 'o');
  assert.strictEqual(r.added.length, 0);
  for (const t of ts) {
    assert.ok(t.y > 84 + 10, `below the old text with a gap: ${t.y}`);
    assert.ok(t.y + t.h < 500 - 10, `above the ink: ${t.y + t.h}`);
  }
});

test('place "free": a block too big for a gap goes to the next gap or page', () => {
  const p = lined('a');
  // ink leaves only a 3-row gap at the top
  const data = { a: { strokes: [{ p: [100, 160, 0.5, 400, 820, 0.5] }], texts: [], items: [] } };
  const long = Array.from({ length: 20 }, () => 'A sentence that takes some room on the line.').join(' ');
  const r = L.layoutNotes([{ type: 'heading', level: 2, text: 'H' }, { type: 'paragraph', text: long }], 0, ctx([p], data, { place: 'free' }));
  const onA = r.changes.find((c) => c.pageId === 'a').after.texts;
  for (const t of onA) assert.ok(t.y + t.h < 160, `stays above the ink: ${t.y + t.h}`);
  assert.ok(r.added.length >= 1);
});

test('place "next": starts on the next empty page, else a new one', () => {
  const a = lined('a'), b = lined('b');
  const r = L.layoutNotes([{ type: 'paragraph', text: 'x' }], 0, ctx([a, b], {}, { place: 'next' }));
  assert.strictEqual(r.placed[0].index, 1);
  assert.strictEqual(r.added.length, 0);
  const r2 = L.layoutNotes([{ type: 'paragraph', text: 'x' }], 1, ctx([a, b], {}, { place: 'next' }));
  assert.strictEqual(r2.added.length, 1);
  assert.strictEqual(r2.placed[0].index, 2);
});

test('image block: an attached picture, centred, below the text before it, caption under it', () => {
  const p = lined('a');
  const blocks = L.checkBlocks([{ type: 'paragraph', text: 'Circuit:' }, { type: 'image', ref: 'a1', caption: 'Equivalent circuit', size: 'medium' }, { type: 'paragraph', text: 'after' }, { type: 'image', ref: 'nope' }]).blocks;
  const r = L.layoutNotes(blocks, 0, ctx([p], {}, { images: { a1: { src: 'assets/x.png', w: 400, h: 200 } } }));
  const d = r.changes[0].after;
  const img = d.items[0];
  const [para, cap, after] = d.texts;
  assert.strictEqual(img.src, 'assets/x.png');
  assert.ok(Math.abs(img.x + img.w / 2 - (68 + (p.w - 40)) / 2) < 1, 'centred between the margins');
  assert.ok(img.w / img.h === 2);
  assert.ok(img.y > para.y + 10 && cap.y > img.y + img.h - 10 && after.y > cap.y, JSON.stringify({ img, cap: cap.y, after: after.y }));
  assert.ok(cap.html.includes('<i>'));
  assert.deepStrictEqual(r.problems, ['picture "nope" is not attached']);
});

test('presets: pastel puts a marker behind headings only as wide as the text; tones and definitions', () => {
  const style = L.notesStyle({ preset: 'pastel' });
  assert.strictEqual(style.ff, 'pangolin');
  const { blocks } = L.checkBlocks([
    { type: 'heading', level: 1, text: 'Benzodiazepines' },
    { type: 'definition', term: 'Benzo', text: 'fast relief' },
    { type: 'definition', term: 'SSRI', text: 'maintenance' },
    { type: 'paragraph', tone: 'warning', text: 'Can make anxiety worse at first.' },
    { type: 'paragraph', tone: 'note', text: 'p. 110' },
    { type: 'formula', latex: 'x' },
  ]);
  const r = L.layoutNotes(blocks, 0, ctx([lined('a')], {}, { style }));
  const [h1, d1, d2, warn, note, f] = r.changes[0].after.texts;
  assert.strictEqual(h1.bg, style.light.h1Bg);
  assert.ok(h1.w < 300, `marker fits the text: ${h1.w}`);
  assert.ok(d1.html.startsWith(`<span data-c="${style.light.accent}"><b>Benzo</b></span>: fast relief`), d1.html);
  assert.ok(Math.abs(d2.y - d1.y - 24) < 0.01, 'definitions follow each other without an empty line');
  assert.strictEqual(warn.c, style.light.warn);
  assert.strictEqual(note.c, style.light.note);
  assert.strictEqual(f.c, style.light.formula);
});

test('presets: night pastel on dark paper; own changes on top of a preset', () => {
  const s = L.notesStyle({ preset: 'night' }, { dark: { note: '#ffff00' } });
  assert.strictEqual(s.dark.formula, '#c9a7f5');
  assert.strictEqual(s.dark.note, '#ffff00');
  assert.strictEqual(L.notesStyle({ preset: 'night' }, { preset: 'classic' }).ff, 'inter');
});
