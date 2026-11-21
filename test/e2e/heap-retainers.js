// Why is an object still alive? Reads a V8 heap snapshot (.heapsnapshot,
// e.g. from SNAP=<file> node test/e2e/soak.js) and prints, for every object
// whose constructor has the given name, the shortest chain of references
// from a GC root – the reference that keeps it from being freed.
// usage: node test/e2e/heap-retainers.js <file> <ConstructorName> [max=5]
const fs = require('fs');
const [file, name, maxArg] = process.argv.slice(2);
const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
const m = snap.snapshot.meta;
const NF = m.node_fields.length, EF = m.edge_fields.length;
const nType = m.node_fields.indexOf('type'), nName = m.node_fields.indexOf('name'), nEdges = m.node_fields.indexOf('edge_count'), nId = m.node_fields.indexOf('id');
const eType = m.edge_fields.indexOf('type'), eName = m.edge_fields.indexOf('name_or_index'), eTo = m.edge_fields.indexOf('to_node');
const nodeTypes = m.node_types[0], edgeTypes = m.edge_types[0];
const N = snap.nodes, E = snap.edges, S = snap.strings;
const count = N.length / NF;
const firstEdge = new Uint32Array(count + 1);
for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += N[i * NF + nEdges] * EF; }
firstEdge[count] = E.length;
const label = (i) => `${nodeTypes[N[i * NF + nType]]} ${S[N[i * NF + nName]]}`.slice(0, 90);
const edgeLabel = (e) => { const t = edgeTypes[E[e + eType]]; const v = E[e + eName]; return t === 'element' || t === 'hidden' ? `[${v}]` : `.${S[v]}`; };
// BFS from roots (node 0 is the synthetic root)
const dist = new Int32Array(count).fill(-1), via = new Int32Array(count).fill(-1), viaEdge = new Int32Array(count).fill(-1);
const q = new Int32Array(count); let qh = 0, qt = 0; q[qt++] = 0; dist[0] = 0;
while (qh < qt) {
  const i = q[qh++];
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
    const t = edgeTypes[E[e + eType]];
    if (t === 'weak' || t === 'shortcut') continue;
    const j = E[e + eTo] / NF;
    if (dist[j] < 0) { dist[j] = dist[i] + 1; via[j] = i; viaEdge[j] = e; q[qt++] = j; }
  }
}
const hits = [];
for (let i = 0; i < count; i++) if (nodeTypes[N[i * NF + nType]] === 'object' && S[N[i * NF + nName]] === name) hits.push(i);
console.log(`${hits.length} × ${name}`);
for (const i of hits.slice(0, Number(maxArg || 5))) {
  const chain = [];
  for (let k = i; k > 0 && via[k] >= 0; k = via[k]) chain.push(`${label(via[k])} ${edgeLabel(viaEdge[k])}`);
  console.log(`\n@${N[i * NF + nId]} (distance ${dist[i]}):\n  ` + chain.reverse().join('\n  → '));
}
