// End-to-end checks for the 1.7 fixes: PDF text selection by lines, dragging
// on highlighted text, double-click with the lasso, the settings' add-ons.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v17b.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, { recursive: true });
const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const packaged = !!process.env.STUDYNOTES_EXE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v17b-'));
const errors = [];
const shot = (win, name) => win.screenshot({ path: path.join(out, `v17b-${name}.png`) });

// Running text written word by word (one PDF text item per word, as many
// PDFs do), and a two-column table further down the page.
const LINES = [
  'Alpha beta gamma delta epsilon zeta eta theta iota kappa',
  'lambda my ny xi omikron pi rho sigma tau ypsilon',
  'phi chi psi omega and the whole alphabet once again',
  'last line of the running text above the table here',
];
let font = null;
async function makePdf(file) {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  LINES.forEach((line, k) => {
    let x = 60;
    for (const w of line.split(' ')) { page.drawText(w, { x, y: 760 - k * 18, size: 12, font }); x += font.widthOfTextAtSize(w + ' ', 12); }
  });
  for (let r = 0; r < 12; r++) {
    page.drawText(`Item ${r + 1}`, { x: 60, y: 600 - r * 16, size: 11, font });
    page.drawText(`${(r + 1) * 12} EUR`, { x: 420, y: 600 - r * 16, size: 11, font });
  }
  // page 2: an article in two columns
  const p2 = doc.addPage([595, 842]);
  for (let k = 0; k < 14; k++) {
    p2.drawText(`Left column line ${k + 1} with some running text`, { x: 50, y: 780 - k * 16, size: 11, font });
    p2.drawText(`Right column line ${k + 1} of the article text`, { x: 320, y: 780 - k * 16, size: 11, font });
  }
  // page 3: a tight two-column paper (12 pt gap, like IEEE) with a paragraph gap on the left
  const p3 = doc.addPage([595, 842]);
  const lw = font.widthOfTextAtSize('Lorem left text of the paper line 10 here', 10);
  for (let k = 0; k < 16; k++) {
    if (k !== 6) p3.drawText(`Lorem left text of the paper line ${k + 1}`, { x: 50, y: 780 - k * 13, size: 10, font });
    p3.drawText(`Right side of the article, line ${k + 1}`, { x: 50 + lw + 12, y: 780 - k * 13, size: 10, font });
  }
  fs.writeFileSync(file, await doc.save());
}

