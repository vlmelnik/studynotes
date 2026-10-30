'use strict';
// Stacking order of pictures, tables and text boxes relative to the ink.
//
//   back objects  (layer 'b')   default for pictures and tables
//   ink strokes
//   front objects (layer 'f')   default for text boxes
//
// Inside a layer, objects are ordered by `z` (higher = on top). Objects
// without `z` keep their array order. Old files have neither field and look
// exactly as before.

function layerOf(kind, o) {
  if (o.lay === 'f' || o.lay === 'b') return o.lay;
  return kind === 'text' ? 'f' : 'b';
}

// Objects of one layer, bottom → top: [{ kind: 'text'|'item', obj }]
function stacked(data, layer) {
  const out = [];
  const add = (kind, list, base) => (list || []).forEach((o, i) => {
    if (layerOf(kind, o) !== layer) return;
    // Missing z: keep array order; items below texts as before.
    out.push({ kind, obj: o, key: typeof o.z === 'number' ? o.z : base + i * 1e-6, seq: out.length });
  });
  add('item', data.items, -1e6);
  add('text', data.texts, -5e5);
  out.sort((a, b) => a.key - b.key || a.seq - b.seq);
  return out;
}

// New layer/z for the given objects when brought to front (dir > 0) or sent to back.
function restack(data, ids, dir) {
  const all = [...stacked(data, 'b'), ...stacked(data, 'f')].map((e) => e.key);
  const max = all.length ? Math.max(...all) : 0;
  const min = all.length ? Math.min(...all) : 0;
  const patch = (list) => (list || []).map((o) => {
    if (!ids.has(o.id)) return o;
    return dir > 0 ? { ...o, lay: 'f', z: Math.max(0, max) + 1 } : { ...o, lay: 'b', z: Math.min(0, min) - 1 };
  });
  let n = 0;
  // Keep a stable relative order among several selected objects.
  const fix = (list) => list.map((o) => (ids.has(o.id) ? { ...o, z: o.z + (dir > 0 ? n++ : -(n++)) * 1e-3 } : o));
  return { ...data, items: fix(patch(data.items)), texts: fix(patch(data.texts)) };
}

module.exports = { layerOf, stacked, restack };
