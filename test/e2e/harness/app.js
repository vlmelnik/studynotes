// Starts the real app with Playwright. STUDYNOTES_EXE runs a packaged build
// instead of the dev sources.
const { _electron: electron } = require('playwright-core');
const path = require('path');
const { errors: sharedErrors } = require('./report');

const root = path.join(__dirname, '..', '..', '..');

// launch({ tmp, env, viewport, args, userData, library, errors })
//   tmp       scratch folder; library = tmp/Library, user data = tmp/u
//   env       extra environment variables (STUDYNOTES_FAKE_INK, ...)
//   viewport  default { width: 1500, height: 940 }; null leaves the window size alone
//   args      extra command-line arguments for the app
//   userData / library: override the two folders above
//   errors    array that receives page errors (default: report.errors)
// Resolves to { app, win, ed } once window.__app exists.
async function launch({ tmp, env = {}, viewport = { width: 1500, height: 940 }, args = [], userData, library, errors = sharedErrors } = {}) {
  const packaged = !!process.env.STUDYNOTES_EXE;
  const app = await electron.launch({
    executablePath: process.env.STUDYNOTES_EXE || require('electron'),
    args: [...(packaged ? [] : [root]), '--no-sandbox', ...args],
    env: {
      ...process.env,
      STUDYNOTES_TEST: '1',
      STUDYNOTES_LIBRARY: library || path.join(tmp, 'Library'),
      STUDYNOTES_USERDATA: userData || path.join(tmp, 'u'),
      ...env,
    },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (viewport) await win.setViewportSize(viewport);
  await win.waitForFunction(() => window.__app);
  return { app, win, ed: (fn, arg) => win.evaluate(fn, arg) };
}

module.exports = { launch, root };