(async () => {
  const pdfFile = path.join(tmp, 'Words.pdf');
  await makePdf(pdfFile);
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: [...(packaged ? [] : [root]), '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: path.join(tmp, 'Library'), STUDYNOTES_USERDATA: path.join(tmp, 'u'), STUDYNOTES_FAKE_INK: '1' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app);
  const ed = (fn, arg) => win.evaluate(fn, arg);
  const at = async (x, y, pg = 0) => {
    const r = await ed((p) => window.__app.active.viewer.pageClientRect(p), pg);
    const z = await ed(() => window.__app.active.viewer.zoom);
    return [r.left + x * z, r.top + y * z];
  };
  const pageData = () => ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });

  await ed(async (f) => { const [r] = await window.api.importFiles('', [f]); await window.__app.openNotebook(r); }, pdfFile);
  await win.waitForTimeout(1200);
  await ed(() => { const e = window.__app.active; e.viewer.setZoom ? e.viewer.setZoom(1.4) : e.viewer.fitWidth(); e.viewer.scrollToPage(0); e.setTool('select'); });
  await win.waitForTimeout(500);
  // baseline of line k (page units, from the top): 842 - (760 - 18k)
  const base = (k) => 82 + k * 18;
  const mid = (k) => base(k) - 4;
  const [hx, hy] = await at(70, mid(0));
  await win.mouse.move(hx - 30, hy); await win.waitForTimeout(500); // hover: the text loads
  const drag = async (from, to, steps = 12, pg = 0) => {
    await ed(() => { const t = window.__app.active.tools.textSel; t.clear(); t.span = null; document.querySelectorAll('.pdf-sel-menu').forEach((m) => m.remove()); });
    const [x0, y0] = await at(...from, pg), [x1, y1] = await at(...to, pg);
    await win.mouse.move(x0, y0); await win.mouse.down();
    await win.mouse.move(x1, y1, { steps }); await win.mouse.up();
    await win.waitForTimeout(250);
    const r = await ed(() => { const t = window.__app.active.tools.textSel; return t.span ? t.span.text : null; });
    await win.keyboard.press('Escape');
    return r;
  };
  // the x of a word's middle on line k (the PDF's own font widths)
  const wordX = async (k, w) => {
    const line = LINES[k], pre = line.slice(0, line.indexOf(w));
    return 60 + pre.split(' ').slice(0, -1).reduce((a, q) => a + font.widthOfTextAtSize(q + ' ', 12), 0) + font.widthOfTextAtSize(w, 12) / 2;
  };
  // … and of its first letter's left edge
  const wordStart = async (k, w) => (await wordX(k, w)) - font.widthOfTextAtSize(w, 12) / 2 + 0.5;

  // ===================================================================== N. selection by whole lines
  {
    // from "gamma" on line 1 down-right to "omega" on line 3
    const t1 = await drag([await wordStart(0, 'gamma'), mid(0)], [await wordX(2, 'omega'), mid(2)]);
    const lines1 = (t1 || '').split('\n');
    check('N: dragging down selects the full lines in between (not word pairs)', lines1.length === 3 && lines1[0].startsWith('gamma') && lines1[0].endsWith('kappa') && lines1[1] === LINES[1] && /^phi chi psi om/.test(lines1[2]), JSON.stringify(t1));
    // ending to the right of a line: up to that line's end
    const t2 = await drag([await wordStart(0, 'beta'), mid(0)], [560, mid(1)]);
    check('N: ending right of a line selects up to its end', t2 && t2.endsWith('ypsilon') && t2.split('\n').length === 2, JSON.stringify(t2));
    // ending between two lines: no jump back, the nearer line counts
    const t3 = await drag([await wordStart(0, 'beta'), mid(0)], [200, base(1) + 3]);
    check('N: ending between two lines keeps the selection (nearer line)', t3 && t3.split('\n').length >= 2 && t3.startsWith('beta'), JSON.stringify(t3));
    // dragging up selects the same lines backwards
    const t4 = await drag([await wordStart(2, 'whole'), mid(2)], [await wordStart(0, 'delta'), mid(0)]);
    check('N: dragging up works the same way', t4 && t4.startsWith('delta') && t4.includes(LINES[1]) && /and the$/.test(t4.split('\n')[2] || ''), JSON.stringify(t4));
    // the table: one row per line, the columns not mixed with the running text
    const t5 = await drag([58, 842 - 600 - 4], [470, 842 - 584 - 4]);
    check('N: table rows are selected row by row', t5 && /^Item 1\t12 EUR\nItem 2\t24 EUR$/.test(t5), JSON.stringify(t5));
    // an article in two columns: a selection in the left column stays there
    await ed(() => window.__app.active.viewer.scrollToPage(1));
    await win.waitForTimeout(600);
    const [qx, qy] = await at(40, 70, 1);
    await win.mouse.move(qx, qy); await win.waitForTimeout(500);
    const t6 = await drag([49, 842 - 780 - 4], [200, 842 - 748 - 4], 12, 1);
    check('N: two columns: the selection follows the column', t6 && t6.split('\n').length === 3 && t6.split('\n').every((l) => l.startsWith('Left')), JSON.stringify(t6));
    // a tight two-column paper: lines don't run across both columns, and a
    // drag through the left column's paragraph gap stays in the left column
    await ed(() => window.__app.active.viewer.scrollToPage(2));
    await win.waitForTimeout(600);
    const [rx, ry] = await at(40, 70, 2);
    await win.mouse.move(rx, ry); await win.waitForTimeout(500);
    const t7 = await drag([49, 842 - (780 - 3 * 13) - 3], [120, 842 - (780 - 9 * 13) - 3], 20, 2);
    const l7 = (t7 || '').split('\n');
    check('N: tight two columns (12 pt gap): the selection stays in its column, also through a paragraph gap', l7.length >= 5 && l7.every((l) => !l || l.startsWith('Lorem')) && /line 4$/.test(l7[0]), JSON.stringify(t7));
    await ed(() => window.__app.active.viewer.scrollToPage(0));
    await win.waitForTimeout(400);
    await shot(win, 'N-select');
  }

  // ===================================================================== O. dragging on highlighted text selects the text
  {
    await ed(() => {
      const e = window.__app.active, d = e.pageData(e.pages[0].id);
      e.setPageData(e.pages[0].id, { ...d, strokes: [{ id: 'h1', t: 'hl', c: '#ffe066', s: 13, p: [60, 78, 0.5, 400, 78, 0.5], np: 1, sh: 1 }] });
    });
    await win.waitForTimeout(300);
    const t = await drag([await wordStart(0, 'beta'), mid(0)], [await wordX(0, 'epsilon'), mid(0)], 8);
    const sel = await ed(() => !!window.__app.active.tools.sel);
    check('O: dragging over highlighted text selects the text (no strange box)', t && t.startsWith('beta') && t.includes('delta') && !sel, JSON.stringify({ t, sel }));
    const [cx, cy] = await at(200, mid(0));
    await win.mouse.click(cx, cy);
    await win.waitForTimeout(250);
    const picked = await ed(() => { const s = window.__app.active.tools.sel; return s ? [...s.strokeIds] : []; });
    check('O: a click on the highlight selects the highlight', picked.length === 1 && picked[0] === 'h1', JSON.stringify(picked));
    await win.keyboard.press('Escape');
  }

  // ===================================================================== P. double-click edits a text box with the lasso too
  {
    await ed(() => {
      const e = window.__app.active, d = e.pageData(e.pages[0].id);
      e.setPageData(e.pages[0].id, { ...d, strokes: [], texts: [{ id: 'tx', x: 100, y: 300, w: 200, fs: 14, c: '#222222', ff: 'sans', text: 'Made editable', lay: 'f' }] });
      e.setTool('lasso');
      e.tools.select(0, e.pages[0].id, new Set(), new Set(['tx']));
    });
    await win.waitForTimeout(300);
    const [dx, dy] = await at(150, 310);
    await win.mouse.dblclick(dx, dy);
    await win.waitForTimeout(300);
    const editing = await ed(() => { const a = document.activeElement; return !!(a && a.closest && a.closest('.textbox') && a.isContentEditable); });
    check('P: double-click on a text box with the lasso edits its text', editing);
    await win.keyboard.press('Escape');
    await ed(() => window.__app.active.setTool('select'));
  }

  // ===================================================================== Q. settings: add-ons tab with switches, nothing runs off the side
  {
    await ed(() => window.__app.showSettings());
    await win.waitForTimeout(300);
    await win.locator('.settings-tab', { hasText: 'Add-ons' }).click();
    await win.waitForTimeout(400);
    const names = await win.locator('.addon .addon-title b').allTextContents();
    const sw = win.locator('.addon', { hasText: 'Searchable scans' }).locator('.switch');
    await sw.click(); await win.waitForTimeout(150);
    const off = await ed(() => window.__app.settings.autoOcr);
    await sw.click(); await win.waitForTimeout(150);
    const on = await ed(() => window.__app.settings.autoOcr);
    const sw2 = win.locator('.addon', { hasText: 'Editable scans' }).locator('.switch');
    await sw2.click(); await win.waitForTimeout(150);
    const es = await ed(() => window.__app.settings.editableScans);
    check('Q: Add-ons tab lists the add-ons, each switch turns its add-on on / off', names.join('|') === 'Searchable scans|Editable scans|Handwriting to text' && off === false && on === true && es === true, JSON.stringify({ names, off, on, es }));
    await win.locator('.addon', { hasText: 'Handwriting to text' }).locator('button', { hasText: 'Settings' }).click();
    await win.locator('.chip', { hasText: 'Google (online)' }).click();
    const eng = await ed(() => window.__app.settings.inkEngine);
    check('Q: handwriting engine: Windows or Google', eng === 'google', eng);
    const over = async () => ed(() => {
      const m = document.querySelector('.modal'); const mr = m.getBoundingClientRect();
      const bad = [...m.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > mr.right + 1 || r.left < mr.left - 1); });
      return { wide: m.scrollWidth > m.clientWidth + 1, bad: bad.slice(0, 3).map((el) => el.className + ':' + (el.textContent || '').slice(0, 30)) };
    });
    const o1 = await over();
    await shot(win, 'Q-addons');
    await win.locator('.settings-tab', { hasText: 'General' }).click();
    await win.waitForTimeout(200);
    const o2 = await over();
    await shot(win, 'Q-general');
    check('Q: no settings text runs off the side', !o1.wide && !o2.wide && !o1.bad.length && !o2.bad.length, JSON.stringify({ o1, o2 }));
    // in Russian: every text of the settings is translated
    await win.locator('.modal [data-lang="ru"]').click();
    await win.waitForTimeout(300);
    await win.locator('.modal-actions .btn').first().click();
    await ed(() => window.__app.showSettings());
    await win.waitForTimeout(300);
    const latin = async () => ed(() => {
      const keep = /^(StudyNotes|Google|Windows|Windows Ink|Wacom|PDF|OCR|English|Deutsch|Ctrl|Shift|Alt|Esc|Bamboo|Drive|Google Drive|Z|Y)$/;
      const out = new Set();
      const walk = (n) => {
        if (n.nodeType === 3) {
          const t = n.nodeValue.trim();
          const rest = t.replace(/StudyNotes|Google Drive|Google|Windows Ink|Windows|Wacom|PDF|OCR|Ctrl\+\w|Shift|English|Deutsch|Bamboo|Esc/g, '');
          if (/[A-Za-z]{3,}/.test(rest) && !/[\u0400-\u04ff]/.test(t) && !keep.test(t) && !n.parentElement.closest('.no-i18n, code, select')) out.add(t.slice(0, 70));
        } else if (n.nodeType === 1 && !n.hidden) n.childNodes.forEach(walk);
      };
      document.querySelectorAll('.modal').forEach(walk);
      return [...out];
    });
    const ru1 = await latin();
    await win.locator('.settings-tab').nth(1).click();
    await win.waitForTimeout(400);
    await win.locator('.addon .btn.ghost.small').evaluateAll((bs) => bs.forEach((b) => b.click()));
    await win.waitForTimeout(300);
    const ru2 = await latin();
    await shot(win, 'Q-addons-ru');
    check('Q: Russian: all settings texts are translated', !ru1.length && !ru2.length, JSON.stringify(ru1.concat(ru2)));
    await win.locator('.modal [data-lang="en"]').count().then(async (n) => { if (n) { await win.locator('.settings-tab').nth(0).click(); await win.locator('.modal [data-lang="en"]').click(); } });
    await win.locator('.modal-actions .btn').first().click();
  }

  // the dictionary check runs in its own process
  const sp = await ed(() => window.api.ocrSpell([{ text: 'Tak начинается текст', words: [{ text: 'Tak' }, { text: 'начинается' }, { text: 'текст' }] }]).catch((e) => String(e)));
  check('R: dictionary check (own process): "Tak" → "Так"', sp && sp.lines && sp.lines[0].text === 'Так начинается текст' && sp.lines[0].words[0].text === 'Так', JSON.stringify(sp));
  await app.close();
  const real = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
