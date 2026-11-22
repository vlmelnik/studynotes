# Testing StudyNotes

This guide is for first-time contributors. It explains which check to run and when.
The commands come from `package.json`, `AGENTS.md` and `.github/workflows/ci.yml`.

## Setup

```sh
npm ci
```

CI uses Node.js 22. If you work behind a proxy or in a sandbox where the
`onnxruntime-node` install script cannot download its extra binaries, skip that
step (the CPU binary ships in the package):

```sh
ONNXRUNTIME_NODE_INSTALL=skip npm ci
```

## Which check to run

| Command | What it does | When to run it |
| --- | --- | --- |
| `npm test` | Unit tests with the Node test runner (`test/unit/**/*.test.js`). `test/unit/shared` is pure logic, `test/unit/main` uses Node and the file system. | After every code change. Fast, no display needed. |
| `npm run build` | Writes third-party notices, then bundles the app (`scripts/notices.js`, `scripts/build.js`). | Before any end-to-end test and before opening a pull request. The e2e tests run the built app. |
| `npm run test:e2e:smoke` | Starts the real Electron app with Playwright and runs the smoke suite (`test/e2e/smoke.js`). | After UI or main-process changes, after `npm run build`. |
| `npm run test:e2e` | Smoke suite plus all versioned e2e suites. | Before larger changes are merged. Slower. |
| `npm run test:all` | `npm test`, `npm run build` and `npm run test:e2e` in a row. | Full local check. |

To run one e2e suite: `node test/e2e/<suite>.js`. Set `ONLY=A,B` to limit it to
some sections.

For bugs, add a failing test first, then fix the code.

## Smoke test on Linux

The e2e tests need a display and the poppler tools. On Debian or Ubuntu:

```sh
sudo apt-get update && sudo apt-get install -y poppler-utils xvfb
```

This provides `pdftotext`, `pdfinfo` and `xvfb-run`. Then run, in this order:

```sh
npm ci
npm test
npm run build
xvfb-run -a -s "-screen 0 1600x1000x24" npm run test:e2e:smoke
```

This is the same sequence as the `linux` job in CI. On Windows the app opens a
real window, so `xvfb-run` is not needed.

## Skipped tests

The Node test runner lists skipped tests separately in its summary (`# skip`).
A skipped test is neither a pass nor a failure: the run can be green while that
code path was not checked at all. Usually a test skips because something it
needs is missing on your machine, for example a system tool.

If a test you care about is skipped:

1. Read the skip reason printed next to the test name.
2. Install what is missing (see the Linux prerequisites above) and run again.
3. If you cannot run it, say so in your pull request, so the reviewer knows
   that path was only checked by CI.

A green suite is not proof for code paths it does not reach.

## What CI runs

On every push and pull request:

- `linux`: `npm ci`, `npm test`, `npm run build`, smoke e2e under `xvfb-run`.
- `windows`: `npm ci`, `npm test`.

CI does not run the full `npm run test:e2e`, so run it locally for larger UI
changes.
