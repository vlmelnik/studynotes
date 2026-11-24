// npm run build, then node test/e2e/extensions/dark-view.js (Poppler on PATH)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { PDFDocument, StandardFonts, rgb, concatTransformationMatrix, drawObject } = require('pdf-lib');
const { PNG } = require('pdf-lib/cjs/utils/png');
const { check, errors, finish } = require('../harness/report');
const { launch } = require('../harness/app');

const PAPER = [18, 28];
const PICTURE = [300, 400];
const PEN = [220, 480];

async function fixture(ed, name, scan = false) {
  const png = await ed((colour) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = colour;
    g.fillRect(0, 0, 32, 32);
    return c.toDataURL('image/png');
  }, scan ? '#ffffff' : '#186ba8');
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  if (scan) page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 600, height: 800 });
  else {
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText('Dark view fixture', { font, x: 120, y: 610, size: 32 });
    page.drawRectangle({ x: 123, y: 566, width: 100, height: 8, color: rgb(0, 0, 0) });
    // A real PDF.js form operator supplies a typed transform for this photo.
    const photo = await doc.embedPng(png);
    const form = doc.context.formXObject([concatTransformationMatrix(45, 0, 0, 40, 0, 0), drawObject('Photo')], {
      BBox: [0, 0, 45, 40], Matrix: [2, 0, 0, 2, 255, 360], Resources: { XObject: { Photo: photo.ref } },
    });
    page.pushOperators(drawObject(page.node.newXObject('PhotoForm', doc.context.register(form))));
  }
  fs.writeFileSync(name, await doc.save());
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-dark-'));
  let app;
  try {
    const session = await launch({ tmp });
    app = session.app;
    const { win, ed } = session;
    win.setDefaultTimeout(15000);
    const name = path.join(tmp, 'Slides.pdf');
    await fixture(ed, name);
    const as = path.join(tmp, 'Other slides.pdf');
    fs.copyFileSync(name, as);
    const [a, b] = await ed((files) => window.api.importFiles('', files), [name, as]);

    async function open(rel) {
      await ed((r) => window.__app.openNotebook(r), rel);
      await win.waitForFunction((r) => window.__app.active?.rel === r && window.__app.active.viewer.view(0)?.bgScale > 0, rel);
    }
    async function setting(on) {
      await ed(() => window.__app.showSettings());
      await win.getByRole('button', { name: 'Add-ons', exact: true }).click();
      const toggle = win.getByRole('switch', { name: 'Dark pages', exact: true });
      check(`the add-on starts ${on ? 'off by default' : 'enabled'}`, (await toggle.isChecked()) !== on);
      await toggle.press('Space');
      check(`Settings turns the add-on ${on ? 'on' : 'off'}`, (await toggle.isChecked()) === on);
      await win.getByRole('button', { name: 'Done', exact: true }).click();
    }
    // "Dark pages" is one switch in the More menu (on = full). "Background only"
    // is no menu entry any more; older notebooks can still carry it.
    async function choose(mode) {
      const want = { Full: 'full', Off: 'off', 'Background only': 'background' }[mode];
      if (want === 'background') {
        await ed(() => { const e = window.__app.active; ((e.doc.nb.ext ||= {})['dark-view'] ||= {}).mode = 'background'; window.__app.extensions.refreshView(e); });
      } else {
        const now = await ed(() => window.__app.active.doc.nb.ext?.['dark-view']?.mode || 'off');
        if ((now === 'off') === (want === 'off')) return;
        await win.locator('.editor').getByRole('button', { name: 'More', exact: true }).click();
        await win.getByRole('menuitem', { name: 'Dark pages', exact: true }).click();
      }
      await win.waitForFunction(() => window.__app.active.viewer.view(0)?.bgScale > 0);
    }
    function sample([kind, point]) {
      const v = window.__app.active.viewer.view(0);
      const layer = kind === 'tile' ? v.tile : kind === 'ink'
        ? { canvas: v.inkCanvas, rect: v.ink.rect, scale: v.ink.scale }
        : { canvas: v.bgHost.firstChild, rect: [0, 0, v.page.w, v.page.h], scale: v.bgScale };
      if (!layer?.canvas?.width || !layer.rect) return null;
      const x = Math.floor((point[0] - layer.rect[0]) * layer.scale), y = Math.floor((point[1] - layer.rect[1]) * layer.scale);
      if (x < 0 || y < 0 || x >= layer.canvas.width || y >= layer.canvas.height) return null;
      return [...layer.canvas.getContext('2d').getImageData(x, y, 1, 1).data];
    }
    const pixels = (kind, point) => ed(sample, [kind, point]);
    const mode = () => ed(() => window.__app.active.doc.nb.ext?.['dark-view']?.mode);
    const blend = () => ed(() => getComputedStyle(window.__app.active.viewer.view(0).hlCanvas).mixBlendMode);
    const exportTo = async (name) => {
      const file = path.join(tmp, name);
      assert(await ed(async (f) => {
        const e = window.__app.active;
        await e.flush();
        await window.api.exportTo(e.rel, null, f);
        return true;
      }, file));
      return file;
    };
    async function rawPng(scale) {
      return ed(async (s) => {
        const pdf = window.__app.active.pdfFor('main');
        const c = await pdf.render(1, s).promise;
        return c.toDataURL();
      }, scale);
    }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    await open(a);
    const pageId = await ed(() => {
      const e = window.__app.active;
      const id = e.pages[0].id;
      e.setPageData(id, { ...e.pageData(id), strokes: [
        { id: 'pen', t: 'pen', c: '#000000', s: 12, p: [140, 480, .5, 315, 480, .5] },
        { id: 'hl', t: 'hl', c: '#ffcc00', s: 18, p: [140, 530, .5, 315, 530, .5] },
      ] });
      return id;
    });
    const sourcePath = path.join(tmp, 'Library', a, 'source.pdf');
    const coverPath = path.join(tmp, 'Library', a, 'cover.png');
    await ed(async () => {
      const app = window.__app;
      await app.makeCover(app.active.rel, app.active.pdfFor('main'));
    });
    const beforeCover = fs.readFileSync(coverPath);
    const brightPicture = await pixels('page', PICTURE);
    const ocrScale = 2200 / 600; // scale used for OCR on this fixture
    const beforeOcrInput = await rawPng(ocrScale);
    const beforeBoardRaster = await rawPng(2);
    const before = await exportTo('Before.pdf');
    check('the original fixture renders white with black pen and a coloured photo',
      same(await pixels('page', PAPER), [255,255,255,255]) && (await pixels('ink', PEN))?.[0] === 0
      && same(brightPicture, [24,107,168,255]));

    await setting(true);
    await choose('Full');
    check('Full mode darkens PDF paper and lightens the black PDF content',
      same(await pixels('page', PAPER), [31,31,31,255]) && same(await pixels('page', [150,230]), [224,224,224,255]));
    check('black pen appears light and the highlighter switches to screen blending',
      (await pixels('ink', PEN))?.[0] === 224 && await blend() === 'screen');
    check('embedded picture pixels remain unchanged', same(brightPicture, await pixels('page', PICTURE)));

    const after = await exportTo('After.pdf');
    const stored = await ed(async ([rel, id]) => (await window.api.readPages(rel, [id]))[id], [a, pageId]);
    check('pen and highlighter still have their original colours on disk',
      same(stored?.strokes.map((st) => st.c), ['#000000', '#ffcc00']));
    check('source PDF bytes are unchanged', fs.readFileSync(sourcePath).equals(fs.readFileSync(name)));
    const raster = (f) => execFileSync('pdftoppm', ['-singlefile', '-r', '96', f], { maxBuffer: 8 * 1024 * 1024 });
    const text = (f) => execFileSync('pdftotext', [f, '-']);
    check('export renders identical pixels and text when Dark View is on', raster(before).equals(raster(after)) && text(before).equals(text(after)));
    check('the PDF raster used as OCR input stays byte-for-byte unchanged', await rawPng(ocrScale) === beforeOcrInput);
    await ed(async () => {
      const app = window.__app;
      await app.makeCover(app.active.rel, app.active.pdfFor('main'));
    });
    check('regenerating a saved library cover produces identical bytes', fs.readFileSync(coverPath).equals(beforeCover));

    const livePoints = await ed(() => {
      const e = window.__app.active;
      e.setTool('pen');
      e.toolState.pen.color = '#000000';
      e.toolState.pen.size = 12;
      const r = e.viewer.pageClientRect(0);
      return [160, 250].map((x) => [r.left + x * e.viewer.zoom, r.top + 100 * e.viewer.zoom]);
    });
    await win.mouse.move(...livePoints[0]);
    await win.mouse.down();
    await win.mouse.move(...livePoints[1], { steps: 8 });
    await win.waitForFunction(() => {
      const live = window.__app.active.tools.cur?.live;
      if (!live) return false;
      const x = Math.round((200 - live.rect[0]) * live.scale);
      const y = Math.round((100 - live.rect[1]) * live.scale);
      return live.ctx.getImageData(x, y, 1, 1).data[3] > 0;
    });
    check('the live pen preview draws the same light colour as a saved black stroke', await ed(() => {
      const { ctx, rect, scale } = window.__app.active.tools.cur.live;
      return ctx.getImageData(Math.round((200 - rect[0]) * scale), Math.round((100 - rect[1]) * scale), 1, 1).data[0] === 224;
    }));
    await win.mouse.up();
    check('finishing the pen stroke does not store its display colour', await ed(() => {
      const e = window.__app.active;
      const strokes = e.pageData(e.pages[0].id).strokes;
      return strokes.length === 3 && strokes[2].c === '#000000';
    }));
    check('mixed selections keep the highlighter blend separate from pen', await ed(() => {
      const e = window.__app.active;
      e.tools.select(0, e.pages[0].id, new Set(['pen', 'hl']), new Set());
      const layers = [...e.viewer.view(0).overlay.querySelectorAll('.sel-canvas')];
      const blends = layers.map((c) => getComputedStyle(c).mixBlendMode).sort();
      e.tools.clearSelection();
      return blends.join(',') === 'normal,screen';
    }));

    await open(b);
    check('the other open notebook keeps the light view', await mode() === undefined && (await pixels('page', PAPER))?.[0] === 255 && await blend() === 'multiply');
    await choose('Background only');
    check('Background only darkens white while leaving the black PDF content unchanged',
      (await pixels('page', PAPER))?.[0] === 30 && (await pixels('page', [150,230]))?.[0] === 0);
    await choose('Off');
    check('Off restores the light page and multiply blending', (await pixels('page', PAPER))?.[0] === 255 && await blend() === 'multiply');
    await open(a);
    await ed(() => window.__app.closeEditor(window.__app.active));
    await open(a);
    check('Full mode persists across closing and reopening the notebook', await mode() === 'full' && (await pixels('page', PAPER))?.[0] === 31);

    await ed(() => {
      const e = window.__app.active;
      e.appendPage();
      e.viewer.scrollToPage(1);
    });
    await win.waitForFunction(() => window.__app.active.viewer.view(1)?.paperCanvas.width > 0);
    check('paper next to a dark PDF keeps its original ink and highlighter blend', await ed(() => {
      const view = window.__app.active.viewer.view(1);
      return view.page.kind === 'paper' && view.inkColor('#000000') === '#000000' && getComputedStyle(view.hlCanvas).mixBlendMode === 'multiply';
    }));
    await ed(() => window.__app.active.viewer.scrollToPage(0));

    await ed(() => window.__app.active.rotatePage(0, 1));
    await win.waitForFunction(() => {
      const v = window.__app.active.viewer.view(0);
      return v?.page.rot === 90 && v.bgScale > 0;
    });
    const centre = [400, 300]; // the PDF fixture centre after the 90° clockwise turn
    check('the rotated page still preserves photo pixels', same(brightPicture, await pixels('page', centre)));
    await ed(([x, y]) => {
      const v = window.__app.active.viewer;
      v.setZoom(8);
      const page = v.layout[0];
      v.scroller.scrollLeft = page.x + x * v.zoom - v.scroller.clientWidth / 2;
      v.scroller.scrollTop = page.y + y * v.zoom - v.scroller.clientHeight / 2;
      v.scheduleUpdate();
    }, centre);
    await win.waitForFunction(([x, y]) => {
      const t = window.__app.active.viewer.view(0)?.tile;
      return t && x >= t.rect[0] && x < t.rect[2] && y >= t.rect[1] && y < t.rect[3];
    }, centre);
    check('the zoom tile preserves the picture and still darkens the surrounding paper',
      same(brightPicture, await pixels('tile', centre)) && (await pixels('tile', [454,300]))?.[0] === 31);

    const boardAsset = await ed(async (rel) => {
      const app = window.__app;
      const viewPdf = app.active.pdfFor('main');
      const boardRel = await window.api.createNotebook('', { title: 'Board', kind: 'board' });
      const board = await app.openNotebook(boardRel);
      await board.placePdfOnBoard(await viewPdf.constructor.open(rel), [1]);
      return `${boardRel}/${board.pageData(board.pages[0].id).items[0].src}`;
    }, a);
    const expectedAsset = PNG.load(Buffer.from(beforeBoardRaster.split(',')[1], 'base64'));
    const actualAsset = PNG.load(fs.readFileSync(path.join(tmp, 'Library', boardAsset)));
    check('pasting a PDF onto a board stores the original light PNG raster',
      actualAsset.width === expectedAsset.width && actualAsset.height === expectedAsset.height
      && Buffer.from(actualAsset.rgbChannel).equals(Buffer.from(expectedAsset.rgbChannel)));

    const scan = path.join(tmp, 'Scan.pdf');
    await fixture(ed, scan, true);
    const scanRel = await ed(async (f) => (await window.api.importFiles('', [f]))[0], scan);
    await open(scanRel);
    await choose('Full');
    check('a protected full-page scan keeps black ink readable and the highlighter visible',
      (await pixels('page', PAPER))?.[0] === 255 && await blend() === 'multiply' && await ed(() =>
        window.__app.active.viewer.view(0).inkColor('#000000') === '#000000'));

    const direct = path.join(tmp, 'Direct.pdf');
    fs.copyFileSync(name, direct);
    const directOpen = await ed(async (file) => {
      const e = await window.__app.openPdfFile(file);
      return { external: e?.isExternal, message: document.querySelector('.toast')?.textContent };
    }, direct);
    assert(directOpen.external, JSON.stringify(directOpen));
    await win.locator('.editor').getByRole('button', { name: 'More', exact: true }).click();
    check('directly opened PDFs cannot write a display preference back into the file',
      await win.getByRole('menuitem', { name: 'Dark pages', exact: true }).count() === 0 && fs.readFileSync(direct).equals(fs.readFileSync(name)));
    await win.keyboard.press('Escape');
    await open(a);

    await setting(false);
    await win.waitForFunction(() => window.__app.active.viewer.view(0)?.bgScale > 0);
    check('switching the add-on off restores light pixels without erasing the set mode',
      await mode() === 'full' && (await pixels('page', [22,22]))?.[0] === 255 && await blend() === 'multiply');
  } finally {
    if (app) await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
