// Toolbar in a narrow window (half a screen): no two buttons overlap, and
// buttons that do not fit are reachable through "More".
// usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/layout-narrow.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { check, errors, finish } = require('./harness/report');
const { launch } = require('./harness/app');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-narrow-'));
  const { app, win, ed } = await launch({ tmp });
  await ed(async () => { const r = await window.api.createNotebook('', { title: 'A notebook with a rather long title for a narrow window', paper: 'lined', pageCount: 2 }); await window.__app.openNotebook(r); });
  await win.waitForTimeout(800);
  for (const width of [1600, 1280, 960, 800, 700]) {
    // (a narrower window: the page's own width, the test window cannot shrink under xvfb)
    await ed((w) => { document.body.style.width = w + 'px'; }, width - 16);
    await win.waitForTimeout(500);
    const r = await ed(() => {
      const tb = window.__app.active.topbar;
      // (the two halves of a split button touch on purpose: one control)
      const boxes = [...tb.querySelectorAll('button')].filter((b) => b.offsetParent && b.getBoundingClientRect().width > 0 && !b.classList.contains('split-arrow')).map((b) => { const q = (b.closest('.split-btn') || b).getBoundingClientRect(); return { t: b.title || b.className, l: q.left, r: q.right }; });
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (Math.min(boxes[i].r, boxes[j].r) - Math.max(boxes[i].l, boxes[j].l) > 1) overlaps.push(`${boxes[i].t} / ${boxes[j].t}`);
      const out = boxes.filter((b) => b.l < -1 || b.r > tb.clientWidth + 1).map((b) => b.t);
      return { tb: tb.clientWidth, overlaps, out, folded: (window.__app.active.foldable || []).filter((f) => f.el.hidden).map((f) => f.label), undo: !!window.__app.active.undoBtn.offsetParent };
    });
    check(`${width} px: no toolbar buttons overlap or leave the window`, !r.overlaps.length && !r.out.length, JSON.stringify(r));
    check(`${width} px: undo stays visible`, r.undo);
    if (r.folded.length) {
      await ed(() => window.__app.active.moreBtn.click());
      await win.waitForTimeout(200);
      const items = await ed(() => [...document.querySelectorAll('.menu .menu-item, .menu button')].map((b) => b.textContent.trim()));
      check(`${width} px: folded buttons are in "More"`, r.folded.every((l) => items.some((t) => t.includes(l))), JSON.stringify({ folded: r.folded, items: items.slice(0, 8) }));
      await win.keyboard.press('Escape');
    }
  }
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish(errors);
})().catch((e) => { console.error(e); process.exit(2); });
