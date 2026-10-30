'use strict';
// Fonts available for text boxes and tables. The same TTF files are used on
// screen (@font-face) and in the PDF export, so both look identical.
// Variable fonts (single file) get bold/italic synthesised in the export.

const FONTS = {
  // noSubset: pdf-lib's subsetter drops glyphs of these fonts → embed whole.
  carlito: { label: 'Calibri style', css: 'SN Carlito', noSubset: true, files: { r: 'Carlito-Regular.ttf', b: 'Carlito-Bold.ttf', i: 'Carlito-Italic.ttf', bi: 'Carlito-BoldItalic.ttf' } },
  sans: { label: 'Arial style', css: 'SN Sans', files: { r: 'LiberationSans-Regular.ttf', b: 'LiberationSans-Bold.ttf', i: 'LiberationSans-Italic.ttf', bi: 'LiberationSans-BoldItalic.ttf' } },
  serif: { label: 'Times style', css: 'SN Serif', files: { r: 'LiberationSerif-Regular.ttf', b: 'LiberationSerif-Bold.ttf', i: 'LiberationSerif-Italic.ttf', bi: 'LiberationSerif-BoldItalic.ttf' } },
  mono: { label: 'Courier style', css: 'SN Mono', files: { r: 'LiberationMono-Regular.ttf', b: 'LiberationMono-Bold.ttf', i: 'LiberationMono-Italic.ttf', bi: 'LiberationMono-BoldItalic.ttf' } },
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
