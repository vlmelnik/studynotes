// Run after npm run build: node test/e2e/extensions/rich-paste.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { check, errors, finish } = require('../harness/report');
const { launch, root } = require('../harness/app');

const NAME = 'Formulas and formatting on paste';
const SOURCE = String.raw`\frac{400}{230}\approx 1{,}73=\sqrt{3}`;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-rich-paste-'));
  let app;
  try {
    const pdf = path.join(tmp, 'Slides.pdf');
    execFileSync(process.execPath, [path.join(root, 'scripts', 'make-test-pdf.js'), pdf, '1'], { stdio: 'ignore' });
    const session = await launch({ tmp });
    app = session.app;
    const { win, ed } = session;
    win.setDefaultTimeout(12000);
    // built in: always on, no switch
    await ed(() => window.__app.showSettings('addons'));
    const card = win.locator('.addon', { has: win.locator('.addon-title b', { hasText: NAME }) });
    check('Add-ons: built in and always on, no switch', await card.locator('.addon-always').count() === 1 && await card.getByRole('switch').count() === 0);
    await win.getByRole('button', { name: 'Done', exact: true }).click();
    const rel = await ed(async (f) => (await window.api.importFiles('', [f]))[0], pdf);
    await ed((r) => window.__app.openNotebook(r), rel);
    await win.waitForFunction(() => window.__app.active?.viewer?.views.size > 0);

    async function paste(text) {
      return ed(async (text) => {
        const e = window.__app.active;
        await e.pasteData({ text, html: '', files: [] });
        const page = e.pages[e.viewer.currentIndex];
        return e.pageData(page.id).texts.at(-1).id;
      }, text);
    }
    const box = (id) => win.locator(`.textbox[data-id="${id}"]`);
    const math = (id) => box(id).locator('[data-x="rich-paste:math"]');
    const id = await paste(`# Result\n- **Use the ratio**\n\\[${SOURCE}\\]`);
    const formula = math(id);
    await formula.locator('.katex-html').waitFor();
    check('paste displays KaTeX and formatted text, not visible TeX source',
      (await box(id).locator('b').allTextContents()).includes('Use the ratio')
      && !(await formula.locator('.katex-html').textContent()).includes('\\frac'));
    check('the display formula is centered on its own line', await formula.evaluate((el) => (
      getComputedStyle(el).display === 'block' && getComputedStyle(el).textAlign === 'center'
    )));

    const input = win.locator('.modal-body input');
    await win.getByRole('button', { name: 'Text (T)', exact: true }).click();
    await formula.dblclick();
    await input.waitFor();
    check('double-click shows the original formula for editing', await input.inputValue() === SOURCE);
    await input.fill('x^2');
    await input.press('Escape');
    check('Escape cancels editing', await formula.getAttribute('data-v') === SOURCE);
    await formula.dblclick();
    await input.fill('x^2');
    await input.press('Enter');
    await win.waitForFunction((id) => document.querySelector(`.textbox[data-id="${id}"] [data-x]`)?.dataset.v === 'x^2', id);
    check('Enter applies the new source', await formula.getAttribute('data-v') === 'x^2');
    await win.keyboard.press('Control+z');
    await win.waitForFunction(({ id, source }) => document.querySelector(`.textbox[data-id="${id}"] [data-x]`)?.dataset.v === source, { id, source: SOURCE });
    check('Ctrl+Z restores the previous formula', await formula.getAttribute('data-v') === SOURCE);

    const existing = await paste('Existing note');
    // Pasting onto the page selects the new box and switches to the Select tool.
    await win.getByRole('button', { name: 'Text (T)', exact: true }).click();
    await box(existing).evaluate((el) => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', ' $z_1$');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      el.blur();
    });
    await math(existing).locator('.katex-html').waitFor();
    check('pasting inside an existing box keeps its text and renders the new formula',
      (await box(existing).textContent()).startsWith('Existing note') && await math(existing).getAttribute('data-v') === 'z_1');

    await ed(() => window.__app.active.moreMenu(window.__app.active.moreBtn));
    await win.getByRole('menuitem', { name: 'Disable conversion on paste' }).click();
    const raw = await paste('Raw $y^2$.');
    check('automatic conversion can be disabled', await math(raw).count() === 0);
    await ed((id) => {
      const e = window.__app.active;
      const index = e.viewer.currentIndex;
      e.tools.select(index, e.pages[index].id, new Set(), new Set([id]), new Set());
    }, raw);
    await win.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'More', exact: true }).click();
    await win.getByRole('menuitem', { name: 'Render formulas and formatting' }).click();
    await math(raw).locator('.katex-html').waitFor();
    check('the text-box menu converts an existing box', await math(raw).getAttribute('data-v') === 'y^2');

  } finally {
    if (app) await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  finish(errors);
})().catch((e) => { console.error(e); process.exitCode = 2; });
