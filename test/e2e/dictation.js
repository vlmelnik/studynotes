// Dictation with the microphone (a fake microphone that plays a tone with
// pauses, and a fake speech model): the setup popover the first time, text
// phrase by phrase into a new text box on the page or the box being edited,
// and into the chat input; stop with a second click.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/dictation.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { check, errors, finish } = require('./harness/report');
const { launch } = require('./harness/app');

function wav(file) {
  // 1.5 s tone, 1.5 s quiet (the fake microphone plays it in a loop)
  const sr = 16000, n = sr * 3, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(i < sr * 1.5 ? Math.round(9000 * Math.sin(2 * Math.PI * 330 * i / sr)) : 0, 44 + i * 2);
  fs.writeFileSync(file, b);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-dict-'));
  wav(path.join(tmp, 'voice.wav'));
  const { app, win, ed } = await launch({
    tmp, env: { STUDYNOTES_SPEECH_FAKE: '1' },
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(tmp, 'voice.wav')}`],
  });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'Dictation', paper: 'lined', pageCount: 1 }); await window.__app.openNotebook(r); });
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);

  // ---- first time: the popover asks for language and model ----
  const mic = win.locator('.tb-center .mic-btn');
  await mic.click();
  await win.locator('.mic-pop').waitFor();
  check('first click: the dictation popover with language and model', await win.locator('.mic-pop').getByLabel('Language of the recordings').isVisible() && await win.locator('.mic-pop').getByLabel('Speech model').isVisible());
  await win.locator('.mic-pop').getByLabel('Language of the recordings').selectOption('russian');
  await win.locator('.mic-pop').getByRole('button', { name: /Start/ }).click();
  await win.waitForFunction(() => document.querySelector('.tb-center .mic-btn.on'), null, { timeout: 10000 });
  check('settings remembered: speech to text on, Russian', await ed(() => window.__app.settings.speech.enabled && window.__app.settings.speech.language === 'russian'));

  // ---- phrases arrive in a new text box on the next free line ----
  await win.waitForFunction(() => {
    const e = window.__app.active; const d = e.pageData(e.pages[0].id);
    const el = document.querySelector('.textbox[contenteditable="true"]');
    return el && /fake transcript.*fake transcript/s.test(el.textContent);
  }, null, { timeout: 20000 });
  const txt = await win.evaluate(() => document.querySelector('.textbox[contenteditable="true"]').textContent);
  check('phrase by phrase into a new text box (Russian, 16 kHz)', /^fake transcript: [\d.]+ s, russian, base fake transcript/.test(txt), txt);
  await mic.click();
  await win.waitForFunction(() => !document.querySelector('.mic-btn.on'), null, { timeout: 10000 });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  const saved = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).texts.map((t) => ({ y: t.y, text: t.text })); });
  check('second click stops; the text is in the notebook, on the first lines', saved.length === 1 && /fake transcript/.test(saved[0].text) && saved[0].y < 120, JSON.stringify(saved));
  const n0 = saved[0].text.length;

  // ---- the next dictation goes to a new box below ----
  await mic.click();
  await win.waitForFunction(() => document.querySelectorAll('.textbox').length === 2 && /fake transcript/.test(document.querySelectorAll('.textbox')[1].textContent), null, { timeout: 20000 });
  await mic.click();
  await win.waitForFunction(() => !document.querySelector('.mic-btn.on'), null, { timeout: 10000 });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  const two = await ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id).texts.map((t) => ({ y: t.y, text: t.text })); });
  check('no popover the second time; a new box below the first', two.length === 2 && two[1].y > two[0].y + 10 && two[0].text.length === n0, JSON.stringify(two));

  // ---- into the chat input ----
  await ed(() => { window.__app.settings.ai = { enabled: true, via: 'claudecode' }; });
  await win.keyboard.press('Control+j');
  await win.locator('.chat-input').waitFor();
  await win.locator('.chat-mic').click();
  await win.waitForFunction(() => /fake transcript/.test(document.querySelector('.chat-input').value), null, { timeout: 20000 });
  await win.locator('.chat-mic').click();
  await win.waitForFunction(() => !document.querySelector('.mic-btn.on'), null, { timeout: 10000 });
  check('the chat microphone writes into the message box', /^fake transcript: [\d.]+ s, russian/.test(await win.locator('.chat-input').inputValue()));

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
