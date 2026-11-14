'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = (p = 'sn14-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('Fill & sign: form fields are read with page positions and filled (also Cyrillic) into the PDF', async () => {
  const { PDFDocument } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const forms = require('../../../src/main/forms');
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField('name'); name.addToPage(page, { x: 100, y: 700, width: 200, height: 24 });
  const ok = form.createCheckBox('agree'); ok.addToPage(page, { x: 100, y: 650, width: 14, height: 14 });
  const bytes = await doc.save();
  const fields = await forms.readFormFields(bytes);
  const f = fields.find((x) => x.name === 'name');
  assert.deepStrictEqual([f.type, f.page], ['text', 0]);
  const near = (a, b) => Math.abs(a - b) <= 1; // the widget rectangle includes its 1 pt border
  assert.ok(near(f.x, 100) && near(f.y, 76) && near(f.w, 200) && near(f.h, 24), JSON.stringify(f));
  assert.ok(fields.find((x) => x.name === 'agree' && x.type === 'check'));
  const font = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'LiberationSans-Regular.ttf'));
  const out = await forms.fillForm(bytes, { name: 'Иван Петров', agree: true }, font, fontkit);
  const back = await PDFDocument.load(out);
  assert.strictEqual(back.getForm().getFields().length, 0, 'flattened: every reader shows the values');
  // signatures store
  const store = forms.signatures(tmp('sn15-sig-'));
  const id = await store.save(Buffer.from([1, 2, 3]));
  assert.strictEqual((await store.list()).length, 1);
  await store.remove(id);
  assert.strictEqual((await store.list()).length, 0);
});
