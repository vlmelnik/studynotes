'use strict';
// Fonts available for text boxes and tables. The same TTF files are used on
// screen (@font-face) and in the PDF export, so both look identical.
// Variable fonts (single file) get bold/italic synthesised in the export.

const four = (n) => ({ r: `${n}-Regular.ttf`, b: `${n}-Bold.ttf`, i: `${n}-Italic.ttf`, bi: `${n}-BoldItalic.ttf` });

// Ordered by how often they appear in documents. kind: sans / serif / mono
// (used by "Make text editable" to keep one kind of typeface); cyr: false =
// no Cyrillic letters (not offered for Russian text).
const FONTS = {
  // noSubset: pdf-lib's subsetter drops glyphs of these fonts → embed whole
  // (checked for every font by test/export.test.js).
  carlito: { label: 'Calibri style', css: 'SN Carlito', kind: 'sans', noSubset: true, files: { r: 'Carlito-Regular.ttf', b: 'Carlito-Bold.ttf', i: 'Carlito-Italic.ttf', bi: 'Carlito-BoldItalic.ttf' } },
  sans: { label: 'Arial style', css: 'SN Sans', kind: 'sans', files: { r: 'LiberationSans-Regular.ttf', b: 'LiberationSans-Bold.ttf', i: 'LiberationSans-Italic.ttf', bi: 'LiberationSans-BoldItalic.ttf' } },
  serif: { label: 'Times style', css: 'SN Serif', kind: 'serif', files: { r: 'LiberationSerif-Regular.ttf', b: 'LiberationSerif-Bold.ttf', i: 'LiberationSerif-Italic.ttf', bi: 'LiberationSerif-BoldItalic.ttf' } },
  cambria: { label: 'Cambria style', css: 'SN Caladea', kind: 'serif', cyr: false, files: four('Caladea') },
  georgia: { label: 'Georgia style', css: 'SN Gelasio', kind: 'serif', cyr: false, files: four('Gelasio') },
  opensans: { label: 'Open Sans', css: 'SN Open Sans', kind: 'sans', files: four('OpenSans') },
  roboto: { label: 'Roboto', css: 'SN Roboto', kind: 'sans', files: four('Roboto') },
  inter: { label: 'Inter (Helvetica Neue style)', css: 'SN Inter', kind: 'sans', noSubset: true, files: four('Inter') },
  lato: { label: 'Lato', css: 'SN Lato', kind: 'sans', cyr: false, files: four('Lato') },
  sourcesans: { label: 'Source Sans', css: 'SN Source Sans', kind: 'sans', noSubset: true, files: four('SourceSans3') },
  fira: { label: 'Fira Sans', css: 'SN Fira Sans', kind: 'sans', noSubset: true, files: four('FiraSans') },
  montserrat: { label: 'Montserrat', css: 'SN Montserrat', kind: 'sans', files: four('Montserrat') },
  notosans: { label: 'Noto Sans', css: 'SN Noto Sans', kind: 'sans', noSubset: true, files: four('NotoSans') },
  notoserif: { label: 'Noto Serif', css: 'SN Noto Serif', kind: 'serif', noSubset: true, files: four('NotoSerif') },
  garamond: { label: 'Garamond style', css: 'SN Garamond', kind: 'serif', noSubset: true, files: four('EBGaramond') },
  ptsans: { label: 'PT Sans', css: 'SN PT Sans', kind: 'sans', noSubset: true, files: four('PTSans') },
  ptserif: { label: 'PT Serif', css: 'SN PT Serif', kind: 'serif', noSubset: true, files: four('PTSerif') },
  mono: { label: 'Courier style', css: 'SN Mono', kind: 'mono', files: { r: 'LiberationMono-Regular.ttf', b: 'LiberationMono-Bold.ttf', i: 'LiberationMono-Italic.ttf', bi: 'LiberationMono-BoldItalic.ttf' } },
  hand: { label: 'Handwriting', css: 'SN Hand', files: { r: 'Neucha-Regular.ttf' } },
  round: { label: 'Rounded', css: 'SN Round', files: { r: 'Comfortaa-Variable.ttf' }, variable: true },
};

const DEFAULT_FONT = 'carlito';

function fontFile(id, b, i) {
  const f = FONTS[id] || FONTS[DEFAULT_FONT];
  const key = b && i ? 'bi' : b ? 'b' : i ? 'i' : 'r';
  const file = f.files[key];
  return { file: file || f.files.r, synthBold: !f.files[key] && b, synthItalic: !f.files[key] && i, subset: !f.noSubset };
}

function fontFaceCss(baseUrl) {
  const out = [];
  for (const f of Object.values(FONTS)) {
    for (const [key, file] of Object.entries(f.files)) {
      const weight = f.variable ? '300 700' : key.includes('b') ? '700' : '400';
      const style = key.includes('i') ? 'italic' : 'normal';
      out.push(`@font-face{font-family:"${f.css}";src:url("${baseUrl}${file}") format("truetype");font-weight:${weight};font-style:${style};font-display:block;}`);
    }
  }
  return out.join('\n');
}

module.exports = { FONTS, DEFAULT_FONT, fontFile, fontFaceCss };
