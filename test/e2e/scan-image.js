// "Make text editable" on a picture of your own: prints the text boxes it
// makes (text, typeface, bold, size, position) and saves before / after
// screenshots to test/out. A tool for real pages that must stay private
// (they are not in the repository), not a check.
// usage: xvfb-run -a node test/e2e/scan-image.js <picture> [width in page units, default 520]
//        JSON=1 prints the boxes as JSON (for a comparison with expected blocks)
//        DBG=1 adds the measures behind font and bold, DUMP=<file> writes all notes
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch } = require('./harness/app');

const file = process.argv[2];
if (!file) { console.error('usage: node test/e2e/scan-image.js <picture> [width]'); process.exit(2); }
const W = Number(process.argv[3] || 520);
const out = path.join(__dirname, '..', 'out');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-img-'));
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_FAKE_INK: '1', ...(process.env.READERS ? { STUDYNOTES_OCR_WORKERS: process.env.READERS } : {}) } });
  await ed(() => { window.__app.settings.editableScans = true; });
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'picture', paper: 'blank', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForTimeout(600);
  const ext = /\.jpe?g$/i.test(file) ? 'jpg' : 'png';
  const h = await ed(async ([b, ext, W]) => {
    const e = window.__app.active;
    const src = await window.api.writeAsset(e.rel, new Uint8Array(b), ext);
    const bmp = await createImageBitmap(await (await fetch(e.assetUrl(src))).blob());
    const h = (W * bmp.height) / bmp.width;
    e.viewer.fitWidth(); e.viewer.scrollToPage(0);
    e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'pic', type: 'img', x: 30, y: 40, w: W, h, src }] });
    return h;
  }, [[...fs.readFileSync(file)], ext, W]);
  await win.waitForTimeout(500);
  const tag = path.basename(file).replace(/\.\w+$/, '');
  const clip = async () => {
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const z = await ed(() => window.__app.active.viewer.zoom);
    return { x: r.left + 25 * z, y: r.top + 35 * z, width: (W + 10) * z, height: Math.min(h + 10, 790) * z };
  };
  await win.screenshot({ path: path.join(out, `img-${tag}-before.png`), clip: await clip() });
  const t0 = Date.now();
  await ed(() => { window.__ocrDebug = []; return Promise.race([window.__app.active.makePageEditable(0), new Promise((_, no) => setTimeout(() => no(new Error('timed out after 180 s')), 180000))]); });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const d = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });
  const boxes = d.texts.slice().sort((a, b) => a.y - b.y || a.x - b.x).map((t) => ({ text: t.text, ff: t.ff, b: !!t.b, i: !!t.i, fs: t.fs, c: t.c, x: Math.round(t.x - 30), y: Math.round(t.y - 40), al: t.al || 'left', r: t.r || 0 }));
  if (process.env.JSON) console.log(JSON.stringify(boxes));
  else {
    console.log(`${boxes.length} boxes in ${secs} s`);
    for (const b of boxes) console.log(`  [${b.x},${b.y}] ${b.ff}${b.b ? ' bold' : ''}${b.i ? ' italic' : ''} ${b.fs}pt ${b.c}${b.al !== 'left' ? ' ' + b.al : ''}  ${JSON.stringify(b.text)}`);
    if (process.env.DBG) console.log(JSON.stringify(await ed(() => ({ hand: window.__ocrDebug.hand, best: window.__ocrDebug.best, fam: window.__ocrDebug.fam, w: window.__ocrDebug.w, first: (window.__ocrDebug.first || []).map((l) => [l.text, Math.round(l.conf)]) }))));
  }
  // DUMP=<file>: everything the recognition noted on its way (for a look at why)
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(await ed(() => { const d = window.__ocrDebug; return { t: d.t, readLog: d.readLog, stray: d.stray, ww: d.ww, first: d.first, raw: d.raw, w: d.w, fam: d.fam, hand: d.hand, join: d.join }; })));
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(out, `img-${tag}-after.png`), clip: await clip() });
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
