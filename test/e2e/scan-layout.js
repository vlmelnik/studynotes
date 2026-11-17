// "Make text editable": which lines become one text box. Real pages (drawn
// here, read by the real recognition): a form, a table, paragraphs with a
// heading, a list. The grouping rule itself is unit-tested
// (test/unit/shared/scan-layout.test.js); this checks it on what the reader
// really returns.
// usage: node test/e2e/scan-layout.js   (on Linux: xvfb-run -a -s "-screen 0 1600x1000x24" ...)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { check, errors, finish } = require('./harness/report');
const { launch } = require('./harness/app');

// what is drawn on a page: [text, x, y, { size, bold }], lines: [x0, y0, x1, y1]
const PAGES = {
  form: {
    h: 190,
    texts: [['Registration form', 20, 30, { size: 17, bold: true }], ['Name:', 20, 70], ['Street and number:', 20, 96], ['City:', 20, 122], ['Date of birth:', 20, 148]],
    rules: [[160, 73, 480, 73], [160, 99, 480, 99], [160, 125, 480, 125], [160, 151, 480, 151]],
  },
  table: {
    h: 150,
    texts: [['Item', 30, 34, { bold: true }], ['Quantity', 220, 34, { bold: true }], ['Price', 380, 34, { bold: true }],
      ['Pencil', 30, 62], ['12', 220, 62], ['1.50', 380, 62], ['Notebook', 30, 90], ['10', 220, 90], ['12.00', 380, 90], ['Ruler', 30, 118], ['25', 220, 118], ['0.80', 380, 118]],
    rules: [[20, 44, 480, 44], [20, 72, 480, 72], [20, 100, 480, 100]],
  },
  text: {
    h: 230,
    texts: [['House rules', 20, 30, { size: 17, bold: true }],
      ['The tenant agrees to pay the monthly rent before the third', 20, 62], ['working day of each month and keeps the rooms in good order', 20, 78], ['during the whole time of the contract.', 20, 94],
      ['Pets are welcome when the neighbours agree. Please ask the', 20, 126], ['owner before you bring a dog or a cat into the house and', 20, 142], ['tell the other tenants about it in good time.', 20, 158],
      ['Milk', 20, 190], ['Bread and butter', 20, 205], ['Eggs', 20, 220]],
    rules: [],
  },
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-layout-'));
  // (two readers, so that the long page below is read in two bands on any machine)
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_FAKE_INK: '1', STUDYNOTES_OCR_WORKERS: process.env.READERS || '2' } });
  await ed(() => { window.__app.settings.editableScans = true; });
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'layout', paper: 'blank', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForTimeout(600);

  const read = async (name) => {
    await ed(async (pg) => {
      const e = window.__app.active;
      const S = 3, W = 500;
      const cv = document.createElement('canvas'); cv.width = W * S; cv.height = pg.h * S;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await document.fonts.load('400 30px "SN Sans"'); await document.fonts.load('700 30px "SN Sans"');
      ctx.fillStyle = '#1b1b1b';
      for (const [t, x, y, o = {}] of pg.texts) { ctx.font = `${o.bold ? 700 : 400} ${(o.size || 12) * S}px "SN Sans"`; ctx.fillText(t, x * S, y * S); }
      ctx.strokeStyle = '#444'; ctx.lineWidth = S;
      for (const [x0, y0, x1, y1] of pg.rules) { ctx.beginPath(); ctx.moveTo(x0 * S, y0 * S); ctx.lineTo(x1 * S, y1 * S); ctx.stroke(); }
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      const src = await window.api.writeAsset(e.rel, new Uint8Array(await blob.arrayBuffer()), 'png');
      e.viewer.fitWidth(); e.viewer.scrollToPage(0);
      e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'img', type: 'img', x: 30, y: 40, w: W, h: pg.h, src }] });
    }, PAGES[name]);
    await win.waitForTimeout(250);
    await ed(() => Promise.race([window.__app.active.makePageEditable(0), new Promise((_, no) => setTimeout(() => no(new Error('timed out after 120 s')), 120000))]));
    const d = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });
    return d.texts.slice().sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.text);
  };
  const has = (boxes, t) => boxes.some((b) => b === t);
  const show = (boxes) => JSON.stringify(boxes);

  // ---------- a form: every label is its own box ----------
  const form = await read('form');
  check('form: the four labels are four boxes (not one "paragraph")', ['Name:', 'Street and number:', 'City:', 'Date of birth:'].every((t) => has(form, t)), show(form));
  check('form: the heading is its own box', has(form, 'Registration form'), show(form));

  // ---------- a table: cells are not joined down a column ----------
  const table = await read('table');
  check('table: no cell is joined with the one below it', table.length >= 10 && table.every((b) => !b.includes('\n')), show(table));
  check('table: words and numbers are read as single cells', ['Notebook', 'Ruler', '12.00', '0.80'].every((t) => has(table, t)), show(table));

  // ---------- text: paragraphs are one box each, the heading apart, a list together ----------
  const text = await read('text');
  const para = (start) => text.find((b) => b.startsWith(start)) || '';
  check('text: a paragraph of three lines is one box', para('The tenant agrees').split('\n').length === 3 && para('The tenant agrees').endsWith('of the contract.'), show(text));
  check('text: the next paragraph (after an empty line) is another box', para('Pets are welcome').split('\n').length === 3, show(text));
  check('text: the heading stays apart', has(text, 'House rules'), show(text));
  check('text: a single-spaced list is one box', para('Milk') === 'Milk\nBread and butter\nEggs', show(text));

  // ---------- a long page is read block by block, side by side: same text ----------
  const SENT = ['The tenant agrees to pay the monthly rent before the third', 'working day of each month and keeps the rooms in good order', 'during the whole time of the contract and tells the owner', 'about any damage within two weeks after moving in.'];
  // (32 lines: with its 40 units of offset the picture still fits on the page)
  PAGES.long = { h: 60 + 32 * 22, texts: Array.from({ length: 32 }, (_, k) => [`${k + 1}. ${SENT[k % 4]}`, 20, 40 + k * 22]), rules: [] };
  await ed(() => { window.__ocrDebug = []; });
  const long = (await read('long')).join('\n').split('\n');
  const log = await ed(() => window.__ocrDebug.blockLog);
  check('long page: its blocks are found first and read one by one', !!log && log[0] && log[0][0] >= 2, JSON.stringify(log));
  const want = PAGES.long.texts.map((t) => t[0]);
  const wrong = want.filter((t, k) => long[k] !== t);
  check('long page: every line is read once, in order, across the cut', long.length === 32 && wrong.length <= 1, `${long.length} lines; differ: ${JSON.stringify(wrong.slice(0, 3))} got ${JSON.stringify(long.filter((t, k) => t !== want[k]).slice(0, 3))}`);

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
