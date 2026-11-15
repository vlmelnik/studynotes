// "Make text editable" on your own pictures, checked against what you expect
// of each: which lines form one block, typeface, bold. For real pages that
// must stay private – pictures and expectations live in test/private/ (not in
// the repository); without that folder there is nothing to check.
//
// usage: xvfb-run -a node test/e2e/scan-check.js [folder]   (default test/private)
// Next to <name>.png / .jpg a file <name>.expect.json:
//   { "width": 520,                      picture width on the page (default 520)
//     "blocks": ["line one\nline two"],  every entry must be ONE text box with these lines
//     "apart": [["Question?", "Answer"]] texts that must not share a box
//     "kind": "sans",                    typeface kind of all boxes (sans / serif / mono / hand)
//     "bold": ["Heading"],               boxes (found by their start) that are bold throughout
//     "regular": ["Body text"],          … and not bold
//     "boldWords": ["deposit"],          words set in bold inside a regular line
//     "inside": true,                    no text box reaches out of the picture
//     "text": ["zur Anmeldung"],         must be read like this somewhere
//     "not": ["гиг"] }                   must not appear anywhere
const path = require('path');
const fs = require('fs');
const os = require('os');
const { check, errors, finish } = require('./harness/report');
const { launch } = require('./harness/app');
const { FONTS } = require('../../src/shared/fonts');
const kinds = Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.kind]));

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'private'));
const out = path.join(__dirname, '..', 'out');
// letters and digits only: a comma read as a dot is not a wrong block
const key = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}\n]/gu, '');
// share of equal letters (edit distance)
const alike = (a, b) => {
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
};

(async () => {
  const cases = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f) && fs.existsSync(path.join(dir, f.replace(/\.\w+$/, '.expect.json')))).sort() : [];
  if (!cases.length) { console.log(`no pictures with expectations in ${dir}`); process.exit(0); }
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-check-'));
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_FAKE_INK: '1', ...(process.env.READERS ? { STUDYNOTES_OCR_WORKERS: process.env.READERS } : {}) } });
  await ed(() => { window.__app.settings.editableScans = true; });
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'check', paper: 'blank', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForTimeout(600);

  for (const f of cases) {
    const tag = f.replace(/\.\w+$/, '');
    const want = JSON.parse(fs.readFileSync(path.join(dir, tag + '.expect.json'), 'utf8'));
    const W = want.width || 520;
    const h = await ed(async ([b, ext, W]) => {
      const e = window.__app.active;
      const src = await window.api.writeAsset(e.rel, new Uint8Array(b), ext);
      const bmp = await createImageBitmap(await (await fetch(e.assetUrl(src))).blob());
      const h = (W * bmp.height) / bmp.width;
      e.viewer.fitWidth(); e.viewer.scrollToPage(0);
      e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'pic', type: 'img', x: 30, y: 40, w: W, h, src }] });
      return h;
    }, [[...fs.readFileSync(path.join(dir, f))], /\.jpe?g$/i.test(f) ? 'jpg' : 'png', W]);
    await win.waitForTimeout(400);
    const t0 = Date.now();
    await ed(() => Promise.race([window.__app.active.makePageEditable(0), new Promise((_, no) => setTimeout(() => no(new Error('timed out after 180 s')), 180000))]));
    const secs = (Date.now() - t0) / 1000;
    const boxes = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).texts.map((t) => ({ text: t.text, html: t.html || '', ff: t.ff, b: !!t.b, fs: t.fs, x: t.x - 30, y: t.y - 40, w: t.w || 0 })); });
    await win.waitForTimeout(500);
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    const z = await ed(() => window.__app.active.viewer.zoom);
    await win.screenshot({ path: path.join(out, `check-${tag}.png`), clip: { x: r.left + 25 * z, y: r.top + 35 * z, width: (W + 10) * z, height: Math.min(h + 10, 790) * z } });

    const name = (s) => `${tag}: ${s}`;
    const short = (t) => JSON.stringify(String(t).length > 46 ? String(t).slice(0, 44) + '…' : t);
    const boxOf = (start) => boxes.find((b) => key(b.text).replace(/\n/g, '').startsWith(key(start).replace(/\n/g, '')));
    console.log(`--- ${tag}: ${boxes.length} boxes in ${secs.toFixed(1)} s`);
    for (const blk of want.blocks || []) {
      const k = key(blk), n = k.split('\n').length;
      const best = boxes.map((b) => ({ b, s: alike(key(b.text).replace(/\n/g, ''), k.replace(/\n/g, '')) })).sort((p, q) => q.s - p.s)[0];
      const ok = best && best.s >= 0.9 && key(best.b.text).split('\n').length === n;
      // (what was made instead: the boxes holding its first line)
      const first = k.split('\n')[0];
      const near = boxes.filter((b) => key(b.text).includes(first.slice(0, 12))).map((b) => short(b.text)).join(' + ');
      check(name(`one block ${short(blk)}`), ok, ok ? '' : `got ${near || 'nothing like it'}`);
    }
    for (const [a, b] of want.apart || []) {
      const both = boxes.find((x) => key(x.text).includes(key(a)) && key(x.text).includes(key(b)));
      check(name(`apart ${short(a)} | ${short(b)}`), !both, both ? `one box ${short(both.text)}` : '');
    }
    if (want.kind) {
      const off = boxes.filter((b) => (kinds[b.ff] || b.ff) !== want.kind);
      check(name(`typeface kind ${want.kind}`), !off.length, off.slice(0, 3).map((b) => `${b.ff} ${short(b.text)}`).join(', '));
    }
    for (const s of want.bold || []) { const b = boxOf(s); check(name(`bold ${short(s)}`), b && b.b, b ? 'regular' : 'not found'); }
    for (const s of want.regular || []) { const b = boxOf(s); check(name(`regular ${short(s)}`), b && !b.b, b ? 'bold' : 'not found'); }
    for (const wd of want.boldWords || []) {
      const hit = boxes.some((b) => (b.html.match(/<b>(.*?)<\/b>/g) || []).some((m) => key(m.replace(/<[^>]+>/g, '')).includes(key(wd))));
      check(name(`bold word ${short(wd)}`), hit);
    }
    if (want.inside) {
      const off = boxes.filter((b) => b.x < -2 || b.y < -2 || b.y > h + 2 || b.x > W);
      check(name('no box outside the picture'), !off.length, off.map((b) => short(b.text)).join(', '));
    }
    const all = boxes.map((b) => b.text).join('\n');
    for (const s of want.text || []) check(name(`reads ${short(s)}`), all.includes(s));
    for (const s of want.not || []) check(name(`no ${short(s)}`), !all.includes(s));
  }
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
