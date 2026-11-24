// Extension host API v2 (1.9): an extension reads the open notebook with ids,
// asks the user's AI (the user confirms what is sent), previews and applies a
// plan as one undo step. Uses a fake local model server like ai.js.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/extensions-host-v2.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const { check, errors, finish } = require('./harness/report');
const { launch, root } = require('./harness/app');

const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    seen.push(j);
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, ops: [{ op: 'addPage', after: 1, title: 'From the extension' }] }) } }] }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-ext2-'));
  const pdf = path.join(tmp, 'Slides.pdf');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '2'], { stdio: 'ignore' });
  const { app, win, ed } = await launch({ tmp });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  const rel = await ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf);
  await ed((r) => window.__app.openNotebook(r), rel);
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);
  await win.waitForTimeout(1500);

  const added = await ed(() => window.__app.extensions.add({
    id: 'e2e-v2', name: 'E2E v2', apiVersion: 2,
    activate(host) { window.__v2 = host; },
  }, { enabled: true }));
  check('an API v2 extension starts', added === true && await ed(() => !!window.__v2 && window.__v2.apiVersion === 2));
  check('API v1 extensions still start', await ed(() => window.__app.extensions.add({ id: 'e2e-v1', apiVersion: 1, activate() {} }, { enabled: true })));

  const read = await ed(() => window.__v2.notebook.read({ scope: 'page' }));
  check('notebook.read: the open notebook with ids', read && read.title === 'Slides' && read.pages === 2 && read.text.includes('=== Page 1 (PDF) ==='), JSON.stringify(read).slice(0, 200));

  const notReady = await ed(() => window.__v2.ai.request({ user: 'x' }).then(() => 'sent', (e) => String(e.message)));
  check('ai.request without setup says what to do', /Set up the AI assistant/.test(notReady), notReady);
  await ed((base) => { Object.assign(window.__app.settings.ai ||= {}, { enabled: true, provider: 'local', baseUrl: base, model: 'fake', monthlyLimit: 0 }); }, `http://127.0.0.1:${server.address().port}/v1`);

  // the user cancels: nothing is sent
  const cancelled = ed(() => window.__v2.ai.request({ system: 'S', user: 'U', purpose: 'make a summary page' }).then(() => 'sent', (e) => String(e.message)));
  await win.getByRole('button', { name: 'Cancel' }).click();
  check('ai.request: the user is asked, Cancel sends nothing', /Cancelled/.test(await cancelled) && seen.length === 0);
  // the user confirms
  const asked = ed(() => window.__v2.ai.request({ system: 'S', user: 'U', purpose: 'make a summary page' }));
  const dialog = await win.locator('.modal', { hasText: 'make a summary page' }).textContent();
  await win.getByRole('button', { name: 'Send', exact: true }).click();
  const text = await asked;
  check('the dialog names the extension, the purpose and the size', /E2E v2/.test(dialog) && /2 characters/.test(dialog), dialog);
  check('ai.request returns the model answer', text.includes('From the extension') && seen.length === 1 && seen[0].messages[0].content === 'S');

  const plan = JSON.parse(text);
  const pv = await ed((p) => window.__v2.notebook.preview(p), plan);
  check('notebook.preview describes the plan', pv.ok && pv.lines[0] === 'Add a page after page 1: "From the extension" (bookmarked)', JSON.stringify(pv));
  const res = await ed((p) => window.__v2.notebook.apply(p), plan);
  const n = await ed(() => window.__app.active.pages.length);
  check('notebook.apply: applied as one undo step', res.applied === 1 && n === 3);
  await ed(() => window.__app.active.undo());
  check('one undo removes it', await ed(() => window.__app.active.pages.length === 2));

  await app.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
