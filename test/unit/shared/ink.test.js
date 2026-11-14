'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('live stroke = finished stroke for normal pens (nothing jumps when the pen lifts)', () => {
  const ink = require('../../../src/shared/ink');
  const p = [];
  for (let i = 0; i < 40; i++) p.push(10 + i * 2, 20 + Math.sin(i / 4) * 6, 0.5 + 0.2 * Math.sin(i / 7));
  for (const ps of [undefined, 'fountain', 'pencil', 'marker']) {
    const st = { t: 'pen', ps, s: 3, c: '#000', p };
    assert.deepStrictEqual(ink.getLiveOutline(st), ink.getOutline({ ...st }), String(ps));
  }
});

// ---- 1.6.1: line engine ----
test('1.6.1: a line never changes while it is drawn (pieces stay as they were)', () => {
  const ink = require('../../../src/shared/ink');
  const p = [];
  for (let i = 0; i < 60; i++) { const t = i / 60; p.push(100 + 30 * Math.cos(t * 7) + t * 50, 100 + 25 * Math.sin(t * 7), 0.4 + 0.3 * Math.sin(t * 5)); }
  for (const ps of ['ball', 'fountain', 'pencil', 'marker', 'neon']) {
    const part = ink.getLiveOutline({ t: 'pen', ps, c: '#000', s: 3, p: p.slice(0, 30 * 3) });
    const full = ink.getOutline({ t: 'pen', ps, c: '#000', s: 3, p: p.slice() });
    const keep = part.filter((q) => !q.circle).length > 2 ? part.findIndex((q, i) => i > 0 && !q.circle && part.slice(i + 1).every((z) => z.circle) ) : 0; // all but the newest band (it still grows)
    assert.deepStrictEqual(JSON.parse(JSON.stringify(full.slice(0, keep))), JSON.parse(JSON.stringify(part.slice(0, keep))), ps);
  }
});
