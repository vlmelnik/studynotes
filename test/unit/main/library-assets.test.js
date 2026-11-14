'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { Library } = require('../../../src/main/library');

async function pngBytes() {
  // 2x2 red PNG
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
}

test('library: assets deduplicate, sources copy, board notebooks', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-as-'));
  const lib = new Library(tmp);
  const nb = await lib.createNotebook('', { title: 'Board', kind: 'board' });
  const n = await lib.readNotebook(nb);
  assert.strictEqual(n.kind, 'board');
  assert.strictEqual(n.pages[0].kind, 'board');
  const a1 = await lib.writeAsset(nb, await pngBytes(), 'png');
  const a2 = await lib.writeAsset(nb, await pngBytes(), 'PNG');
  assert.strictEqual(a1, a2);
  assert.ok((await lib.readAsset(nb, a1)).length > 10);
  await assert.rejects(lib.readAsset(nb, '../notebook.json'));
  await assert.rejects(lib.writeAsset(nb, Buffer.from('x'), 'exe'));
  const pdf = path.join(tmp, 'x.pdf');
  fs.writeFileSync(pdf, await (await PDFDocument.create()).save());
  const s = await lib.addSource(nb, pdf);
  assert.ok(fs.existsSync(path.join(lib.abs(nb), s.file)));
  await lib.writeText(nb, { pages: { 1: 'hi' } }, s.id);
  assert.strictEqual((await lib.readText(nb, s.id)).pages[1], 'hi');
});
