'use strict';
// PDF form fields (Fill & sign): read the fields of a PDF so the app can show
// them as inputs, and write the typed values into the exported PDF.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = require('pdf-lib');

/**
 * Fields of the PDF, in page coordinates (points, origin top-left of the
 * visible page, like the app's pages).
 * @returns {Promise<Array<{ name, type, page, x, y, w, h, value, options?, multiline? }>>}
 */
async function readFormFields(bytes) {
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { return []; }
  let form;
  try { form = doc.getForm(); } catch { return []; }
  const pages = doc.getPages();
  const pageOfWidget = new Map();
  pages.forEach((p, i) => {
    const annots = p.node.Annots && p.node.Annots();
    if (!annots) return;
    for (const ref of annots.asArray()) pageOfWidget.set(ref.toString(), i);
  });
  const out = [];
  for (const f of form.getFields()) {
    let type;
    if (f instanceof PDFTextField) type = 'text';
    else if (f instanceof PDFCheckBox) type = 'check';
    else if (f instanceof PDFDropdown) type = 'choice';
    else if (f instanceof PDFRadioGroup) type = 'radio';
    else continue;
    let value = '';
    try {
      if (type === 'text') value = f.getText() || '';
      else if (type === 'check') value = f.isChecked();
      else if (type === 'choice') value = (f.getSelected() || [])[0] || '';
      else value = f.getSelected() || '';
    } catch { /* unreadable value */ }
    const widgets = f.acroField.getWidgets();
    widgets.forEach((w, wi) => {
      const ref = doc.context.getObjectRef(w.dict);
      const pi = ref ? pageOfWidget.get(ref.toString()) : undefined;
      if (pi === undefined) return;
      const page = pages[pi];
      if ((page.getRotation().angle || 0) % 360 !== 0) return; // rotated pages: not supported
      const r = w.getRectangle();
      const cb = page.getCropBox();
      const entry = {
        name: f.getName(), type, page: pi,
        x: r.x - cb.x, y: cb.y + cb.height - (r.y + r.height), w: r.width, h: r.height, value,
      };
      if (type === 'choice') entry.options = f.getOptions();
      if (type === 'text') entry.multiline = f.isMultiline();
      if (type === 'radio') {
        // the value this widget stands for
        const on = w.getOnValue && w.getOnValue();
        entry.option = on ? on.decodeText ? on.decodeText() : String(on).replace(/^\//, '') : String(wi);
      }
      out.push(entry);
    });
  }
  return out;
}

/**
 * The PDF with the typed values written into its fields and flattened
 * (so every PDF reader shows them). `values`: { fieldName: string | boolean }.
 * `fontBytes`: a TTF used for the values (covers Cyrillic etc.).
 */
async function fillForm(bytes, values, fontBytes, fontkit) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.registerFontkit(fontkit);
  const form = doc.getForm();
  const font = fontBytes ? await doc.embedFont(fontBytes, { subset: false }) : undefined;
  for (const [name, v] of Object.entries(values || {})) {
    let f;
    try { f = form.getField(name); } catch { continue; }
    try {
      if (f instanceof PDFTextField) f.setText(String(v ?? ''));
      else if (f instanceof PDFCheckBox) { if (v) f.check(); else f.uncheck(); }
      else if (f instanceof PDFDropdown) { if (v) f.select(String(v)); else f.clear(); }
      else if (f instanceof PDFRadioGroup) { if (v) f.select(String(v)); else f.clear(); }
    } catch { /* value not allowed for this field */ }
  }
  if (font) form.updateFieldAppearances(font);
  try {
    form.flatten();
  } catch {
    // a broken widget (no page) stops flattening: the fields keep their
    // filled-in appearance instead, which every PDF reader shows as well
  }
  return doc.save();
}

// ---------- saved signatures (userData/signatures/<id>.png) ----------
function signatures(dir) {
  const ensure = () => fsp.mkdir(dir, { recursive: true });
  return {
    async list() {
      await ensure();
      const names = (await fsp.readdir(dir)).filter((n) => /^[a-z0-9]+\.png$/.test(n)).sort();
      return Promise.all(names.map(async (n) => ({ id: n.replace(/\.png$/, ''), bytes: await fsp.readFile(path.join(dir, n)) })));
    },
    async save(bytes) {
      await ensure();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await fsp.writeFile(path.join(dir, id + '.png'), Buffer.from(bytes));
      return id;
    },
    async remove(id) {
      if (!/^[a-z0-9]+$/.test(String(id))) throw new Error('Bad id');
      await fsp.rm(path.join(dir, id + '.png'), { force: true });
    },
  };
}

module.exports = { readFormFields, fillForm, signatures };
