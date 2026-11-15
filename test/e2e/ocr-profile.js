// Where the time of "Make text editable" goes on a full page of text.
// Prints the milliseconds per phase (a tool, not a check).
// usage: xvfb-run -a node test/e2e/ocr-profile.js   (LINES=40, CONDS=clean,photo)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch } = require('./harness/app');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-ocrp-'));
const N = Number(process.env.LINES || 32);
const CONDS = (process.env.CONDS || 'clean,photo').split(',');
const TEXT = ['Der Mieter zahlt die Kaution für die Wohnung in drei', 'gleichen Raten bis zum Monatsende. Bitte prüfen Sie', 'die Größe der Räume genau und melden Sie Schäden',
  'innerhalb von zwei Wochen nach dem Einzug schriftlich.', 'The tenant agrees to pay the monthly rent before the', 'third working day of each month and keeps the rooms', 'in good order during the whole time of the contract.'];

(async () => {
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_FAKE_INK: '1', ...(process.env.READERS ? { STUDYNOTES_OCR_WORKERS: process.env.READERS } : {}) } });
  await ed(() => { window.__app.settings.editableScans = true; });
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'profile', paper: 'blank', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForTimeout(600);
  for (let pass = 0; pass < 2; pass++) { // (the first pass also loads the reader)
    for (const cond of CONDS) {
      await ed(async ([cond, text, n]) => {
        const e = window.__app.active;
        const S = 3, W = 520, H = 60 + n * 20;
        const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
        const ctx = cv.getContext('2d');
        const photo = cond === 'photo';
        ctx.fillStyle = photo ? '#e9e2d3' : '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await document.fonts.load('400 30px "SN Serif"'); await document.fonts.load('700 30px "SN Sans"');
        ctx.save();
        if (photo) { ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate((1.5 * Math.PI) / 180); ctx.translate(-cv.width / 2, -cv.height / 2); ctx.filter = 'blur(1.2px)'; }
        ctx.fillStyle = '#1b1b1b';
        ctx.font = `700 ${18 * S}px "SN Sans"`; ctx.fillText('Rental Agreement', 20 * S, 34 * S);
        ctx.font = `400 ${12 * S}px "SN Serif"`;
        for (let k = 0; k < n; k++) ctx.fillText(text[k % text.length], 20 * S, (62 + k * 20 + (k % 8 === 7 ? 0 : 0)) * S);
        ctx.restore();
        if (photo) {
          const g = ctx.createLinearGradient(0, 0, cv.width, cv.height);
          g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0.0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
        }
        const blob = await new Promise((res) => cv.toBlob(res, photo ? 'image/jpeg' : 'image/png', 0.7));
        const src = await window.api.writeAsset(e.rel, new Uint8Array(await blob.arrayBuffer()), photo ? 'jpg' : 'png');
        e.viewer.fitWidth(); e.viewer.scrollToPage(0);
        e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'img', type: 'img', x: 30, y: 40, w: W, h: H, src }] });
      }, [cond, TEXT, N]);
      await win.waitForTimeout(250);
      const t0 = Date.now();
      await ed(() => { window.__ocrDebug = []; return window.__app.active.makePageEditable(0); });
      const total = Date.now() - t0;
      const r = await ed(() => { const e = window.__app.active; return { t: window.__ocrDebug.t, reads: window.__ocrDebug.readLog, boxes: e.pageData(e.pages[0].id).texts.length }; });
      if (pass) console.log(`${cond.padEnd(6)} ${N + 1} lines → ${r.boxes} boxes, ${total} ms  ${JSON.stringify(r.t)}
       reads [languages, lines, ms]: ${JSON.stringify(r.reads)}`);
    }
  }
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
