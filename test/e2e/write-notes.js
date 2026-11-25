// Notes written by Claude (write_notes, clear_page) on real pages: on the ruled
// lines, inside the margins, in the notes style for dark paper, no text box
// wraps to more lines than planned (so nothing runs off the lines), a long
// text continues on new pages, clearing asks first, one Ctrl+Z each.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/write-notes.js   (SHOT=<dir> for screenshots)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { check, errors, finish } = require('./harness/report');
const { launch } = require('./harness/app');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-wn-'));
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\sn-wn-test-${process.pid}` : path.join(tmp, 'mcp.sock');
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_MCP_PIPE: pipe } });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'Ferranti', paper: 'lined', pc: 'dark', pageCount: 2 }); await window.__app.openNotebook(r); });
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);
  await ed(() => window.__app.mcp.setEnabled(true));
  // old notes: some ink and a text box on page 1
  await ed(() => {
    const e = window.__app.active;
    const id = e.pages[0].id;
    const d = e.pageData(id);
    e.commit(id, d, { ...d, strokes: [{ id: 's1', tool: 'pen', c: '#ffffff', w: 2, p: [100, 120, 0.5, 300, 140, 0.5, 200, 160, 0.5] }], texts: [{ id: 'old', x: 80, y: 180, w: 300, fs: 14, c: '#ffffff', text: 'old text', lines: 1 }] });
  });

  const run = (name, args) => ed(([n, a]) => window.__app.mcp.run(n, a).then((r) => ({ r }), (e) => ({ err: String(e.message) })), [name, args]);

  // ---- read_notebook tells about the ink ----
  const read = await run('read_notebook', { notebook: 'Ferranti' });
  check('read_notebook says what else is on the page', /## Page 1 \[lined paper, dark, 1 handwritten stroke/.test(read.r), read.r && read.r.slice(0, 200));

  // ---- clear_page asks first ----
  const clearing = run('clear_page', { notebook: 'Ferranti', pages: [1] });
  await win.locator('.modal', { hasText: 'Claude wants to clear pages' }).waitFor();
  await win.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
  const no = await clearing;
  check('clear_page: "Cancel" keeps the page and tells Claude', /did not allow/.test(no.err || '') && await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).strokes.length === 1), JSON.stringify(no));
  const clearing2 = run('clear_page', { notebook: 'Ferranti', pages: [1] });
  await win.locator('.modal', { hasText: 'Claude wants to clear pages' }).waitFor();
  await win.locator('.modal').getByRole('button', { name: 'Clear' }).click();
  const yes = await clearing2;
  const empty = await ed(() => { const d = window.__app.active.pageData(window.__app.active.pages[0].id); return d.strokes.length + d.texts.length + d.items.length; });
  check('clear_page: "Clear" removes ink and text', /Cleared page 1/.test(yes.r || '') && empty === 0, JSON.stringify(yes));

  // ---- write_notes ----
  const blocks = [
    { type: 'heading', level: 1, text: 'Ferranti-Effekt – einfach erklärt' },
    { type: 'paragraph', text: 'Bei einer langen, **unbelasteten** Wechselstromleitung kann die Spannung am Ende höher sein als am Anfang. Ursache ist der kapazitive Ladestrom, der zusammen mit der Leitungsinduktivität die Endspannung anhebt.' },
    { type: 'heading', level: 2, text: '1. Lange Hochspannungsleitung' },
    { type: 'list', items: ['Ein Kraftwerk speist eine lange Leitung mit 110 kV.', 'Am Ende ist kein Verbraucher angeschlossen.'] },
    { type: 'formula', latex: 'U_1 = (1 - \\omega^2 L C)\\, U_2' },
    { type: 'box', title: 'Merksatz', text: 'Der Ferranti-Effekt ist eine Spannungsüberhöhung am Ende einer langen, wenig belasteten Leitung.' },
  ];
  const w = await run('write_notes', { notebook: 'Ferranti', page: 1, place: 'free_space', blocks });
  check('write_notes: one answer naming where it wrote', /Wrote 6 block\(s\) on page 1/.test(w.r || ''), JSON.stringify(w));
  await win.waitForTimeout(800);
  const got = await ed(() => {
    const e = window.__app.active;
    const p = e.pages[0];
    const view = e.viewer.viewById(p.id);
    return e.pageData(p.id).texts.map((t) => {
      const el = view && view.el.querySelector(`.textbox[data-id="${t.id}"]`);
      return { id: t.id, text: t.text, x: t.x, y: t.y, w: t.w, fs: t.fs, lh: t.lh, c: t.c, b: t.b, bg: t.bg, lines: t.lines, html: t.html, shown: el ? Math.round(el.offsetHeight / (t.fs * t.lh)) : -1 };
    });
  });
  check('seven text boxes on page 1 (a list item each)', got.length === 7, JSON.stringify(got.map((t) => t.text)));
  check('dark paper: light text, coloured headings, framed box', got[1].c === '#e9ecf2' && got[0].c === '#8cc8ff' && got[0].b && got[0].fs > got[1].fs && !!got[6].bg, JSON.stringify(got.map((t) => [t.c, t.fs, t.bg])));
  check('inside the margin line and the right edge', got.every((t) => t.x >= 68 && t.x + t.w <= 595.28 - 40 + 0.01));
  check('every text box shows exactly the lines it was planned for (nothing wraps off the ruling)', got.every((t) => t.shown === t.lines), JSON.stringify(got.map((t) => [t.text.slice(0, 20), t.lines, t.shown])));
  check('the formula is a formula', /data-display="1"/.test(got[5].html) && await ed(() => window.__app.active.viewer.views.size > 0 && !!document.querySelector('.textbox .katex')), got[5].html);
  // baselines on the ruled lines: the text of each box sits on a line of the paper (24 pt from 72)
  const baselines = await ed(() => {
    const e = window.__app.active;
    const view = e.viewer.viewById(e.pages[0].id);
    const scale = view.el.getBoundingClientRect().width / e.pages[0].w;
    const top = view.el.getBoundingClientRect().top;
    return [...view.el.querySelectorAll('.textbox')].filter((el) => !el.querySelector('.katex')).map((el) => {
      const r = document.createRange();
      const node = [...el.querySelectorAll('*'), el].flatMap((n) => [...n.childNodes]).find((n) => n.nodeType === 3 && n.textContent.trim());
      r.setStart(node, 0); r.setEnd(node, 1);
      const b = r.getBoundingClientRect();
      // bottom of the first glyph box ≈ baseline + descent; use 80% of the box height as the baseline
      return (b.top + b.height * 0.8 - top) / scale;
    });
  });
  const offRule = baselines.map((y) => { const d = (y - 72) % 24; return Math.min(Math.abs(d), Math.abs(24 - d)); });
  check('text sits on the ruled lines (within 4 pt)', offRule.every((d) => d < 4), JSON.stringify(baselines.map((y, i) => [Math.round(y), Math.round(offRule[i] * 10) / 10])));
  if (process.env.SHOT) { fs.mkdirSync(process.env.SHOT, { recursive: true }); await win.screenshot({ path: path.join(process.env.SHOT, 'write-notes-dark.png') }); await win.mouse.move(800, 500); await win.mouse.wheel(0, 500); await win.waitForTimeout(500); await win.screenshot({ path: path.join(process.env.SHOT, 'write-notes-dark-2.png') }); }

  // ---- one undo ----
  await ed(() => { window.__app.active.tools.clearSelection(true); window.__app.active.undo(); });
  check('one Ctrl+Z removes the notes', await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).texts.length === 0));
  await ed(() => window.__app.active.redo());

  // ---- a long text: new pages, never past the bottom ----
  const long = Array.from({ length: 70 }, (_, i) => `Satz ${i + 1} erklärt noch ein Detail des Themas mit ein paar Worten mehr.`).join(' ');
  const w2 = await run('write_notes', { notebook: 'Ferranti', page: 2, place: 'below', blocks: [{ type: 'heading', level: 2, text: 'Ausführlich' }, { type: 'paragraph', text: long }] });
  const pages = await ed(() => { const e = window.__app.active; return e.pages.map((p) => ({ h: p.h, pc: p.pc, paper: p.paper, bottoms: e.pageData(p.id).texts.map((t) => t.y + (t.h || 0)) })); });
  check('a long text goes on to a new page in the same paper', pages.length >= 3 && pages[2].paper === 'lined' && pages[2].pc === 'dark' && /new page/.test(w2.r || ''), JSON.stringify({ w2, n: pages.length }));
  check('no text box reaches past the bottom of its page', pages.every((p) => p.bottoms.every((b) => b <= p.h - 20)), JSON.stringify(pages.map((p) => p.bottoms.map(Math.round))));
  const allText = await ed(() => window.__app.active.pages.flatMap((p) => window.__app.active.pageData(p.id).texts.map((t) => t.text)).join(' '));
  check('nothing is lost between the pages', allText.includes('Satz 1 ') && allText.includes('Satz 70 '));

  // ---- bad blocks ----
  const bad = await run('write_notes', { notebook: 'Ferranti', page: 1, blocks: [{ type: 'picture' }] });
  check('only bad blocks: a readable error', /Nothing to write/.test(bad.err || '') && /unknown type "picture"/.test(bad.err || ''), JSON.stringify(bad));

  // ---- presets from real notes: pastel markers on white paper, night pastel on dark paper ----
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'Pastel', paper: 'grid', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForFunction(() => window.__app.active?.doc?.nb?.title === 'Pastel' && window.__app.active.viewer.views.size > 0);
  await ed(() => { window.__app.settings.notesStyle = { preset: 'pastel' }; });
  const sample = [
    { type: 'heading', level: 1, text: 'Benzodiazepinas y ISRS' },
    { type: 'heading', level: 3, text: 'Características' },
    { type: 'definition', term: 'Benzo', text: 'alivio rápido.' },
    { type: 'definition', term: 'ISRS', text: 'tratamiento de mantenimiento.' },
    { type: 'heading', level: 2, text: 'Benzodiazepinas' },
    { type: 'list', items: ['more effective with acute anxiety', 'prescribe only lowest effective dose', 'de latencia rápida: entre 30–90 min'] },
    { type: 'paragraph', tone: 'note', text: 'Fundamentals of clinical psychopharmacology – Anderson, p. 110' },
    { type: 'paragraph', tone: 'warning', text: 'Can make anxiety symptoms worse in the initial phase of treatment.' },
    { type: 'formula', latex: 'N = \\bar{n} \\cdot D \\cdot 10^4' },
    { type: 'box', title: 'Merksatz', text: 'Benzos for short, acute relief; SSRIs for maintenance.' },
  ];
  const w3 = await run('write_notes', { notebook: 'Pastel', page: 1, place: 'free_space', blocks: sample });
  const p3 = await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).texts.map((t) => ({ text: t.text, c: t.c, bg: t.bg, w: t.w, ff: t.ff })));
  check('pastel preset: handwriting font, marker only as wide as the heading, pink subheading, red warning', /Wrote 10 block/.test(w3.r || '') && p3[0].ff === 'pangolin' && p3[0].bg === '#f8c8dc' && p3[0].w < 320 && p3[1].c === '#d0418a' && p3.some((t) => t.c === '#e0332f' && /worse/.test(t.text)), JSON.stringify({ w3, p3 }));
  if (process.env.SHOT) { await win.waitForTimeout(600); await win.screenshot({ path: path.join(process.env.SHOT, 'preset-pastel.png') }); }
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'Night', paper: 'grid', pc: 'dark', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForFunction(() => window.__app.active?.doc?.nb?.title === 'Night' && window.__app.active.viewer.views.size > 0);
  await ed(() => { window.__app.settings.notesStyle = { preset: 'night' }; });
  await run('write_notes', { notebook: 'Night', page: 1, place: 'free_space', blocks: [
    { type: 'paragraph', text: 'Each haemocytometer holds exactly 0.1 mm³ of liquid, so the cell count in 1 mL of nutrient broth is:' },
    { type: 'formula', latex: '\\text{cells per mL} = \\bar{n} \\times D \\times 10^4' },
    { type: 'paragraph', tone: 'note', text: 'D: multiplied to get the count in the original broth rather than the diluted one; 10⁴: mm³ → cm³ (mL).' },
    { type: 'heading', level: 2, text: 'Optical methods (turbidity)' },
    { type: 'list', items: ['Turbidimetry is a specialised form of colorimetry to count cells.', 'Turbidity measures how cloudy a solution is: ↑ turbidity ↑ cloudiness.'] },
  ] });
  const p4 = await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).texts.map((t) => t.c));
  check('night preset on dark paper: white text, lavender formula, yellow note', p4[0] === '#f4f4f4' && p4[1] === '#c9a7f5' && p4[2] === '#f5f57a', JSON.stringify(p4));
  if (process.env.SHOT) { await win.waitForTimeout(600); await win.screenshot({ path: path.join(process.env.SHOT, 'preset-night.png') }); }

  await win.locator('.editor').getByRole('button', { name: 'More', exact: true }).click();
  await win.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  check('⋯ menu → Settings opens the settings', await win.locator('.settings-tab', { hasText: 'Add-ons' }).isVisible());
  await win.getByRole('button', { name: 'Done', exact: true }).click();

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
