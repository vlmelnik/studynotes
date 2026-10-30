// Bundle the renderer and copy static assets into dist/.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'renderer', 'main.js')],
  bundle: true,
  format: 'esm',
  target: 'chrome130',
  outfile: path.join(dist, 'app.js'),
  sourcemap: true,
  minify: process.argv.includes('--minify'),
  logLevel: 'warning',
});

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
