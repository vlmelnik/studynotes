// Bundle the renderer and copy static assets into dist/.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Extensions (docs/EXTENSIONS.md): every src/extensions/<id>/index.js is
// bundled in; the renderer imports the list from 'studynotes:extensions'.
const extDir = path.join(root, 'src', 'extensions');
const extIds = fs.existsSync(extDir) ? fs.readdirSync(extDir).filter((d) => /^[a-z0-9-]+$/.test(d) && fs.existsSync(path.join(extDir, d, 'index.js'))).sort() : [];
const extensionsPlugin = {
  name: 'studynotes-extensions',
  setup(b) {
    b.onResolve({ filter: /^studynotes:extensions$/ }, () => ({ path: 'extensions', namespace: 'sn-ext' }));
    b.onLoad({ filter: /.*/, namespace: 'sn-ext' }, () => ({
      resolveDir: extDir,
      contents: extIds.map((id, k) => `import e${k} from './${id}/index.js';`).join('\n') + `\nexport default [${extIds.map((id, k) => `e${k}`).join(', ')}];\n`,
    }));
  },
};

// The bundle can no longer be built synchronously with a plugin.
(async () => {
await esbuild.build({
  entryPoints: [path.join(root, 'src', 'renderer', 'main.js')],
  plugins: [extensionsPlugin],
  // CSS imported by extensions (their own, katex) goes to dist/app.css; its fonts next to it
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  assetNames: 'ext-assets/[name]-[hash]',
  bundle: true,
  format: 'esm',
  target: 'chrome130',
  outfile: path.join(dist, 'app.js'),
  sourcemap: true,
  minify: process.argv.includes('--minify'),
  logLevel: 'warning',
});

if (!fs.existsSync(path.join(dist, 'app.css'))) fs.writeFileSync(path.join(dist, 'app.css'), '');
fs.copyFileSync(path.join(root, 'src', 'renderer', 'index.html'), path.join(dist, 'index.html'));
// Fonts: the same TTF files the PDF export embeds, so screen and export match.
const { fontFaceCss } = require(path.join(root, 'src', 'shared', 'fonts.js'));
fs.cpSync(path.join(root, 'assets', 'fonts'), path.join(dist, 'fonts'), { recursive: true });
fs.writeFileSync(path.join(dist, 'styles.css'), fontFaceCss('fonts/') + '\n' + fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8'));
fs.copyFileSync(path.join(root, 'assets', 'icon-256.png'), path.join(dist, 'icon.png'));
fs.copyFileSync(path.join(pdfjs, 'build', 'pdf.worker.min.mjs'), path.join(dist, 'pdf.worker.min.mjs'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = path.join(pdfjs, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(dist, dir), { recursive: true });
}
console.log('built dist/');
})().catch((err) => { console.error(err); process.exit(1); });
