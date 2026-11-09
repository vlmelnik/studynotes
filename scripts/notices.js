// Builds assets/THIRD-PARTY-NOTICES.txt: the licences of everything bundled
// with StudyNotes (shown in Settings → About → Licences).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const lic = (f) => path.join(root, 'licenses', f);
const parts = [
  ['Electron', 'MIT', nm('electron/LICENSE'), 'https://github.com/electron/electron (Chromium licences: LICENSES.chromium.html next to the program)'],
  ['PDF.js (pdfjs-dist)', 'Apache-2.0', nm('pdfjs-dist/LICENSE'), 'https://github.com/mozilla/pdf.js'],
  ['pdf-lib', 'MIT', nm('pdf-lib/LICENSE.md'), 'https://github.com/Hopding/pdf-lib'],
  ['@pdf-lib/fontkit', 'MIT', lic('fontkit-LICENSE'), 'https://github.com/Hopding/fontkit'],
  ['perfect-freehand', 'MIT', nm('perfect-freehand/LICENSE'), 'https://github.com/steveruizok/perfect-freehand'],
  ['onnxruntime-node', 'MIT', lic('onnxruntime-LICENSE'), 'https://github.com/microsoft/onnxruntime'],
  ['Tesseract.js', 'Apache-2.0', nm('tesseract.js/LICENSE.md'), 'https://github.com/naptha/tesseract.js'],
  ['Tesseract OCR engine (tesseract.js-core)', 'Apache-2.0', nm('tesseract.js-core/LICENSE'), 'https://github.com/tesseract-ocr/tesseract – language data (tessdata_best, Apache-2.0) is included'],
  ['nspell', 'MIT', nm('nspell/license'), 'https://github.com/wooorm/nspell'],
  ['dictionary-ru (Russian Hunspell dictionary)', 'BSD-3-Clause', lic('dictionary-ru-LICENSE.txt'), 'https://github.com/wooorm/dictionaries'],
  ['dictionary-en (English Hunspell dictionary)', 'MIT / BSD (SCOWL)', lic('dictionary-en-LICENSE.txt'), 'https://github.com/wooorm/dictionaries'],
  ['an-array-of-german-words (German word list)', 'MIT', lic('an-array-of-german-words-LICENSE.txt'), 'https://github.com/hexapode/an-array-of-german-words'],
  ['yauzl', 'MIT', nm('yauzl/LICENSE'), 'https://github.com/thejoshwolfe/yauzl'],
  ['yazl', 'MIT', nm('yazl/LICENSE'), 'https://github.com/thejoshwolfe/yazl'],
  ['ISNet background-removal model (DIS)', 'Apache-2.0', lic('isnet-LICENSE'), 'https://github.com/xuebinqin/DIS – see also assets/models/NOTICE.txt'],
  ['Carlito font', 'SIL OFL 1.1', lic('carlito-OFL.txt'), 'https://github.com/googlefonts/carlito'],
  ['Liberation fonts (Sans, Serif, Mono)', 'SIL OFL 1.1', lic('liberation-LICENSE'), 'https://github.com/liberationfonts/liberation-fonts'],
  ...[['Caladea', 'caladea'], ['Gelasio', 'gelasio'], ['Open Sans', 'open-sans'], ['Roboto', 'roboto'], ['Inter', 'inter'], ['Lato', 'lato'], ['Source Sans 3', 'source-sans-3'], ['Fira Sans', 'fira-sans'], ['Montserrat', 'montserrat'], ['Noto Sans', 'noto-sans'], ['Noto Serif', 'noto-serif'], ['EB Garamond', 'eb-garamond'], ['PT Sans', 'pt-sans'], ['PT Serif', 'pt-serif'], ['Caveat', 'caveat'], ['Pangolin', 'pangolin'], ['Marck Script', 'marck-script'], ['Bad Script', 'bad-script']]
    .map(([n, f]) => [`${n} font`, f === 'roboto' ? 'SIL OFL 1.1 / Apache-2.0' : 'SIL OFL 1.1', lic(`${f}-LICENSE.txt`), 'https://fonts.google.com']),
  ['Comfortaa font', 'SIL OFL 1.1', lic('comfortaa-OFL.txt'), 'https://github.com/alexeiva/comfortaa'],
  ['Neucha font', 'SIL OFL 1.1', lic('neucha-OFL.txt'), 'https://fonts.google.com/specimen/Neucha'],
  ['DejaVu Sans font', 'Bitstream Vera / public domain', lic('dejavu-LICENSE'), 'https://dejavu-fonts.github.io'],
];
let out = 'StudyNotes – third-party software\n=================================\n\nStudyNotes itself: MIT licence, (c) vlmelnik.\nIt includes the following software and fonts under their own licences.\n';
for (const [name, l, file, url] of parts) {
  out += `\n\n${'-'.repeat(72)}\n${name}  –  ${l}\n${url}\n${'-'.repeat(72)}\n\n`;
  out += fs.readFileSync(file, 'utf8').trim() + '\n';
}
fs.writeFileSync(path.join(root, 'assets', 'THIRD-PARTY-NOTICES.txt'), out);
console.log('notices:', parts.length, 'components,', out.length, 'chars');
