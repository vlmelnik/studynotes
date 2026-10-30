// Opens real-world PDFs given on the command line, scrolls, writes, exports.
// usage: xvfb-run -a node test/e2e/real-pdfs.js a.pdf b.pdf
const { _electron: electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'test', 'out');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-real-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: path.join(tmp, 'L'), STUDYNOTES_USERDATA: path.join(tmp, 'u') } });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 200)); });
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app);
  let k = 0;
  for (const file of process.argv.slice(2)) {
    k++;
    const t0 = Date.now();
    const rel = await win.evaluate(async (f) => (await window.api.importFiles('', [f]))[0], file);
    await win.evaluate((r) => window.__app.openNotebook(r), rel);
    await win.waitForFunction(() => { const v = window.__app.active && window.__app.active.viewer; const pv = v && v.view(v.currentIndex); return pv && pv.bgScale > 0; }, null, { timeout: 120000 });
    const n = await win.evaluate(() => window.__app.active.pages.length);
    console.log(`${path.basename(file)}: ${n} pages, first page visible after ${Date.now() - t0} ms`);
    await win.waitForTimeout(800);
    await win.screenshot({ path: path.join(out, `real-${k}-a.png`) });
    const mid = Math.floor(n / 2);
    const t1 = Date.now();
    await win.evaluate((i) => window.__app.active.viewer.scrollToPage(i), mid);
    await win.waitForFunction((i) => { const pv = window.__app.active.viewer.view(i); return pv && pv.bgScale >= pv.targetScale() * 0.97; }, mid, { timeout: 60000 });
    console.log(`  jump to page ${mid + 1}: sharp after ${Date.now() - t1} ms`);
    // a pen stroke with the mouse
    const r = await win.evaluate((i) => window.__app.active.viewer.pageClientRect(i), mid);
    await win.mouse.move(r.left + 100, r.top + 200);
    await win.mouse.down();
    for (let i = 0; i < 30; i++) await win.mouse.move(r.left + 100 + i * 8, r.top + 200 + Math.sin(i / 3) * 15);
    await win.mouse.up();
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(out, `real-${k}-b.png`) });
    await win.evaluate(() => window.__app.active.flush());
    const ef = path.join(tmp, `export-${k}.pdf`);
    const t2 = Date.now();
    await win.evaluate(([a, b]) => window.api.exportTo(a, null, b), [rel, ef]);
    const pages = /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [ef]).toString())[1];
    console.log(`  export: ${pages} pages in ${Date.now() - t2} ms, ${(fs.statSync(ef).size / 1e6).toFixed(1)} MB (source ${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
    execFileSync('pdftoppm', ['-r', '60', '-png', '-f', String(mid + 1), '-l', String(mid + 1), ef, path.join(out, `real-${k}-export`)]);
    const m = await app.evaluate(({ app }) => app.getAppMetrics().filter((p) => p.type === 'Tab').map((p) => Math.round(p.memory.workingSetSize / 1024) + 'MB').join());
    console.log(`  renderer memory: ${m}`);
  }
  console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
