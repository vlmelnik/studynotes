// Shared result reporting for the e2e suites: check() prints PASS/FAIL and
// records the result, finish() prints "N/M checks passed" and exits.
const fs = require('fs');

const results = [];
// Page and console errors collected by harness/app.js launch().
const errors = [];

function check(name, ok, info = '') {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}

// Optionally adds the "no page errors" check (pass the collected errors; with
// no argument that check is skipped), prints the summary line and exits with
// 0 when every check passed, otherwise 1.
//   opts.ignore       RegExp of errors to ignore (default /favicon|ResizeObserver/)
//   opts.label        name of the errors check (default 'no page errors')
//   opts.resultsFile  also write all results there as JSON
function finish(errs, opts = {}) {
  if (errs) {
    const ignore = opts.ignore || /favicon|ResizeObserver/;
    const real = errs.filter((e) => !ignore.test(e));
    check(opts.label || 'no page errors', real.length === 0, real.slice(0, 5).join(' | '));
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  if (opts.resultsFile) fs.writeFileSync(opts.resultsFile, JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
}

module.exports = { check, results, errors, finish };
