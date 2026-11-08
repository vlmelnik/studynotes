// End-to-end checks for v1.7 through the real UI.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v17.js
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-ocrb-'));
const errors = [];
const shot = (win, name) => win.screenshot({ path: path.join(out, `v17-${name}.png`) });

// The text recognition add-on is "downloaded" from a local copy of the release files.
function ocrUrl() {
  const dir = path.join(tmp, 'ocr-release');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    for (const l of ['eng', 'deu', 'rus']) fs.copyFileSync(require.resolve(`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`), path.join(dir, `${l}.traineddata.gz`));
  }
  return require('url').pathToFileURL(dir).href + '/';
}

async function launch() {
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: [...(packaged ? [] : [root]), '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: path.join(tmp, 'Library'), STUDYNOTES_USERDATA: path.join(tmp, 'u'), STUDYNOTES_OCR_URL: ocrUrl(), STUDYNOTES_FAKE_INK: '1' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app);
  return { app, win, ed: (fn, arg) => win.evaluate(fn, arg) };
}



// Quality bench for "Make text editable": fonts × photo conditions.
// Prints a table (character error rate, font, angle) and checks limits.
const LINES = process.env.RU
  ? ['Арендатор обязуется вносить плату вовремя', 'и бережно относиться к мебели в квартире.', 'Залог возвращается через месяц после выезда.']
  : process.env.EN ? ['The tenant agrees to pay the monthly rent', 'before the third working day of each month.', 'Please check the size of every room carefully.']
    : ['Der Mieter zahlt die Kaution für die Wohnung', 'in drei gleichen Raten bis zum Monatsende.', 'Bitte prüfen Sie die Größe der Räume genau.'];
const FONTS = [['SN Sans', 'sans'], ['SN Serif', 'serif'], ['SN Carlito', 'carlito'], ['SN Mono', 'mono'], ['DejaVu Serif', 'serif'], ['DejaVu Sans', 'sans'],
  ['SN Caladea', 'cambria'], ['SN Gelasio', 'georgia'], ['SN Open Sans', 'opensans'], ['SN Roboto', 'roboto'], ['SN Inter', 'inter'], ['SN Lato', 'lato'],
  ['SN Source Sans', 'sourcesans'], ['SN Fira Sans', 'fira'], ['SN Montserrat', 'montserrat'], ['SN Noto Serif', 'notoserif'], ['SN Garamond', 'garamond'], ['SN PT Serif', 'ptserif']];
const CONDS = (process.env.CONDS || 'clean,tilt+2.5,tilt-4,blur,photo,hard').split(',');

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

(async () => {
  const { app, win, ed } = await launch();
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'bench', paper: 'blank', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForTimeout(600);
  const rows = [];
  let first = true;
  for (const [css, fam] of (process.env.FONTS ? FONTS.filter((f) => process.env.FONTS.split(',').includes(f[1] + ':' + f[0])) : FONTS)) {
    for (const cond of CONDS) {
      await ed(async ([css, cond, lines]) => {
        const e = window.__app.active;
        const S = 3, W = 520, H = 150;
        const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
        const ctx = cv.getContext('2d');
        const photo = cond === 'photo' || cond === 'hard', hard = cond === 'hard';
        ctx.fillStyle = photo ? '#e9e2d3' : '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await document.fonts.load(`400 30px "${css}"`);
        ctx.save();
        const ang = cond.startsWith('tilt') ? parseFloat(cond.slice(4)) : hard ? -3 : photo ? 1.8 : 0;
        ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate((ang * Math.PI) / 180); ctx.translate(-cv.width / 2, -cv.height / 2);
        if (cond === 'blur') ctx.filter = 'blur(2px)';
        if (photo) ctx.filter = hard ? 'blur(2.2px)' : 'blur(1.4px)';
        ctx.fillStyle = '#1b1b1b'; ctx.font = `400 ${13 * S}px "${css}"`;
        lines.forEach((t, k) => ctx.fillText(t, 20 * S, (45 + k * 28) * S));
        ctx.restore();
        if (photo) {
          // uneven light, a glare spot, sensor noise, JPEG
          const g = ctx.createLinearGradient(0, 0, cv.width, cv.height);
          g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0.0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
          const gx = hard ? 0.4 : 0.7;
          const r = ctx.createRadialGradient(cv.width * gx, cv.height * 0.45, 10, cv.width * gx, cv.height * 0.45, cv.width * 0.18);
          r.addColorStop(0, `rgba(255,255,255,${hard ? 0.6 : 0.75})`); r.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = r; ctx.fillRect(0, 0, cv.width, cv.height);
          const id = ctx.getImageData(0, 0, cv.width, cv.height);
          let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
          for (let i = 0; i < id.data.length; i += 4) { const n = (rnd() - 0.5) * (hard ? 45 : 30); id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
          ctx.putImageData(id, 0, 0);
        }
        const blob = await new Promise((res) => cv.toBlob(res, photo ? 'image/jpeg' : 'image/png', hard ? 0.45 : 0.6));
        const src = await window.api.writeAsset(e.rel, new Uint8Array(await blob.arrayBuffer()), photo ? 'jpg' : 'png');
        e.viewer.fitWidth(); e.viewer.scrollToPage(0);
        e.setPageData(e.pages[0].id, { strokes: [], texts: [], items: [{ id: 'img', type: 'img', x: 30, y: 60, w: W, h: H, src }] });
      }, [css, cond, LINES]);
      await win.waitForTimeout(250);
      await ed(() => { window.__ocrDebug = []; window.__mk = window.__app.active.makePageEditable(0); });
      if (first) {
        await win.waitForTimeout(400);
        if (await win.locator('.modal-actions .btn', { hasText: 'Download' }).count()) await win.locator('.modal-actions .btn', { hasText: 'Download' }).click();
        first = false;
      }
      await ed(() => window.__mk);
      const d = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });
      const t = d.texts.slice().sort((a, b) => a.y - b.y);
      if (process.env.LOGT) console.log(JSON.stringify(t.map((q) => [q.text.slice(0, 12), q.x, q.y, q.w, q.fs, q.r])));
      const got = t.map((q) => q.text).join('\n'), want = LINES.join('\n');
      const cer = lev(got, want) / want.length;
      const fams = [...new Set(t.map((q) => q.ff))].join('/');
      const rot = t.length ? (t.reduce((a, q) => a + (q.r || 0), 0) / t.length).toFixed(1) : '-';
      rows.push({ font: css, cond, cer, fams, want: fam, rot, n: t.length });
      const soft = t.length ? Math.max(...t.map((q) => q.look || 0)) : 0;
      console.log(`${css.padEnd(15)} ${cond.padEnd(9)} soft ${soft.toFixed(2)} CER ${(cer * 100).toFixed(1).padStart(5)}%  font ${fams.padEnd(14)} (want ${fam})  angle ${rot}  lines ${t.length}`);
      if (process.env.DUMP) {
        const urls = await ed(() => window.__ocrDebug);
        urls.forEach((u, k) => fs.writeFileSync(path.join(out, `dump-${css.replace(/\W/g, '')}-${cond}-${k ? 'orig' : 'norm'}.png`), Buffer.from(u.split(',')[1], 'base64')));
      }
      if (process.env.SHOTS) {
        const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
        const z = await ed(() => window.__app.active.viewer.zoom);
        await win.screenshot({ path: path.join(out, `bench-${fam}-${css.replace(/\W/g, '')}-${cond}.png`), clip: { x: r.left + 20 * z, y: r.top + 50 * z, width: 545 * z, height: 170 * z } });
      }
    }
  }
  const avg = rows.reduce((a, r) => a + r.cer, 0) / rows.length;
  console.log(`average CER ${(avg * 100).toFixed(2)}%`);
  check('bench: average character error rate below 3 %', avg < 0.03, (avg * 100).toFixed(2) + '%');
  check('bench: no case above 12 %', rows.every((r) => r.cer < 0.12), rows.filter((r) => r.cer >= 0.12).map((r) => `${r.font}/${r.cond} ${(r.cer * 100).toFixed(0)}%`).join(', '));
  await app.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
