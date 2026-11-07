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
// OCR (scanned PDFs): engine, WebAssembly core and Portuguese / English data,
// all inside the app so it works offline.
{
  const ocr = path.join(dist, 'ocr');
  fs.mkdirSync(path.join(ocr, 'core'), { recursive: true });
  fs.mkdirSync(path.join(ocr, 'lang'), { recursive: true });
  const nm = path.join(root, 'node_modules');
  const worker = path.join(nm, 'tesseract.js', 'dist', 'worker.min.js');
  const coreDir = path.join(nm, 'tesseract.js-core');
  if (fs.existsSync(worker) && fs.existsSync(coreDir)) {
    fs.copyFileSync(worker, path.join(ocr, 'worker.min.js'));
    for (const f of fs.readdirSync(coreDir)) if (/^tesseract-core.*\.(js|wasm)$/.test(f)) fs.copyFileSync(path.join(coreDir, f), path.join(ocr, 'core', f));
    // <lang>.traineddata.gz lives in a version folder inside @tesseract.js-data/<lang>
    const find = (dir, name) => {
      if (!fs.existsSync(dir)) return null;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { const r = find(full, name); if (r) return r; } else if (e.name === name) return full;
      }
      return null;
    };
    for (const lang of ['por', 'eng']) {
      const f = find(path.join(nm, '@tesseract.js-data', lang), `${lang}.traineddata.gz`);
      if (f) fs.copyFileSync(f, path.join(ocr, 'lang', `${lang}.traineddata.gz`));
      else console.warn(`OCR: no ${lang}.traineddata.gz found (npm install @tesseract.js-data/${lang})`);
    }
  } else {
    console.warn('OCR: tesseract.js is not installed (npm install) - text recognition will not work');
  }
}
console.log('built dist/');
