// Fill & sign: PDF form fields as inputs on the page, saved signatures
// (drawn or from a picture) and quick stamps (text, date, ✓).
import { h, modal, toast } from './ui.js';
import { icon } from './icons.js';
import { uid } from './tools.js';

// ---------- form fields ----------
export async function loadFormFields(editor) {
  if (!editor.doc.nb.hasPdf) return;
  try { editor.formFields = await window.api.formFields(editor.rel); } catch { editor.formFields = []; }
  if (editor.formFields && editor.formFields.length) for (const v of editor.viewer.views.values()) editor.renderObjects(v);
}

/** Inputs for the form fields on this page (into the page's front layer). */
export function renderFormFields(editor, view) {
  const fields = editor.formFields;
  const page = view.page;
  if (!fields || !fields.length || page.kind !== 'pdf' || (page.src && page.src !== 'main') || page.rot) return;
  const here = fields.filter((f) => f.page === page.pdfPage - 1);
  if (!here.length) return;
  const nb = editor.doc.nb;
  const value = (f) => (nb.form && f.name in nb.form ? nb.form[f.name] : f.value);
  const set = (name, v) => {
    nb.form = { ...(nb.form || {}), [name]: v };
    editor.markDirty();
  };
  const layer = h('div', { class: 'form-layer no-i18n' });
  for (const f of here) {
    const style = { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px', fontSize: Math.max(6, Math.min(f.h * 0.7, 14)) + 'px' };
    let el;
    if (f.type === 'check' || f.type === 'radio') {
      const on = f.type === 'check' ? !!value(f) : value(f) === f.option;
      el = h('button', { class: `form-field form-check${on ? ' on' : ''}`, style, title: f.name, onclick: () => {
        if (f.type === 'check') set(f.name, !value(f)); else set(f.name, value(f) === f.option ? '' : f.option);
        editor.renderObjects(view);
      } }, on ? '✓' : '');
    } else if (f.type === 'choice') {
      el = h('select', { class: 'form-field', style, title: f.name },
        h('option', { value: '' }, ''), ...(f.options || []).map((o) => h('option', { value: o, selected: o === value(f) }, o)));
      el.addEventListener('change', () => set(f.name, el.value));
    } else {
      el = h(f.multiline ? 'textarea' : 'input', { class: 'form-field', style, title: f.name, spellcheck: 'false' });
      el.value = value(f) || '';
      el.addEventListener('input', () => set(f.name, el.value));
    }
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.dataset.field = f.name;
    layer.append(el);
  }
  view.textLayer.append(layer);
}

// ---------- signatures ----------
const urlFor = (bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));

/** Pick, draw or upload a signature; the chosen one is placed with the next click. */
export async function signatureDialog(editor) {
  const list = h('div', { class: 'sig-list' });
  let dlg;
  const refresh = async () => {
    const sigs = await window.api.sigList().catch(() => []);
    list.replaceChildren(...(sigs.length ? sigs.map((s) => h('div', { class: 'sig-item' },
      h('button', { class: 'sig-pick', title: 'Click on the page to place the signature', onclick: () => { dlg.close(null); placeNext(editor, { bytes: s.bytes }); } },
        h('img', { src: urlFor(s.bytes), alt: '' })),
      h('button', { class: 'icon-btn sm sig-del', title: 'Delete signature', html: icon('trash', 16), onclick: async () => { await window.api.sigRemove(s.id); refresh(); } })))
      : [h('p', { class: 'hint' }, 'No saved signatures yet')]));
  };

  // drawing pad
  const pad = h('canvas', { class: 'sig-pad', width: 900, height: 300 });
  const g = pad.getContext('2d');
  let drawing = null, empty = true;
  const pt = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5]; };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); drawing = pt(e); empty = false; });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const p = pt(ev);
      g.strokeStyle = '#0b1f4d'; g.lineCap = g.lineJoin = 'round';
      g.lineWidth = 3 + p[2] * 5;
      g.beginPath(); g.moveTo(drawing[0], drawing[1]); g.lineTo(p[0], p[1]); g.stroke();
      drawing = p;
    }
  });
  pad.addEventListener('pointerup', () => { drawing = null; });
  const clear = () => { g.clearRect(0, 0, pad.width, pad.height); empty = true; };
  const saveDrawn = async () => {
    if (empty) return;
    const bytes = await cropToInk(pad);
    if (!bytes) return;
    await window.api.sigSave(bytes);
    toast('Signature saved', { timeout: 1200 });
    clear();
    refresh();
  };
  const upload = async () => {
    const files = await window.api.pickImages();
    if (!files || !files.length) return;
    const bytes = await whiteToTransparent(files[0].bytes);
    await window.api.sigSave(bytes);
    toast('Signature saved', { timeout: 1200 });
    refresh();
  };

  dlg = modal({
    title: 'Signatures',
    width: 620,
    body: h('div', { class: 'sig-dialog' },
      h('h4', {}, 'Saved signatures'), list,
      h('h4', {}, 'Add signature'),
      pad,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: clear }, 'Clear drawing'),
        h('button', { class: 'btn btn-primary', onclick: saveDrawn }, 'Save signature'),
        h('span', { style: { flex: '1' } }),
        h('button', { class: 'btn', onclick: upload }, h('span', { html: icon('image', 16) }), 'Upload picture'))),
    actions: [{ label: 'Close', result: null }],
  });
  refresh();
}

