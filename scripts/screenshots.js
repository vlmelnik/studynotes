// Screenshots for the README (docs/screenshots). Needs a display (xvfb-run).
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/screenshots.js
// 1. drives the real app with neutral sample content and takes raw shots,
// 2. frames each shot (window, shadow, gradient, headline) for the README.
const { _electron: electron } = require('playwright-core');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-shots-'));
const rawDir = path.join(tmp, 'raw');
fs.mkdirSync(rawDir);

// ---------- sample content (neutral, English) ----------
async function lecturePdf(file) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const H = 841.89;
  page.drawText('Biology 101 - Lecture 3', { x: 50, y: H - 70, size: 20, font: bold, color: rgb(0.11, 0.36, 0.25) });
  page.drawText('3.2 Photosynthesis', { x: 50, y: H - 110, size: 14, font: bold, color: rgb(0.15, 0.15, 0.15) });
  const lines = [
    'Plants, algae and some bacteria turn light energy into chemical energy.',
    'The process takes place in the chloroplasts, mainly in the leaves.',
    '',
    'Overall reaction:   6 CO2 + 6 H2O + light  ->  C6H12O6 + 6 O2',
    '',
    'Light-dependent reactions (thylakoid membrane) split water, release',
    'oxygen and produce ATP and NADPH.',
    '',
    'The Calvin cycle (stroma) uses ATP and NADPH to fix carbon dioxide',
    'into sugar. Its key enzyme, RuBisCO, is the most common protein on Earth.',
  ];
  let y = H - 140;
  for (const l of lines) { page.drawText(l, { x: 50, y, size: 11.5, font, color: rgb(0.15, 0.15, 0.15) }); y -= 18; }
  page.drawEllipse({ x: 430, y: 300, xScale: 110, yScale: 70, borderColor: rgb(0.2, 0.5, 0.3), borderWidth: 1.5, color: rgb(0.93, 0.97, 0.93) });
  page.drawEllipse({ x: 430, y: 300, xScale: 55, yScale: 26, borderColor: rgb(0.15, 0.45, 0.2), borderWidth: 1.2, color: rgb(0.78, 0.9, 0.75) });
  for (let i = -2; i <= 2; i++) page.drawLine({ start: { x: 430 + i * 12, y: 290 }, end: { x: 430 + i * 12, y: 310 }, thickness: 2, color: rgb(0.2, 0.55, 0.25) });
  page.drawText('Fig. 3.4  Chloroplast in a leaf cell', { x: 350, y: 210, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
  await fs.promises.writeFile(file, await doc.save());
}

async function formPdf(file) {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const pg = doc.addPage([595.28, 841.89]);
  pg.drawRectangle({ x: 0, y: 770, width: 595.28, height: 71.89, color: rgb(0.18, 0.37, 0.62) });
  pg.drawText('City Library', { x: 60, y: 798, size: 22, font: bold, color: rgb(1, 1, 1) });
  pg.drawText('Membership application', { x: 60, y: 720, size: 18, font: bold, color: rgb(0.12, 0.2, 0.35) });
  const form = doc.getForm();
  const field = (label, name, y) => { pg.drawText(label, { x: 60, y: y + 8, size: 11, font: reg }); form.createTextField(name).addToPage(pg, { x: 210, y, width: 300, height: 24 }); };
  field('Full name', 'name', 660); field('Email', 'email', 620); field('City', 'city', 580);
  pg.drawText('I accept the library rules', { x: 90, y: 536, size: 11, font: reg });
  form.createCheckBox('rules').addToPage(pg, { x: 60, y: 532, width: 16, height: 16 });
  pg.drawText('Date', { x: 60, y: 452, size: 11, font: reg });
  pg.drawLine({ start: { x: 210, y: 448 }, end: { x: 360, y: 448 }, thickness: 0.8, color: rgb(0.4, 0.4, 0.4) });
  pg.drawText('Signature', { x: 60, y: 392, size: 11, font: reg });
  pg.drawLine({ start: { x: 210, y: 388 }, end: { x: 510, y: 388 }, thickness: 0.8, color: rgb(0.4, 0.4, 0.4) });
  await fs.promises.writeFile(file, await doc.save());
}

// A made-up signature, drawn as a smooth curve.
async function signaturePng(win) {
  const data = await win.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 520; c.height = 170;
    const g = c.getContext('2d');
    g.strokeStyle = '#13235b'; g.lineCap = g.lineJoin = 'round';
    const curve = (pts, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); } g.stroke(); };
    curve([[20, 120], [45, 40], [70, 125], [80, 90], [60, 95], [95, 88], [120, 110], [135, 70], [150, 112], [175, 80], [195, 112], [215, 78], [240, 115], [262, 84], [290, 112], [330, 60], [350, 118], [380, 92], [420, 100], [500, 70]], 5);
    curve([[90, 140], [250, 132], [420, 138]], 3);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return data;
}

