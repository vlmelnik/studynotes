'use strict';
// Runs the dictionary check (spell.js) in its own process: see main.js.
const { correctLines } = require('./spell');
process.parentPort.on('message', (e) => {
  const { id, lines } = e.data;
  try { process.parentPort.postMessage({ id, res: correctLines(lines) }); } catch (err) { process.parentPort.postMessage({ id, err: String(err && err.message || err) }); }
});
