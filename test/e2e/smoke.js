// Smoke test (under 3 minutes): boot, new notebook, one pen stroke, save and
// reopen after a restart, export to PDF. Needs pdfinfo and pdftotext (poppler).
// usage: npm run test:e2e:smoke   (on Linux: xvfb-run -a -s "-screen 0 1600x1000x24" ...)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { check, errors, finish } = require('./harness/report');
const { launch } = require('./harness/app');
const { at } = require('./harness/page');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-smoke-'));
  const pageData = (ed) => ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });

  // ---------- boot ----------
  let { app, win, ed } = await launch({ tmp });
  await win.waitForFunction(() => document.querySelector('.library'), null, { timeout: 30000 });
  check('boot: the app starts and shows the library', true);

  // ---------- notebook + one pen stroke ----------
  const rel = await ed(async () => {
    const r = await window.api.createNotebook('', { title: 'Smoke', paper: 'lined', pageCount: 2 });
    await window.__app.openNotebook(r);
    return r;
  });
  await win.waitForTimeout(600);
  const pages = await ed(() => window.__app.active.pages.length);
  check('notebook: created and opened with its pages', pages === 2, `${pages} pages`);
  await win.keyboard.press('p');
  const [x0, y0] = await at(ed, 100, 200);
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  for (let i = 1; i <= 30; i++) {
    const [x, y] = await at(ed, 100 + i * 8, 200 + Math.sin(i / 3) * 15);
    await win.mouse.move(x, y, { steps: 3 });
  }
  await win.mouse.up();
  await win.waitForTimeout(300);
  const drawn = (await pageData(ed)).strokes;
  check('pen: one stroke is drawn', drawn.length === 1 && drawn[0].p.length >= 30 * 3, `${drawn.length} stroke(s), ${drawn[0] && drawn[0].p.length / 3} points`);

  // ---------- save, restart, reopen ----------
  await ed(() => window.__app.active.flush());
  await app.close();
  ({ app, win, ed } = await launch({ tmp }));
  await ed((r) => window.__app.openNotebook(r), rel);
  await win.waitForTimeout(800);
  const again = (await pageData(ed)).strokes;
  check('reopen: the stroke is still there after a restart', again.length === 1 && again[0].p.length === drawn[0].p.length, `${again.length} stroke(s)`);

  // ---------- export ----------
  const pdf = path.join(tmp, 'smoke.pdf');
  await ed(([r, f]) => window.api.exportTo(r, null, f), [rel, pdf]);
  const info = execFileSync('pdfinfo', [pdf]).toString();
  check('export: pdfinfo reads the PDF with both pages', /Pages:\s+2\b/.test(info), (/Pages:.*/.exec(info) || [''])[0]);
  let textOk = true;
  try { execFileSync('pdftotext', [pdf, '-']); } catch { textOk = false; }
  check('export: pdftotext reads the PDF', textOk);

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
