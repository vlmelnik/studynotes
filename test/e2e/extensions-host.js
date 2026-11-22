// The extension host (docs/EXTENSIONS.md): a test extension is added at run
// time and goes through everything the host offers – paste transform, inline
// element (render, fallback text, edit, undo, export picture), text box menu,
// page pass, ink filter, settings – then it is switched off, and a broken
// extension must not take the app down.
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/extensions-host.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { check, errors, finish } = require('./harness/report');
const { launch, root } = require('./harness/app');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-ext-'));
  const pdf = path.join(tmp, 'Slides.pdf');
  execFileSync('node', [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '2'], { stdio: 'ignore' });
  const { app, win, ed } = await launch({ tmp });
  await win.waitForFunction(() => window.__app && document.querySelector('.library'));
  const rel = await ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf);
  await ed((r) => window.__app.openNotebook(r), rel);
  await win.waitForTimeout(800);

  // ---- a test extension, defined in the page ----
  const added = await ed(() => {
    const seen = window.__extSeen = { passes: 0, regions: null, ink: 0, settings: null };
    return window.__app.extensions.add({
      id: 'e2e', name: 'E2E test', description: 'test only', apiVersion: 1,
      activate(host) {
        host.paste.addTransform(({ text }) => (/^E2E: /.test(text) ? { html: 'before ' + host.inline.html('e2e:box', text.slice(5)) + ' after' } : null));
        host.inline.register('e2e:box', {
          render(el, v) { el.textContent = '[' + v + ']'; el.classList.add('e2e-box'); },
          toText: (v) => '{{' + v + '}}',
          toHtml: (v) => '<b>' + v + '</b>',
          edit: async (v) => v + '!',
          async exportImage(v, { fontSize }) {
            const c = document.createElement('canvas'); c.width = 80; c.height = 40;
            const g = c.getContext('2d'); g.fillStyle = '#d62828'; g.fillRect(0, 0, 80, 40);
            const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
            return { png: new Uint8Array(await blob.arrayBuffer()), width: fontSize * 2, height: fontSize, baseline: fontSize * 0.8 };
          },
        });
        host.menus.add('textbox-more', { id: 'conv', label: 'E2E convert', when: (ctx) => !ctx.textbox.html.includes('data-x'), run: (ctx) => ctx.textbox.setHtml(host.inline.html('e2e:box', ctx.textbox.text)) });
        host.view.addPagePass(({ canvas, imageRegions }) => { seen.passes++; seen.regions = imageRegions; canvas.getContext('2d').fillStyle = '#000'; });
        host.view.setInkFilter((c) => { seen.ink++; return c === '#000000' ? '#ffffff' : c; });
        host.view.setClass('on', true);
        host.settings.set('count', (host.settings.get('count', 0) || 0) + 1);
        seen.settings = host.settings.get('count');
      },
    }, { enabled: true });
  });
  check('a valid extension is added and started', added === true);
  const listed = await ed(() => window.__app.extensions.list().find((x) => x.id === 'e2e'));
  check('it is listed as on', listed && listed.enabled && !listed.error, JSON.stringify(listed));

  // ---- paste ----
  await ed(() => window.__app.active.pasteData({ text: 'E2E: alpha', html: '', files: [] }));
  await win.waitForTimeout(400);
  const pasted = await ed(() => {
    const e = window.__app.active;
    const pg = e.pages[e.viewer.currentIndex];
    const t = e.pageData(pg.id).texts.at(-1);
    const sp = document.querySelector(`.textbox[data-id="${t.id}"] span[data-x="e2e:box"]`);
    return { html: t.html, text: t.text, shown: sp && sp.textContent, rendered: sp && sp.dataset.rendered, editable: sp && sp.contentEditable, id: t.id, pageId: pg.id };
  });
  check('paste: the transform makes an inline element', /data-x="e2e:box" data-v="alpha"/.test(pasted.html || ''), JSON.stringify(pasted));
  check('paste: the stored fallback text comes from toText', pasted.text === 'before {{alpha}} after' && (pasted.html || '').includes('>{{alpha}}</span>'), pasted.text);
  check('paste: shown by render(), as one non-editable piece', pasted.shown === '[alpha]' && pasted.rendered === '1' && pasted.editable === 'false', JSON.stringify(pasted));

  // ---- edit with a double-click, undo ----
  await ed((id) => document.querySelector(`.textbox[data-id="${id}"] span[data-x]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), pasted.id);
  await win.waitForTimeout(300);
  const edited = await ed(([pid, id]) => window.__app.active.pageData(pid).texts.find((t) => t.id === id), [pasted.pageId, pasted.id]);
  check('double-click edits the value (one undo step)', /data-v="alpha!"/.test(edited.html) && edited.text.includes('{{alpha!}}'), edited.html);
  await ed(() => window.__app.active.undo());
  await win.waitForTimeout(300);
  const undone = await ed(([pid, id]) => ({ t: window.__app.active.pageData(pid).texts.find((t) => t.id === id), shown: document.querySelector(`.textbox[data-id="${id}"] span[data-x]`)?.textContent }), [pasted.pageId, pasted.id]);
  check('undo restores the old value on screen and in the data', /data-v="alpha"/.test(undone.t.html) && undone.shown === '[alpha]', JSON.stringify(undone));

  // ---- text box menu ----
  await ed(() => window.__app.active.pasteData({ text: 'beta', html: '', files: [] }));
  await win.waitForTimeout(300);
  const menu = await ed(() => {
    const e = window.__app.active;
    const pg = e.pages[e.viewer.currentIndex];
    const t = e.pageData(pg.id).texts.at(-1);
    e.textBar.target = { pageId: pg.id, ids: [t.id], editing: false };
    const items = e.textBar.extensionItems().filter((x) => x !== 'sep');
    const item = items.find((x) => x.label === 'E2E convert');
    if (item) item.onClick();
    const after = e.pageData(pg.id).texts.find((x) => x.id === t.id);
    return { labels: items.map((x) => x.label), html: after.html, text: after.text };
  });
  check('textbox-more: the item is offered and its action converts the box', menu.labels.includes('E2E convert') && /data-v="beta"/.test(menu.html || '') && menu.text === '{{beta}}', JSON.stringify(menu));

  // ---- page pass, ink filter, class ----
  await ed(() => {
    const e = window.__app.active;
    const pg = e.pages[e.viewer.currentIndex];
    e.setPageData(pg.id, { ...e.pageData(pg.id), strokes: [{ id: 's1', t: 'pen', c: '#000000', s: 3, p: [100, 100, 0.5, 300, 140, 0.5] }] });
  });
  await win.waitForTimeout(1200);
  const view = await ed(() => {
    const e = window.__app.active;
    const pg = e.pages[e.viewer.currentIndex];
    return { ...window.__extSeen, stored: e.pageData(pg.id).strokes[0].c, cls: e.el.classList.contains('ext-e2e-on') };
  });
  check('page pass runs on rendered PDF pages, with image regions', view.passes > 0 && Array.isArray(view.regions), JSON.stringify(view));
  check('ink filter is used for drawing, the stored colour stays', view.ink > 0 && view.stored === '#000000', JSON.stringify(view));
  check('setClass puts ext-<id>-<name> on the editor', view.cls);
  check('settings are kept per extension', view.settings === 1);

  // ---- export with the inline picture ----
  const out = path.join(tmp, 'out.pdf');
  await ed(async ([r, f]) => { const imgs = await window.__app.active.inlineImages(null); await window.__app.active.flush(); await window.api.exportTo(r, null, f, imgs); }, [rel, out]);
  const txt = execFileSync('pdftotext', [out, '-']).toString();
  const imgs = execFileSync('pdfimages', ['-list', out]).toString().trim().split('\n').slice(2);
  check('export: the inline element is a picture, not its fallback text', !txt.includes('{{alpha') && txt.includes('before') && imgs.length >= 2, JSON.stringify({ txt: txt.slice(0, 120), imgs: imgs.length }));
  const plainOut = path.join(tmp, 'plain.pdf');
  await ed(async ([r, f]) => window.api.exportTo(r, null, f), [rel, plainOut]);
  check('export without pictures falls back to the text', execFileSync('pdftotext', [plainOut, '-']).toString().includes('{{alpha}}'));

  // ---- switch off ----
  const passesBefore = await ed(() => window.__extSeen.passes);
  await ed(() => window.__app.extensions.setEnabled('e2e', false));
  await win.waitForTimeout(1200);
  const off = await ed(([id]) => {
    const e = window.__app.active;
    const sp = document.querySelector(`.textbox[data-id="${id}"] span[data-x]`);
    e.textBar.target = { pageId: e.pages[e.viewer.currentIndex].id, ids: [id], editing: false };
    return { shown: sp && sp.textContent, rendered: sp && sp.dataset.rendered, items: e.textBar.extensionItems().length, cls: e.el.classList.contains('ext-e2e-on'), passes: window.__extSeen.passes, saved: window.__app.settings.extensions.enabled.e2e };
  }, [pasted.id]);
  check('off: the box shows the fallback text', off.shown === '{{alpha}}' && !off.rendered, JSON.stringify(off));
  check('off: no menu item, no class, no more page passes', off.items === 0 && !off.cls && off.passes === passesBefore, JSON.stringify(off));
  check('off: remembered in the settings', off.saved === false);

  // ---- a broken extension ----
  const broken = await ed(() => {
    window.__app.extensions.add({ id: 'broken', name: 'Broken', apiVersion: 1, activate() { throw new Error('boom'); } }, { enabled: true });
    const bad = window.__app.extensions.add({ id: 'Bad Id', apiVersion: 1, activate() {} }, { enabled: true });
    return { x: window.__app.extensions.list().find((x) => x.id === 'broken'), bad };
  });
  check('a failing activate() switches the extension off with its error', broken.x && !broken.x.enabled && broken.x.error === 'boom', JSON.stringify(broken));
  check('an invalid extension is refused', broken.bad === false);
  await ed(() => window.__app.active.pasteData({ text: 'still works', html: '', files: [] }));
  await win.waitForTimeout(300);
  check('the app keeps working', await ed(() => window.__app.active.pageData(window.__app.active.pages[window.__app.active.viewer.currentIndex].id).texts.some((t) => t.text === 'still works')));

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
