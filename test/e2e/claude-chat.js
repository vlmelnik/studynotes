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
  const { app, win, ed } = await launch({ tmp, env: { STUDYNOTES_MCP_PIPE: pipe, STUDYNOTES_CLAUDE_BIN: fake, STUDYNOTES_CODEX_BIN: path.join(path.dirname(fake), 'fake-codex.js'), STUDYNOTES_SPEECH_FAKE: '1' } });
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
  check('Settings: the note about the terms is shown', await ai.locator('.ai-note:visible', { hasText: 'not settled' }).count() === 1);
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
  // the header fits when the panel is at its narrowest
  const g2 = await win.locator('.ai-resize').boundingBox();
  await win.mouse.move(g2.x + 3, g2.y + 200); await win.mouse.down(); await win.mouse.move(g2.x + 600, g2.y + 200, { steps: 4 }); await win.mouse.up();
  const fit = await win.evaluate(() => { const x = document.querySelector('.ai-head button[title^="Close"]').getBoundingClientRect(); const p = document.querySelector('.ai-panel').getBoundingClientRect(); return { right: x.right, pr: p.right, w: window.innerWidth, pw: p.width }; });
  check('narrowest panel: the close button stays inside the panel and the window', fit.right <= fit.pr - 2 && fit.pr <= fit.w && fit.pw <= 290, JSON.stringify(fit));
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
  await win.getByRole('button', { name: 'New chat', exact: true }).click();
  await win.locator('.chat-input').fill('not signed in test');
  await win.locator('.chat-input').press('Enter');
  await win.locator('.chat-msg.assistant .ai-error').waitFor({ timeout: 20000 });
  check('not signed in: says how to sign in', /run "claude" and sign in/.test(await win.locator('.chat-msg.assistant .ai-error').textContent()));

  // ---- attachments: a picture, a PDF and a text file; Claude puts the picture into the notes ----
  const png = (() => {
    const zlib = require('zlib');
    const w = 60, hh = 30, raw = Buffer.alloc((w * 3 + 1) * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) raw.set([30, 120, 220], y * (w * 3 + 1) + 1 + x * 3);
    const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hh, 4); ihdr.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  })();
  fs.writeFileSync(path.join(tmp, 'circuit.png'), png);
  fs.writeFileSync(path.join(tmp, 'notes.txt'), 'hello from a file');
  await win.getByRole('button', { name: 'New chat', exact: true }).click();
  await win.locator('.ai-panel input[type=file]').setInputFiles([path.join(tmp, 'circuit.png'), pdf, path.join(tmp, 'notes.txt')]);
  await win.waitForFunction(() => document.querySelectorAll('.chat-files .chat-file').length === 3);
  check('attached files show as chips', (await win.locator('.chat-files .chat-file').allTextContents()).join('|').includes('circuit.png'));
  const itemsBefore = await ed(() => window.__app.active.pageData(window.__app.active.pages[0].id).items.length);
  await win.locator('.chat-input').fill('picture test');
  await win.locator('.chat-input').press('Enter');
  await win.waitForFunction(() => document.querySelectorAll('.chat-msg.assistant').length === 1 && !document.querySelector('.chat-msg.assistant .ai-wait'), null, { timeout: 20000 });
  const pic = await win.locator('.chat-msg.assistant').last().textContent();
  check('Claude gets the picture and the PDF as attachments and the text file in the message', /seen: images=1 documents=1 text-file=true/.test(pic), pic);
  check('the answer is shown as Markdown (bold, list)', await win.locator('.chat-msg.assistant .chat-text.md b').count() > 0 && await win.locator('.chat-msg.assistant .chat-text.md li').count() === 2);
  const after = await ed(() => window.__app.active.pages.map((p) => window.__app.active.pageData(p.id).items.filter((it) => it.type === 'img').length).reduce((a, b) => a + b, 0));
  check('the attached picture is placed in the notebook', after === itemsBefore + 1 && /Wrote 2 block/.test(pic), JSON.stringify({ itemsBefore, after, pic }));
  if (process.env.SHOT) { fs.mkdirSync(process.env.SHOT, { recursive: true }); await win.screenshot({ path: path.join(process.env.SHOT, 'chat-files.png') }); }
  check('the user message lists its files', (await win.locator('.chat-msg.user .chat-file').count()) === 3);

  // ---- history ----
  await win.getByRole('button', { name: 'Chat history' }).click();
  await win.locator('.chat-hist-row').first().waitFor();
  const rows = await win.locator('.chat-hist-row').count();
  if (process.env.SHOT) await win.screenshot({ path: path.join(process.env.SHOT, 'chat-history.png') });
  check('history: all chats, newest first', rows === 3 && /picture test/.test(await win.locator('.chat-hist-row').first().textContent()), String(rows));
  await win.locator('.chat-hist-open', { hasText: 'What notebooks do I have' }).click();
  await win.locator('.chat-msg.assistant').nth(1).waitFor();
  check('history: an old chat opens with its messages and continues its session', /resumed sess-1/.test(await win.locator('.chat-msg.assistant').nth(1).textContent()) && await win.evaluate(() => window.__app.active.aiPanel.chat.sessionId === 'sess-1'));
  await win.getByRole('button', { name: 'Chat history' }).click();
  await win.locator('.chat-hist-row', { hasText: 'not signed in test' }).getByRole('button', { name: /Delete chat/ }).click();
  await win.waitForFunction(() => document.querySelectorAll('.chat-hist-row').length === 2);
  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'u', 'chats.json'), 'utf8')).chats;
  check('history is saved on this computer, without the deleted chat and without file contents', stored.length === 2 && !JSON.stringify(stored).includes('hello from a file') && !stored.some((c) => /not signed in/.test(c.title)), JSON.stringify(stored.map((c) => c.title)));

  // ---- chat settings ----
  await win.getByRole('button', { name: 'Chat settings' }).click();
  await win.getByLabel('Your instructions for Claude').fill('Always answer in German.');
  await win.getByLabel('Your instructions for Claude').press('Tab');
  await win.locator('.chat-settings').getByLabel('Notes text size').fill('17');
  await win.locator('.chat-settings').getByLabel('Notes text size').press('Tab');
  if (process.env.SHOT) await win.screenshot({ path: path.join(process.env.SHOT, 'chat-settings.png') });
  const st = await ed(() => ({ mine: window.__app.settings.ai.ccInstructions, nb: window.__app.active.doc.nb.notesStyle, app: window.__app.settings.notesStyle }));
  check('chat settings: own instructions, and a notes style for this notebook only', st.mine === 'Always answer in German.' && st.nb && st.nb.fs === 17 && !(st.app && st.app.fs === 17), JSON.stringify(st));

  // ---- a recording: off → points to the add-on; on → transcribed on this computer, Claude gets the text ----
  const wav = (() => {
    const sr = 22050, n = Math.round(sr * 2.5), b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2);
    return b;
  })();
  fs.writeFileSync(path.join(tmp, 'lecture.wav'), wav);
  await win.getByRole('button', { name: 'Chat settings' }).click(); // back to the chat
  await win.getByRole('button', { name: 'New chat', exact: true }).click();
  await win.locator('.ai-panel input[type=file]').setInputFiles(path.join(tmp, 'lecture.wav'));
  await win.locator('.toast', { hasText: 'Speech to text' }).waitFor();
  check('a recording without the add-on: says where to switch it on', (await win.locator('.chat-files .chat-file').count()) === 0);
  await ed(() => window.__app.showSettings('addons'));
  const spCard = win.locator('.addon', { has: win.locator('.addon-title b', { hasText: /^Speech to text$/ }) });
  check('Add-ons: "Speech to text" is there and off', await spCard.isVisible() && !(await spCard.getByRole('switch').isChecked()));
  await spCard.getByRole('switch').press('Space');
  await spCard.click();
  await win.getByLabel('Language of the recordings').waitFor();
  check('its page: model, language (from the app language), the model on this computer', (await win.getByLabel('Speech model').locator('option').count()) === 2 && (await win.getByLabel('Language of the recordings').inputValue()) === 'english' && /offline/.test(await win.locator('.addon-state').first().textContent()));
  await win.getByLabel('Language of the recordings').selectOption('german');
  await win.getByRole('button', { name: 'Done', exact: true }).click();
  await win.locator('.ai-panel input[type=file]').setInputFiles(path.join(tmp, 'lecture.wav'));
  await win.waitForFunction(() => { const c = document.querySelector('.chat-files .chat-file'); return c && /transcript/.test(c.textContent) && !c.querySelector('.chat-file-busy'); }, null, { timeout: 20000 });
  await win.locator('.chat-input').fill('transcript test');
  await win.locator('.chat-input').press('Enter');
  await win.waitForFunction(() => document.querySelectorAll('.chat-msg.assistant').length === 1 && !document.querySelector('.chat-msg.assistant .ai-wait'), null, { timeout: 20000 });
  const tx = await win.locator('.chat-msg.assistant').last().textContent();
  check('the recording is decoded (16 kHz) and transcribed in German, Claude gets the transcript', /fake transcript: 2\.5 s, german, base/.test(tx), tx);

  // ---- the same chat with ChatGPT (Codex) ----
  await ed(() => { window.__app.settings.ai.engine = 'codex'; });
  await win.locator('.chat-input').fill('codex test');
  await win.locator('.chat-input').press('Enter');
  await win.waitForFunction(() => /codex:/.test([...document.querySelectorAll('.chat-msg.assistant')].pop()?.textContent || '') && !document.querySelector('.chat-msg.assistant .ai-wait'), null, { timeout: 20000 });
  const cx = await win.locator('.chat-msg.assistant').last().textContent();
  check('ChatGPT (Codex): read-only, a new session (not Claude\'s), StudyNotes tools work', /list notebooks/.test(cx) && /sandbox=read-only/.test(cx) && /resumed=false/.test(cx) && /Power electronics/.test(cx), cx.slice(0, 300));
  await win.locator('.chat-input').fill('codex again');
  await win.locator('.chat-input').press('Enter');
  await win.waitForFunction(() => /resumed=true/.test([...document.querySelectorAll('.chat-msg.assistant')].pop()?.textContent || ''), null, { timeout: 20000 });
  check('the next message goes on with the Codex session', true);

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
