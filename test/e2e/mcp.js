// Claude (MCP): the app is switched on in Settings, "Connect Claude Desktop"
// writes Claude's config, then the bridge is started exactly as Claude
// Desktop would start it (command, args and env from that config) and speaks
// MCP over stdin/stdout: list, read, search, add text, add a page, bookmark,
// errors, undo in the app, switching off.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/mcp.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { check, errors, finish } = require('./harness/report');
const { launch, root } = require('./harness/app');

function bridge(cfg, env) {
  const p = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const w = waiting.get(msg.id);
      if (w) { waiting.delete(msg.id); w(msg); }
    }
  });
  let id = 0;
  const send = (method, params) => new Promise((resolve, reject) => {
    const my = ++id;
    const t = setTimeout(() => reject(new Error('no answer to ' + method)), 20000);
    waiting.set(my, (m) => { clearTimeout(t); resolve(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
  });
  const call = async (name, args) => {
    const r = await send('tools/call', { name, arguments: args });
    if (r.error) return { error: r.error.message };
    return { text: r.result.content.map((c) => c.text).join('\n'), isError: !!r.result.isError };
  };
  return { p, send, call, notify: (method) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'), close: () => p.stdin.end() };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-mcp-'));
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\sn-mcp-test-${process.pid}` : path.join(tmp, 'mcp.sock');
  const claudeCfg = path.join(tmp, 'Claude', 'claude_desktop_config.json');
  fs.mkdirSync(path.dirname(claudeCfg), { recursive: true });
  fs.writeFileSync(claudeCfg, JSON.stringify({ mcpServers: { other: { command: 'other.exe' } }, theme: 'dark' }));
  const pdf = path.join(tmp, 'Power electronics.pdf');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '3'], { stdio: 'ignore' });
  const env = { STUDYNOTES_MCP_PIPE: pipe, STUDYNOTES_CLAUDE_CONFIG: claudeCfg };
  const { app, win, ed } = await launch({ tmp, env });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  const rel = await ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf);
  // open once so the PDF text is indexed, then close it again
  await ed((r) => window.__app.openNotebook(r), rel);
  await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);
  await win.waitForTimeout(2500);
  await ed(() => window.__app.active.flush());
  await win.keyboard.press('Control+w');
  await win.waitForTimeout(500);

  // ---- settings: off by default, switch on, connect Claude Desktop ----
  await ed(() => window.__app.showSettings());
  await win.getByRole('button', { name: 'Add-ons', exact: true }).click();
  const toggle = win.getByRole('switch', { name: 'Claude (MCP)' });
  check('Claude access is off by default', !(await toggle.isChecked()));
  await toggle.press('Space');
  await win.waitForTimeout(500);
  check('the switch turns it on', await toggle.isChecked() && await ed(() => window.__app.settings.mcp === true));
  const addon = win.locator('.addon', { hasText: 'Claude (MCP)' });
  await addon.getByRole('button', { name: 'Settings' }).click();
  await addon.getByRole('button', { name: 'Connect Claude Desktop' }).click();
  await win.waitForTimeout(500);
  await win.getByRole('button', { name: 'Done', exact: true }).click();
  const cfgAll = JSON.parse(fs.readFileSync(claudeCfg, 'utf8'));
  const cfg = cfgAll.mcpServers && cfgAll.mcpServers.studynotes;
  check('Claude Desktop config: StudyNotes added, other entries kept, backup written',
    cfg && cfg.env.ELECTRON_RUN_AS_NODE === '1' && /mcp-bridge\.js$/.test(cfg.args[0]) && cfgAll.mcpServers.other && cfgAll.theme === 'dark' && fs.existsSync(claudeCfg + '.bak'), JSON.stringify(cfgAll));

  // ---- the bridge, started like Claude Desktop does ----
  const b = bridge(cfg, { STUDYNOTES_MCP_PIPE: pipe, STUDYNOTES_MCP_NO_LAUNCH: '1' });
  const init = await b.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  b.notify('notifications/initialized');
  check('initialize: StudyNotes answers with its version', init.result && init.result.serverInfo.name === 'StudyNotes' && init.result.protocolVersion === '2025-06-18', JSON.stringify(init));
  const list = await b.send('tools/list', {});
  check('tools/list: six tools', list.result.tools.length === 6, list.result.tools.map((t) => t.name).join(' '));

  const nbs = await b.call('list_notebooks', {});
  check('list_notebooks names the notebook and its pages', nbs.text.includes('Power electronics') && nbs.text.includes('3 pages'), nbs.text);
  const read = await b.call('read_notebook', { notebook: 'power electronics' });
  check('read_notebook (closed notebook): pages with their PDF text', /## Page 1/.test(read.text) && /## Page 3/.test(read.text) && /Lecture page 2/.test(read.text), read.text.slice(0, 300));
  const found = await b.call('search_notes', { query: 'Lecture page 3' });
  check('search_notes finds the page', /page 3/.test(found.text), found.text.slice(0, 200));

  const added = await b.call('add_text', { notebook: 'Power electronics', page: 2, text: 'Summary: a buck converter lowers the voltage.\n\nDuty cycle D = Uout / Uin' });
  const state = await ed(() => { const e = window.__app.active; const p = e.pages[1]; return { title: e.doc.nb.title, texts: e.pageData(p.id).texts.map((t) => t.text) }; });
  check('add_text: the notebook opens and has the text on page 2', !added.isError && state.texts.some((t) => t.startsWith('Summary: a buck converter')), JSON.stringify({ added, state }));
  const reread = await b.call('read_notebook', { notebook: 'Power electronics', from: 2, to: 2 });
  check('read_notebook (open notebook) sees the new text', reread.text.includes('Duty cycle D') && !reread.text.includes('## Page 1'), reread.text.slice(0, 300));

  const page = await b.call('add_page', { notebook: 'Power electronics', after: 3, title: 'Exam questions' });
  const pages = await ed(() => { const e = window.__app.active; const p = e.pages[3]; return { n: e.pages.length, bm: !!(p && p.bm), title: p && e.pageData(p.id).texts[0] && e.pageData(p.id).texts[0].text }; });
  check('add_page: new page 4 with a bookmarked title', !page.isError && pages.n === 4 && pages.bm && pages.title === 'Exam questions', JSON.stringify(pages));
  await b.call('bookmark_page', { notebook: 'Power electronics', page: 1 });
  check('bookmark_page sets the bookmark', await ed(() => !!window.__app.active.pages[0].bm));

  const bad1 = await b.call('read_notebook', { notebook: 'Thermodynamics' });
  const bad2 = await b.call('add_text', { notebook: 'Power electronics', page: 99, text: 'x' });
  const bad3 = await b.call('add_text', { notebook: 'Power electronics', page: 1 });
  check('errors come back as readable results', bad1.isError && /No notebook/.test(bad1.text) && bad2.isError && /does not exist/.test(bad2.text) && bad3.isError && /Missing: text/.test(bad3.text), JSON.stringify([bad1, bad2, bad3]));

  // undo in the app: page, bookmark title, text
  await ed(async () => { const e = window.__app.active; e.tools.clearSelection(true); for (let k = 0; k < 5; k++) e.undo(); }); // text; page, its title, its bookmark; bookmark of page 1
  await win.waitForTimeout(400);
  const undone = await ed(() => { const e = window.__app.active; return { n: e.pages.length, p2: e.pageData(e.pages[1].id).texts.length, bm1: !!e.pages[0].bm }; });
  check('Ctrl+Z in the app undoes what Claude did', undone.n === 3 && undone.p2 === 0 && !undone.bm1, JSON.stringify(undone));
  b.close();

  // ---- switched off: the pipe closes, a new bridge explains what to do ----
  await ed(() => window.__app.mcp.setEnabled(false));
  const b2 = bridge(cfg, { STUDYNOTES_MCP_PIPE: pipe, STUDYNOTES_MCP_NO_LAUNCH: '1', STUDYNOTES_MCP_WAIT: '800' });
  const off = await b2.send('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  check('off: the bridge answers with what to do', off.error && /switch on "Claude \(MCP\)"/.test(off.error.message), JSON.stringify(off));
  b2.close();
  check('off: remembered in the settings', await ed(() => window.__app.settings.mcp === false));

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