// ---------- framing ----------
const FRAMES = {
  hero: { title: 'Write on any PDF', sub: 'Pens with pressure, highlighter, shapes and text – on lecture slides, papers and scripts.', bg: ['#1f3b73', '#2f5f9e', '#6a4fb3'] },
  library: { title: 'All your notebooks', sub: 'Covers, folders, endless boards – and search across everything.', bg: ['#16324f', '#2b6c8f', '#3f9b8a'] },
  templates: { title: 'Covers & paper', sub: 'Lined, grid, dotted, Cornell, planners – cream, white or dark.', bg: ['#4a2f73', '#7a4fa3', '#c0679b'] },
  'fill-sign': { title: 'Fill & sign', sub: 'Type into PDF forms, add your saved signature and the date.', bg: ['#123d3a', '#1f6f63', '#4aa37f'] },
  'whats-new': { title: 'Always improving', sub: 'A short tour of what is new after every update.', bg: ['#3b2a1c', '#9a5b2e', '#d79a4a'] },
};

async function frame(page, name, rawFile) {
  const f = FRAMES[name];
  const img = 'data:image/png;base64,' + fs.readFileSync(rawFile).toString('base64');
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 1600px; height: 1000px; font-family: "Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif;
      background: radial-gradient(1200px 700px at 15% 0%, ${f.bg[2]}55, transparent 60%), linear-gradient(135deg, ${f.bg[0]}, ${f.bg[1]});
      color: #fff; overflow: hidden; position: relative; }
    .glow { position: absolute; width: 900px; height: 900px; right: -300px; bottom: -420px; border-radius: 50%;
      background: radial-gradient(circle, ${f.bg[2]}88, transparent 65%); }
    header { position: absolute; left: 90px; top: 64px; right: 90px; }
    h1 { font-size: 54px; font-weight: 750; letter-spacing: -0.5px; }
    p { font-size: 23px; opacity: .88; margin-top: 10px; max-width: 1100px; }
    .win { position: absolute; left: 90px; right: 90px; top: 225px; border-radius: 14px; overflow: hidden;
      box-shadow: 0 40px 90px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.18); background: #fff; }
    .win img { display: block; width: 100%; }
  </style></head><body><div class="glow"></div>
    <header><h1>${f.title}</h1><p>${f.sub}</p></header>
    <div class="win"><img src="${img}"></div>
  </body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, name + '.png') });
}

