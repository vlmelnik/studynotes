// Chat with Claude Code inside StudyNotes (the Obsidian-plugin way): a fake
// `claude` (fixtures/fake-claude.js) receives the message, uses the StudyNotes
// MCP tools through the bridge in --mcp-config, and streams events back.
// Checks the settings, the chat panel, the tool use, resuming the conversation,
// the blocked built-in tools and the "not signed in" message.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/claude-chat.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { check, errors, finish } = require('./harness/report');
const { launch, root } = require('./harness/app');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-cc-'));
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\sn-cc-test-${process.pid}` : path.join(tmp, 'mcp.sock');
  const fake = path.join(root, 'test', 'e2e', 'fixtures', 'fake-claude.js');
  const pdf = path.join(tmp, 'Power electronics.pdf');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '2'], { stdio: 'ignore' });
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_MCP_PIPE: pipe, STUDYNOTES_CLAUDE_BIN: fake } });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  const rel = await ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf);
  await ed((r) => window.__app.openNotebook(r), rel);
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);
  await win.waitForTimeout(800);

  // ---- settings ----
  await ed(() => window.__app.showSettings('ai'));
  const ai = win.locator('.ai-settings');
  await ai.getByRole('switch', { name: 'AI assistant' }).press('Space');
  await ai.getByRole('radio', { name: /Claude Code/ }).click();
  await win.locator('.mcp-line').first().waitFor();
  const found = await win.locator('.mcp-line').first().textContent();
  check('Settings: Claude Code is found', found.startsWith('Claude Code found') && found.includes('fake-claude.js'), found);
  check('Settings: the note about the terms is shown', /not settled/.test(await ai.locator('.ai-note').textContent()));
  await ai.getByLabel('Claude Code model').selectOption('sonnet');
  await win.getByRole('button', { name: 'Done', exact: true }).click();
  const cfg = await ed(() => window.__app.settings.ai);
  check('settings saved: via Claude Code, model', cfg.via === 'claudecode' && cfg.ccModel === 'sonnet' && cfg.enabled, JSON.stringify(cfg));

  // ---- chat ----
  await win.keyboard.press('Control+j');
  await win.locator('.chat-input').waitFor();
  check('Ctrl+J opens the chat', await win.locator('.chat-hello').isVisible());
  const g = await win.locator('.ai-resize').boundingBox();
  const w0 = await win.locator('.ai-panel').evaluate((el) => el.offsetWidth);
  await win.mouse.move(g.x + 3, g.y + 200); await win.mouse.down(); await win.mouse.move(g.x - 150, g.y + 200, { steps: 5 }); await win.mouse.up();
  const w1 = await win.locator('.ai-panel').evaluate((el) => el.offsetWidth);
  check('the chat panel is wider after dragging its edge, and remembers it', w1 > w0 + 100 && await ed(() => window.__app.settings.aiPanelWidth) === w1, JSON.stringify({ w0, w1 }));
  await win.locator('.chat-input').fill('What notebooks do I have? Write something on this page.');
  await win.locator('.chat-input').press('Enter');
  await win.locator('.chat-msg.assistant .chat-text').first().waitFor({ timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('.chat-msg.assistant .ai-wait'), null, { timeout: 20000 });
  const reply = await win.locator('.chat-msg.assistant').last().textContent();
  check('the answer streams in with the tools Claude used', /list notebooks/.test(reply) && /add text/.test(reply) && /Power electronics \(path: Power electronics, 2 pages/.test(reply), reply.slice(0, 300));
  check('Claude Code got only the StudyNotes tools', /flags: strict=true blocked=true allowed=9/.test(reply), reply);
  const page = await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).texts.map((t) => t.text));
  check('Claude changed the open notebook through StudyNotes', page.includes('Written by the chat'), JSON.stringify(page));
  check('the change is one Ctrl+Z away', await ed(() => { window.__app.active.tools.clearSelection(true); window.__app.active.undo(); return !window.__app.active.pageData(window.__app.active.pages[0].id).texts.length; }));

  // ---- the conversation continues (resume) ----
  await win.locator('.chat-input').fill('and now?');
  await win.locator('.chat-input').press('Enter');
  await win.waitForFunction(() => document.querySelectorAll('.chat-msg.assistant').length === 2 && !document.querySelector('.chat-msg.assistant .ai-wait'), null, { timeout: 20000 });
  check('the next message resumes the same conversation', /resumed sess-1/.test(await win.locator('.chat-msg.assistant').last().textContent()));

  // ---- not signed in ----
  await win.locator('.ai-head button', { hasText: 'New chat' }).click();
  await win.locator('.chat-input').fill('not signed in test');
  await win.locator('.chat-input').press('Enter');
  await win.locator('.chat-msg.assistant .ai-error').waitFor({ timeout: 20000 });
  check('not signed in: says how to sign in', /run "claude" and sign in/.test(await win.locator('.chat-msg.assistant .ai-error').textContent()));

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
