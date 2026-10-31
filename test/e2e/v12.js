// End-to-end checks for v1.2 through the real UI.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/v12.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, { recursive: true });
const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-v12-'));
  const libDir = path.join(tmp, 'Library');
  const driveDir = path.join(tmp, 'FakeDrive');
  const packaged = !!process.env.STUDYNOTES_EXE;
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: packaged ? ['--no-sandbox'] : [root, '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: libDir, STUDYNOTES_USERDATA: path.join(tmp, 'u'), STUDYNOTES_FAKE_DRIVE: driveDir },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await win.setViewportSize({ width: 1500, height: 940 });
  await win.waitForFunction(() => window.__app);
  const ed = (fn, arg) => win.evaluate(fn, arg);
  const pageData = () => ed(() => { const e = window.__app.active; return e.pageData(e.pages[0].id); });

  const rel = await ed(async () => {
    const r = await window.api.createNotebook('', { title: 'v12', paper: 'lined' });
    await window.__app.openNotebook(r);
    return r;
  });
  await win.waitForTimeout(500);
  const r0 = await ed(() => window.__app.active.viewer.pageClientRect(0));
  const z = await ed(() => window.__app.active.viewer.zoom);
  const toClient = (x, y) => [r0.left + x * z, r0.top + y * z];

  // ---------- options strip / zoom pill ----------
  const stripHidden = async (tool) => { await win.keyboard.press(tool); return ed(() => document.querySelector('.tool-options').classList.contains('empty')); };
  const penVisible = !(await stripHidden('p'));
  const selHidden = await stripHidden('v');
  check('options strip: shown for pen, hidden for the select tool (no hint line)', penVisible && selHidden && !(await ed(() => !!document.querySelector('.optionsbar'))));
  const pillBefore = await ed(() => document.querySelector('.zoom-pill').classList.contains('show'));
  const vb = await win.locator('.viewer').boundingBox();
  await win.mouse.move(vb.x + 600, vb.y + 400);
  await win.keyboard.down('Control'); await win.mouse.wheel(0, -100); await win.keyboard.up('Control');
  await win.waitForTimeout(400);
  const pillDuring = await ed(() => document.querySelector('.zoom-pill').classList.contains('show'));
  await win.waitForTimeout(2200);
  const pillAfter = await ed(() => document.querySelector('.zoom-pill').classList.contains('show'));
  check('zoom % appears bottom-right while zooming, then disappears', !pillBefore && pillDuring && !pillAfter);
  await win.keyboard.press('Control+0');
  await win.waitForTimeout(400);
  const z2 = await ed(() => window.__app.active.viewer.zoom);
  // Scroll so page point (x, y) is visible, then return its screen position.
  const at = async (x, y) => {
    await ed((yy) => { const v = window.__app.active.viewer; v.scrollToPage(0, yy); v.update(); }, y);
    await win.waitForTimeout(120);
    const r = await ed(() => window.__app.active.viewer.pageClientRect(0));
    return [r.left + x * z2, r.top + y * z2];
  };

  // ---------- picture behind ink → bring to front ----------
  await ed(async () => {
    const e = window.__app.active;
    const c = document.createElement('canvas'); c.width = 200; c.height = 120;
    const g = c.getContext('2d'); g.fillStyle = '#2b9de9'; g.fillRect(0, 0, 200, 120);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    await e.placeImages([{ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }], { index: 0, x: 200, y: 260 });
  });
  await win.keyboard.press('Escape');
  // since 1.6 new pictures start on top: put this one behind the ink (like older notes)
  await ed(() => { const e = window.__app.active; const d = e.pageData(e.pages[0].id); e.setPageData(e.pages[0].id, { ...d, items: d.items.map((it) => ({ ...it, lay: 'b', z: -1 })) }); });
  const img = (await pageData()).items[0];
  // a pen stroke across the picture
  await win.keyboard.press('p');
  const [sx, sy] = await at(img.x - 20, img.y + img.h / 2);
  const [ex, ey] = await at(img.x + img.w + 20, img.y + img.h / 2);
  await win.mouse.move(sx, sy); await win.mouse.down(); await win.mouse.move(ex, ey, { steps: 10 }); await win.mouse.up();
  const layerOfImg = () => ed((id) => { const el = document.querySelector(`.item[data-id="${id}"]`); return el && el.parentElement.classList.contains('page-texts') ? 'front' : 'back'; }, img.id);
  const before = await layerOfImg();
  await win.keyboard.press('v');
  const [cx, cy] = await at(img.x + 10, img.y + 10);
  await win.mouse.click(cx, cy);
  await win.waitForTimeout(200);
  await win.click('.sel-toolbar button[title="Bring to front"]');
  await win.waitForTimeout(300);
  const afterFront = await layerOfImg();
  const hitMid = await ed(([x, y]) => window.__app.active.tools.objectAt(window.__app.active.pages[0].id, x, y), [img.x + img.w / 2, img.y + img.h / 2]);
  check('bring to front: picture moves above the ink and is clicked first', before === 'back' && afterFront === 'front' && hitMid && hitMid.kind === 'item', `${before} → ${afterFront}, hit ${hitMid && hitMid.kind}`);
  await win.screenshot({ path: path.join(out, 'v12-01-front.png') });
  await win.keyboard.press('Escape');

  // ---------- text box: send behind the picture ----------
  await win.keyboard.press('t');
  const [tx, ty] = await at(img.x + 20, img.y + 40);
  await win.mouse.click(tx, ty);
  await win.keyboard.type('Hinter dem Bild');
  await win.keyboard.press('Escape');
  await win.keyboard.press('v');
  let d = await pageData();
  const tb = d.texts.find((t) => t.text === 'Hinter dem Bild');
  // The picture is in front now, so select the text with a rubber band around it.
  await ed(([pid, id]) => { const e = window.__app.active; e.tools.select(0, pid, new Set(), new Set([id]), new Set()); }, [d.texts.length && (await ed(() => window.__app.active.pages[0].id)), tb.id]);
  await win.waitForTimeout(200);
  const barShown = await ed(() => document.querySelector('.text-bar').classList.contains('show'));
  check('selected text box shows the dark text bar (not the generic toolbar)', barShown && await ed(() => document.querySelector('.sel-toolbar').classList.contains('hidden')));
  await win.click('.text-bar button[title="More"]');
  await win.click('.menu-item:has-text("Send to back")');
  await win.waitForTimeout(300);
  const textLayer = await ed((id) => document.querySelector(`.textbox-wrap[data-id="${id}"]`).parentElement.className, tb.id);
  const order = await ed(() => [...document.querySelector('.page-items').children].map((el) => el.dataset.id));
  check('text box can be sent behind ink and pictures', /page-items/.test(textLayer) && order[0] === tb.id, `layer ${textLayer}, back order ${order.join(',')}`);
  await win.click('.text-bar button[title="More"]');
  await win.click('.menu-item:has-text("Bring to front")');
  await win.waitForTimeout(300);
  const frontOrder = await ed(() => [...document.querySelector('.page-texts').children].map((el) => el.dataset.id));
  check('text box can be brought in front of the picture', frontOrder[frontOrder.length - 1] === tb.id, frontOrder.join(','));
  await win.keyboard.press('Escape');

  // ---------- whole box: custom size, font, colour via the text bar ----------
  await win.keyboard.press('t');
  const [nx, ny] = await at(80, 470);
  await win.mouse.click(nx, ny);
  await win.keyboard.type('Ganze Zeile und Teil');
  await win.waitForTimeout(200);
  const barWhileEditing = await ed(() => document.querySelector('.text-bar').classList.contains('show'));
  // custom size 37 for the whole box (nothing selected)
  await win.fill('.text-bar .tb-size', '37');
  await win.press('.text-bar .tb-size', 'Enter');
  await win.waitForTimeout(200);
  d = await pageData();
  let box = d.texts.find((t) => t.text.startsWith('Ganze'));
  check('text bar appears while typing; custom size 37 applies to the whole box', barWhileEditing && box && box.fs === 37, box && `fs=${box.fs}`);

  // ---------- only selected words: colour, size and font ----------
  await ed((id) => {
    const el = document.querySelector(`.textbox[data-id="${id}"]`);
    el.focus();
    const tn = el.firstChild;
    const i = tn.nodeValue.indexOf('Teil');
    const rg = document.createRange(); rg.setStart(tn, i); rg.setEnd(tn, i + 4);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(rg);
  }, box.id);
  await ed(() => window.__app.active.applyTextStyle({ color: '#d62828' }));
  await ed(() => window.__app.active.applyTextStyle({ size: 22 }));
  await ed(() => window.__app.active.applyTextStyle({ ff: 'serif' }));
  await win.waitForTimeout(150);
  d = await pageData();
  box = d.texts.find((t) => t.text.startsWith('Ganze'));
  const spanOk = box.html && /<span[^>]*data-fs="22"[^>]*>|<span[^>]*data-c="#d62828"/.test(box.html) && /data-ff="serif"/.test(box.html) && /data-c="#d62828"/.test(box.html);
  const restPlain = box.html && box.html.split('<span')[0].includes('Ganze Zeile und');
  check('size, font and colour change only the selected word', spanOk && restPlain && box.fs === 37, box.html);
  const domColor = await ed((id) => {
    const sp = [...document.querySelectorAll(`.textbox[data-id="${id}"] span`)].find((s) => s.textContent === 'Teil');
    return sp ? getComputedStyle(sp).color + ' ' + getComputedStyle(sp).fontSize : null;
  }, box.id);
  check('styled word looks right on screen', domColor === 'rgb(214, 40, 40) 22px', domColor);

  // bold only on "Ganze"
  await ed((id) => {
    const el = document.querySelector(`.textbox[data-id="${id}"]`);
    el.focus();
    const tn = el.firstChild;
    const rg = document.createRange(); rg.setStart(tn, 0); rg.setEnd(tn, 5);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(rg);
  }, box.id);
  await win.click('.text-bar button[title="Bold (Ctrl+B)"]');
  await win.waitForTimeout(150);
  // alignment, bullets, box style for the whole box (collapse selection first)
  await ed((id) => { const el = document.querySelector(`.textbox[data-id="${id}"]`); const s = window.getSelection(); s.collapse(el, 0); }, box.id);
  await win.click('.text-bar button[title^="Alignment"]');
  await win.click('.text-bar button[title="Text box style"]');
  await win.waitForTimeout(150);
  await win.locator('.box-menu .box-swatch').last().click(); // bordered preset
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(out, 'v12-02-textbar.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  d = await pageData();
  box = d.texts.find((t) => t.text.startsWith('Ganze'));
  check('bold on part of the text, centre alignment and box border on the whole box', /<b>Ganze<\/b>/.test(box.html || '') && box.al === 'center' && box.bc === '#1c1c1e', JSON.stringify({ al: box.al, bc: box.bc }));

  // undo restores
  const undoDepth = await ed(() => window.__app.active.undoStack.length);
  check('text styling is undoable', undoDepth > 0);

  // whole box via selection: size + colour strip per-word values
  await win.keyboard.press('v');
  await ed(([id]) => { const e = window.__app.active; e.tools.select(0, e.pages[0].id, new Set(), new Set([id]), new Set()); }, [box.id]);
  await win.waitForTimeout(150);
  await win.fill('.text-bar .tb-size', '18');
  await win.press('.text-bar .tb-size', 'Enter');
  await win.waitForTimeout(200);
  d = await pageData();
  const box2 = d.texts.find((t) => t.id === box.id);
  check('selected box: size 18 applies to everything (per-word sizes removed)', box2.fs === 18 && !/data-fs/.test(box2.html || ''), box2.html);
  await win.keyboard.press('Escape');

  // ---------- export keeps per-word styles ----------
  await ed(() => window.__app.active.flush());
  const pdf = path.join(tmp, 'v12.pdf');
  await ed(([a, b]) => window.api.exportTo(a, null, b), [rel, pdf]);
  const txt = execFileSync('pdftotext', [pdf, '-']).toString();
  const fonts = execFileSync('pdffonts', [pdf]).toString();
  check('export contains the styled text with the serif font', /Teil/.test(txt) && /Hinter dem Bild/.test(txt) && /Serif/i.test(fonts), fonts.split('\n').slice(2).map((l) => l.split(/\s+/)[0]).join(' '));
  execFileSync('pdftoppm', ['-r', '60', '-png', '-f', '1', '-l', '1', pdf, path.join(out, 'v12-03-export')]);

  // ---------- laser pointer ----------
  await win.keyboard.press('k');
  const strokesBefore = (await pageData()).strokes.length;
  const [lx, ly] = await at(100, 200);
  await win.mouse.move(lx, ly); await win.mouse.down();
  for (let i = 0; i < 20; i++) await win.mouse.move(lx + i * 12, ly + Math.sin(i / 3) * 20);
  const litDuring = await ed(() => {
    const c = document.querySelector('.laser-canvas');
    const d2 = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d2.length; i += 4) if (d2[i] > 40) n++;
    return n;
  });
  await win.mouse.up();
  await win.mouse.move(lx, ly - 300); // dot moves away
  await win.waitForTimeout(1400);
  const litAfter = await ed(() => {
    const c = document.querySelector('.laser-canvas');
    const d2 = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d2.length; i += 4) if (d2[i] > 40) n++;
    return n;
  });
  const strokesAfter = (await pageData()).strokes.length;
  check('laser pointer draws a glowing trail that fades and is not saved', litDuring > 500 && litAfter < litDuring / 5 && strokesAfter === strokesBefore, `${litDuring} → ${litAfter} lit px`);

  // ---------- dark mode ----------
  await win.keyboard.press('p');
  await ed(() => window.__app.setTheme('dark'));
  await win.waitForTimeout(300);
  const dark = await ed(() => ({
    theme: document.documentElement.dataset.theme,
    desk: getComputedStyle(document.querySelector('.viewer')).backgroundColor,
    page: getComputedStyle(document.querySelector('.page')).backgroundColor,
  }));
  check('dark mode: interface dark, pages keep their paper colour (cream)', dark.theme === 'dark' && dark.desk !== 'rgb(230, 227, 221)' && dark.page === 'rgb(250, 246, 232)', JSON.stringify(dark));
  await win.screenshot({ path: path.join(out, 'v12-04-dark.png') });
  const saved = await ed(() => window.api.info().then((i) => i.settings.theme));
  check('dark mode is remembered', saved === 'dark');

  // ---------- Google Drive sync (simulated Drive) ----------
  if (!packaged) {
    // An open notebook is saved and uploaded (v1.3: upload-only while open).
    const sOpen = await ed(() => window.__app.syncAll({ quiet: true }).then(() => null));
    await win.waitForTimeout(200);
    await ed(() => window.__app.closeEditor(window.__app.active));
    const s1 = await ed(() => window.api.cloudSync());
    const idx0 = Object.values(JSON.parse(fs.readFileSync(path.join(driveDir, 'index.json'), 'utf8')));
    const remoteFiles = idx0.filter((f) => !f.role).map((f) => f.path);
    check('Drive sync uploads the library (incl. pictures), also while the notebook is open', sOpen === null && s1 && remoteFiles.some((p) => p.endsWith('notebook.json')) && remoteFiles.some((p) => /assets\//.test(p)), `${remoteFiles.length} files`);
    check('Drive gets a PDF and a .studynotes backup of the notebook', idx0.some((f) => f.role === 'pdf' && f.path === rel + '.pdf') && idx0.some((f) => f.role === 'backups' && f.path.startsWith(rel + ' ') && f.path.endsWith('.studynotes')), idx0.filter((f) => f.role).map((f) => f.role + ':' + f.path).join(', '));
    const s2 = await ed(() => window.api.cloudSync());
    check('second sync with no changes transfers nothing', s2 && s2.uploaded === 0 && s2.downloaded === 0, JSON.stringify(s2 && { u: s2.uploaded, d: s2.downloaded }));
    // A change made "on another PC": edit the Drive copy of the notebook.
    const idx = JSON.parse(fs.readFileSync(path.join(driveDir, 'index.json'), 'utf8'));
    const [fid, meta] = Object.entries(idx).find(([, f]) => f.path === `${rel}/notebook.json`);
    const nbj = JSON.parse(fs.readFileSync(path.join(driveDir, fid), 'utf8'));
    nbj.title = 'Edited on laptop';
    const buf = Buffer.from(JSON.stringify(nbj));
    fs.writeFileSync(path.join(driveDir, fid), buf);
    idx[fid] = { ...meta, md5: require('crypto').createHash('md5').update(buf).digest('hex'), size: buf.length };
    fs.writeFileSync(path.join(driveDir, 'index.json'), JSON.stringify(idx));
    const s3 = await ed(() => window.api.cloudSync());
    const local = JSON.parse(fs.readFileSync(path.join(libDir, rel, 'notebook.json'), 'utf8'));
    check('a change made on another device is downloaded', s3 && s3.downloaded === 1 && local.title === 'Edited on laptop', `downloaded ${s3 && s3.downloaded}`);
    await win.waitForTimeout(300);
    const lib = await ed(() => ({ state: document.querySelector('.cloud-btn') && document.querySelector('.cloud-btn').dataset.state, titles: [...document.querySelectorAll('.nb-card .card-title')].map((e) => e.textContent) }));
    check('library shows the Drive status and the downloaded change', lib.state === 'idle' && lib.titles.includes('Edited on laptop'), JSON.stringify(lib));
    await win.screenshot({ path: path.join(out, 'v12-05-library-dark.png') });
  }

  await app.close();
  const realErrors = errors.filter((e) => !/Autofill|DevTools/.test(e));
  check('no console / page errors', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