(async () => {
  const lecture = path.join(tmp, 'Photosynthesis – Lecture 3.pdf');
  await lecturePdf(lecture);
  const form = path.join(tmp, 'Library membership.pdf');
  await formPdf(form);
  fs.mkdirSync(path.join(tmp, 'u'));
  // "What's new" shows once: pretend the previous version was 1.4
  fs.writeFileSync(path.join(tmp, 'u', 'config.json'), JSON.stringify({ settings: { lastSeenVersion: '1.4.0' } }));
  const app = await electron.launch({
    executablePath: require('electron'), args: [root, '--no-sandbox'],
    env: { ...process.env, STUDYNOTES_TEST: '1', STUDYNOTES_LIBRARY: path.join(tmp, 'Library'), STUDYNOTES_USERDATA: path.join(tmp, 'u') },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1420, height: 800 });
  await win.waitForFunction(() => window.__app);
  const ed = (fn, a) => win.evaluate(fn, a);
  const raw = (n) => win.screenshot({ path: path.join(rawDir, n + '.png') });

  await win.waitForSelector('.whats-new', { timeout: 5000 }).catch(() => {});
  await win.waitForTimeout(700);
  await raw('whats-new');
  while (await win.locator('.modal-actions .btn-primary').count()) await win.locator('.modal-actions .btn-primary').last().click();

  // library: covers in different styles
  await ed(async (file) => {
    const mk = (title, cover, paper) => window.api.createNotebook('', { title, paper, cover });
    await mk('World History', { style: 'simple', color: '#b5a088', accent: '#7eaee8' }, 'lined');
    await mk('Calculus', { style: 'solid', color: '#0f4c8c', accent: '#a3c8f0' }, 'grid');
    await mk('Chemistry Lab', { style: 'solid', color: '#7da86c', accent: '#9bd24f' }, 'dotted');
    await mk('Reading Journal', { style: 'solid', color: '#f6d6cf', accent: '#e05a5a' }, 'lined');
    await mk('Physics', { style: 'simple', color: '#353841', accent: '#0d0d0f' }, 'grid');
    await window.api.createNotebook('', { title: 'Brainstorm', kind: 'board', coverColor: '#4a4a4f' });
    await window.api.createFolder('', 'Semester 2');
    await window.api.importFiles('', [file]);
  }, lecture);
  await ed(async () => {
    for (const n of (await window.api.list('')).notebooks) await window.__app.prepareNotebook(n.path).catch(() => {});
    await window.__app.library.load('');
  });
  await win.waitForTimeout(1000);
  await raw('library');

  // the lecture with notes
  const lec = await ed(async () => (await window.api.list('')).notebooks.find((n) => /Lecture/.test(n.title)).path);
  await ed((r) => window.__app.openNotebook(r), lec);
  await win.waitForTimeout(1500);
  await ed(() => {
    const e = window.__app.active;
    const id = e.pages[0].id;
    const wave = []; for (let i = 0; i <= 44; i++) wave.push(50 + i * 4.3, 199 + Math.sin(i / 2.2) * 1.4, 0.5);
    const ring = []; for (let i = 0; i <= 56; i++) { const a = (i / 56) * Math.PI * 2 - 0.4; ring.push(215 + Math.cos(a) * 31, 298 + Math.sin(a) * 9.5, 0.5); }
    e.setPageData(id, {
      strokes: [
        { id: 'h1', t: 'hl', c: '#ffe14d', s: 14, p: [48, 136, 0.5, 455, 136, 0.5] },
        { id: 'w1', t: 'pen', ps: 'fountain', c: '#1a4fd6', s: 1.6, p: wave },
        { id: 'r1', t: 'pen', c: '#e0473c', s: 1.8, p: ring, np: 1 },
        { id: 'h2', t: 'hl', c: '#9be37a', s: 14, p: [48, 280, 0.5, 432, 280, 0.5] },
      ],
      texts: [
        { id: 't1', x: 452, y: 183, w: 120, fs: 15, c: '#1a4fd6', ff: 'hand', text: 'learn this!' },
        { id: 't2', x: 300, y: 312, w: 200, fs: 14, c: '#e0473c', ff: 'hand', text: 'enzyme = protein!' },
        { id: 't3', x: 60, y: 355, w: 260, fs: 15, c: '#2b2b2b', ff: 'hand', text: 'Q: Why are leaves green? → chlorophyll reflects green light' },
      ],
      items: [],
    });
  });
  await ed(() => { const e = window.__app.active; e.setTool('pen'); const v = e.viewer; v.zoomTo(1.12, undefined, undefined, false); v.scroller.scrollTop = 0; v.update(); });
  await win.waitForTimeout(800);
  await raw('hero');

  // template picker (from the library), scrolled so both cover groups show
  await ed(() => window.__app.showLibrary());
  await ed(() => { window.__app.library.newNotebook(); });
  await win.waitForSelector('.tp');
  await win.fill('.tp-title', 'Biology');
  await win.waitForTimeout(500);
  await raw('templates');
  await win.keyboard.press('Escape');

  // Fill & sign
  await ed((f) => window.__app.openPdfFile(f, { fill: true }), form);
  await win.waitForSelector('.form-field', { timeout: 8000 });
  const inputs = win.locator('input.form-field');
  await inputs.nth(0).fill('Alex Morgan');
  await inputs.nth(1).fill('alex.morgan@example.com');
  await inputs.nth(2).fill('Springfield');
  await win.locator('.form-check').click();
  const sig = await signaturePng(win);
  await ed(async (bytes) => {
    const e = window.__app.active;
    const it = await e.insertImageBytes(new Uint8Array(bytes), 'image/png', { index: 0, x: 330, y: 438 });
    const k = 160 / it.w; it.w *= k; it.h *= k; it.x = 330 - it.w / 2; it.y = 438 - it.h + 6;
    const d = new Date(2026, 9, 30).toLocaleDateString('en-GB');
    e.tools.placeObjects(0, { items: [it], texts: [{ id: 'dt', x: 214, y: 376, w: 120, fs: 14, c: '#1a1a1a', ff: 'sans', text: d }] });
    e.tools.clearSelection();
  }, sig);
  await win.mouse.click(5, 500);
  await ed(() => { const v = window.__app.active.viewer; v.zoomTo(0.95, undefined, undefined, false); v.scroller.scrollTop = 0; v.update(); });
  await win.waitForTimeout(800);
  await raw('fill-sign');
  await ed(() => window.__app.closeAll());
  await app.close();

  // frame everything
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  for (const name of Object.keys(FRAMES)) await frame(page, name, path.join(rawDir, name + '.png'));
  await browser.close();
  for (const old of ['editor', 'papers', 'settings-ru']) fs.rmSync(path.join(outDir, old + '.png'), { force: true });
  console.log('screenshots in', outDir);
})().catch((e) => { console.error(e); process.exit(1); });
