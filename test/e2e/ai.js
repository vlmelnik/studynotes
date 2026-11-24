// AI assistant (1.9) against a fake local model server (OpenAI-compatible,
// like Ollama / LM Studio): settings and model list, what is sent, a summary
// plan applied as one undo step, underlining a text box, a bad plan, "ask"
// mode, server errors, the monthly limit, the API key not stored in plain text.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/ai.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const { check, errors, finish } = require('./harness/report');
const { launch, root } = require('./harness/app');

// the fake model: answers by what the request asks for
let next = null; // (body) => { status, content }
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'fake-small' }, { id: 'fake-large' }] })); return; }
    const j = JSON.parse(body || '{}');
    seen.push(j);
    const r = next ? next(j) : { content: '{"version":1,"ops":[]}' };
    res.statusCode = r.status || 200;
    res.end(JSON.stringify(r.status >= 400 ? { error: { message: r.content } } : { choices: [{ message: { content: r.content } }] }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-ai-'));
  const pdf = path.join(tmp, 'Power electronics.pdf');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '3'], { stdio: 'ignore' });
  const { app, win, ed } = await launch({ tmp });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  const rel = await ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf);
  await ed((r) => window.__app.openNotebook(r), rel);
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);
  await win.waitForTimeout(2000);

  // ---- not set up: the panel says what to do ----
  await win.keyboard.press('Control+j');
  check('Ctrl+J opens the AI panel; without setup it points to the AI settings', await win.locator('.ai-panel', { hasText: 'Set up the AI assistant' }).isVisible() && await win.locator('.ai-panel').getByRole('button', { name: 'Open AI settings' }).isVisible());
  await win.keyboard.press('Control+j');

  // ---- settings ----
  await ed(() => window.__app.showSettings('ai'));
  const card = win.locator('.ai-settings');
  await card.getByRole('switch', { name: 'AI assistant' }).press('Space');
  check('ways to connect: Claude Code, Claude app, API key, local model', /^Claude Code.*\|Claude app.*\|.*API key.*\|.*Local model/.test((await card.getByRole('radio').allTextContents()).join('|')), (await card.getByRole('radio').allTextContents()).join('|'));
  await card.getByRole('radio', { name: /Local model/ }).click();
  await card.getByLabel('Server address').fill(base);
  await card.getByLabel('Server address').press('Tab');
  await card.getByRole('button', { name: 'Load models' }).click();
  await win.waitForTimeout(500);
  const models = await card.getByLabel('Model').locator('option').allTextContents();
  check('Load models lists what the server offers', models.includes('fake-small') && models.includes('fake-large'), JSON.stringify(models));
  await card.getByLabel('Model').selectOption('fake-small');
  // a key for another provider is never stored as plain text
  const keyErr = await ed(() => window.api.aiSetKey('openai', 'sk-test-plain-123').then(() => null, (e) => String(e.message)));
  const keyFile = path.join(tmp, 'u', 'ai-keys.json');
  check('an API key is not stored in plain text', keyErr ? /secure key store/.test(keyErr) : !fs.readFileSync(keyFile, 'utf8').includes('sk-test-plain-123'), keyErr || 'saved encrypted');
  await win.getByRole('button', { name: 'Done', exact: true }).click();
  const ai = await ed(() => window.__app.settings.ai);
  check('settings saved: on, local, server, model', ai.enabled && ai.via === 'local' && ai.provider === 'local' && ai.baseUrl === base && ai.model === 'fake-small', JSON.stringify(ai));

  // ---- what is sent ----
  await win.keyboard.press('Control+j');
  const info = await win.locator('.ai-info').textContent();
  check('before sending it shows what goes out', /Sends page 1, ~[\d,.]+ characters/.test(info) && info.includes('local'), info);

  // ---- summary: a new page with a title and text, one undo step ----
  next = (j) => {
    const user = j.messages[1].content;
    const ok = j.messages[0].content.includes('"addPage"') && user.includes('=== Page 1 (PDF) ===') && user.includes('Request: Summarise');
    return { content: ok ? JSON.stringify({ version: 1, answer: 'Here is a summary.', ops: [{ op: 'addPage', after: 1, title: 'Summary' }, { op: 'addText', page: 'new:1', text: 'MOSFETs switch fast.\n\nSiC has a wide band gap.' }] }) : '{"version":1,"ops":[]}' };
  };
  await win.locator('.ai-actions button', { hasText: 'Summarise' }).click();
  await win.locator('.ai-plan').waitFor();
  if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT }); // SHOT=<file.png>: the panel with a plan
  const preview = await win.locator('.ai-op').allTextContents();
  check('the plan is previewed line by line', preview.length === 2 && /Add a page after page 1: "Summary"/.test(preview[0]) && /New page 1: add text "MOSFETs switch fast/.test(preview[1]), JSON.stringify(preview));
  check('the answer is shown', (await win.locator('.ai-answer').textContent()) === 'Here is a summary.');
  await win.locator('.ai-plan-btns button', { hasText: 'Apply' }).click();
  await win.waitForTimeout(500);
  const applied = await ed(() => { const e = window.__app.active; const p = e.pages[1]; return { n: e.pages.length, bm: !!p.bm, texts: e.pageData(p.id).texts.map((t) => t.text) }; });
  check('Apply: new page 2, bookmarked, with title and summary', applied.n === 4 && applied.bm && applied.texts[0] === 'Summary' && applied.texts[1].startsWith('MOSFETs switch fast'), JSON.stringify(applied));
  await ed(() => window.__app.active.undo());
  await win.waitForTimeout(300);
  check('one Ctrl+Z undoes the whole plan', await ed(() => window.__app.active.pages.length === 3));
  await ed(() => window.__app.active.redo());
  await win.waitForTimeout(300);
  check('redo brings it back', await ed(() => window.__app.active.pages.length === 4 && window.__app.active.pageData(window.__app.active.pages[1].id).texts.length === 2));

  // ---- underline the terms of a text box ----
  await ed(() => { const e = window.__app.active; e.viewer.scrollToPage(0); });
  await win.waitForTimeout(400);
  await ed(() => window.__app.active.pasteData({ text: 'The MOSFET is a transistor. A mosfet switches.', html: '', files: [] }));
  await win.waitForTimeout(300);
  next = (j) => {
    const m = /\[p1 t:([\w-]+)\] The MOSFET/.exec(j.messages[1].content);
    return { content: JSON.stringify({ version: 1, ops: m ? [{ op: 'underline', page: 1, id: m[1], terms: ['MOSFET', 'transistor'] }] : [] }) };
  };
  await win.keyboard.press('Escape');
  await win.locator('.ai-scope button', { hasText: 'This page' }).click();
  await win.locator('.ai-actions button', { hasText: 'Underline key terms' }).click();
  await win.locator('.ai-plan').waitFor();
  await win.locator('.ai-plan-btns button', { hasText: 'Apply' }).click();
  await win.waitForTimeout(400);
  const underlined = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).texts.find((t) => /MOSFET/.test(t.text)).html; });
  check('underline: whole words in the text box', underlined === 'The <u>MOSFET</u> is a <u>transistor</u>. A <u>mosfet</u> switches.', underlined);

  // ---- a plan with problems: valid parts can still be applied ----
  next = () => ({ content: '```json\n' + JSON.stringify({ version: 1, ops: [{ op: 'addText', page: 99, text: 'x' }, { op: 'removeText', page: 1, id: 'whatever' }, { op: 'addBookmark', page: 3 }] }) + '\n```' });
  await win.locator('.ai-prompt').fill('Bookmark page 3 and clean up');
  await win.locator('.ai-send button', { hasText: 'Send' }).click();
  await win.locator('.ai-plan').waitFor();
  const probs = await win.locator('.ai-problem').allTextContents();
  check('bad changes are listed and left out', probs.length === 2 && /page 99 does not exist/.test(probs[0]), JSON.stringify(probs));
  await win.locator('.ai-plan-btns button', { hasText: 'Apply' }).click();
  await win.waitForTimeout(300);
  check('the valid change is applied', await ed(() => !!window.__app.active.pages[2].bm));

  // ---- ask mode: answer only, no changes even if the model sends some ----
  next = () => ({ content: JSON.stringify({ version: 1, answer: 'A MOSFET is a voltage-controlled switch.', ops: [{ op: 'addBookmark', page: 1 }] }) });
  await win.locator('.ai-actions button', { hasText: 'Explain' }).click();
  await win.locator('.ai-answer').waitFor();
  check('Explain: answer only, nothing to apply', (await win.locator('.ai-answer').textContent()).includes('voltage-controlled') && (await win.locator('.ai-plan').count()) === 0);
  check('Explain asked the model not to change anything', seen.at(-1).messages[0].content.includes('"ops" must be []'));

  // ---- errors ----
  next = () => ({ status: 500, content: 'model crashed' });
  await win.locator('.ai-prompt').fill('anything');
  await win.locator('.ai-send button', { hasText: 'Send' }).click();
  await win.locator('.ai-error').waitFor();
  check('a server error is shown readably', /error \(500\): model crashed/.test(await win.locator('.ai-error').textContent()));
  await ed(() => { window.__app.settings.ai.monthlyLimit = 1; });
  await win.locator('.ai-send button', { hasText: 'Send' }).click();
  await win.waitForTimeout(500);
  check('the monthly limit stops requests', /monthly limit of 1/.test(await win.locator('.ai-error').textContent()));
  check('the request log has no content', !fs.readFileSync(path.join(tmp, 'u', 'ai-log.json'), 'utf8').includes('MOSFET'));

  await app.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