/** The drawn signature, cut to its ink, as PNG bytes. */
async function cropToInk(canvas) {
  const { width: W, height: H } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 8;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const c = document.createElement('canvas');
  c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext('2d').drawImage(canvas, -x0, -y0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** A photo / scan of a signature: white paper becomes transparent. */
async function whiteToTransparent(bytes) {
  const img = await createImageBitmap(new Blob([bytes]));
  const c = document.createElement('canvas');
  const k = Math.min(1, 1200 / img.width);
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // light → transparent, dark keeps its colour; soft edge in between
    const a = Math.max(0, Math.min(1, (225 - lum) / 70));
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  g.putImageData(id, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------- place with the next click ----------
/** what: { bytes } (signature picture) or { text } (stamp: text, date, ✓). */
export function placeNext(editor, what) {
  editor.placing = what;
  editor.el.classList.add('placing');
  toast(what.bytes ? 'Click on the page to place the signature' : 'Click on the page', { timeout: 2500 });
}

/** Called by the tools on a click while something is waiting to be placed. */
export async function placeAt(editor, hit) {
  const what = editor.placing;
  editor.placing = null;
  editor.el.classList.remove('placing');
  if (!what) return;
  if (what.bytes) {
    const it = await editor.insertImageBytes(what.bytes, 'image/png', { index: hit.index, x: hit.x, y: hit.y });
    const k = 150 / it.w; // signatures start 150 pt wide
    it.w = Math.round(it.w * k * 100) / 100; it.h = Math.round(it.h * k * 100) / 100;
    it.x = Math.round((hit.x - it.w / 2) * 100) / 100; it.y = Math.round((hit.y - it.h / 2) * 100) / 100;
    editor.tools.placeObjects(hit.index, { items: [it] });
    return;
  }
  const fs = 14;
  const t = { id: uid(), x: Math.round(hit.x * 100) / 100, y: Math.round((hit.y - fs * 0.7) * 100) / 100, w: Math.max(30, what.text.length * fs * 0.62), fs, c: '#1a1a1a', text: what.text, ff: 'sans' };
  editor.tools.placeObjects(hit.index, { texts: [t] });
}

export function todayText() {
  return new Date().toLocaleDateString(document.documentElement.lang === 'ru' ? 'ru-RU' : undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Floating bar for Fill & sign mode. */
export function fillBar(editor) {
  const b = (ic, label, fn, cls = '') => h('button', { class: `fill-btn ${cls}`, onclick: fn }, h('span', { html: icon(ic, 18) }), label);
  return h('div', { class: 'fill-bar' },
    h('span', { class: 'fill-title' }, h('span', { html: icon('fillSign', 18) }), 'Fill & sign'),
    b('signature', 'Signature', () => signatureDialog(editor)),
    b('text', 'Text', () => editor.setTool('text')),
    b('calendar', 'Date', () => placeNext(editor, { text: todayText() })),
    b('check', 'Check', () => placeNext(editor, { text: '✓' })),
    b('export', 'Save PDF', () => editor.saveIntoPdf(), 'primary'));
}
