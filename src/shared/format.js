'use strict';
// Data format versions and migrations.
//
// Rules that keep future versions compatible:
//  * every file carries a version number;
//  * older data is migrated forward when read (never rewritten in place
//    until the user saves);
//  * unknown fields and unknown object types are preserved untouched, so a
//    file written by a newer version survives a round trip through an
//    older one;
//  * a newer version than we know is opened, with a warning.

const NOTEBOOK_VERSION = 2;
const SETTINGS_VERSION = 1;
const BACKUP_VERSION = 1;

function migrateNotebook(nb) {
  if (!nb || typeof nb !== 'object') throw new Error('Invalid notebook');
  const v = nb.version || 1;
  if (v < 2) {
    // v1 → v2: notebook kind, PDF sources map, page origin for boards.
    nb.kind = nb.kind || 'notebook';
    nb.sources = nb.sources || (nb.hasPdf ? { main: { file: 'source.pdf' } } : {});
    nb.version = 2;
  }
  if (!Array.isArray(nb.pages)) nb.pages = [];
  if (!nb.sources) nb.sources = nb.hasPdf ? { main: { file: 'source.pdf' } } : {};
  nb.newerVersion = v > NOTEBOOK_VERSION ? v : undefined;
  return nb;
}

function migratePage(d) {
  const out = d && typeof d === 'object' ? d : {};
  if (!Array.isArray(out.strokes)) out.strokes = [];
  if (!Array.isArray(out.texts)) out.texts = [];
  if (!Array.isArray(out.items)) out.items = [];
  return out;
}

function pageIsEmpty(d) {
  return !d || ((!d.strokes || !d.strokes.length) && (!d.texts || !d.texts.length) && (!d.items || !d.items.length) &&
    Object.keys(d).every((k) => ['strokes', 'texts', 'items'].includes(k)));
}

// Settings file exchanged between versions.
function makeSettingsExport(settings, appVersion) {
  return { format: 'studynotes-settings', version: SETTINGS_VERSION, appVersion, exported: new Date().toISOString(), settings };
}

function readSettingsImport(obj) {
  if (!obj || obj.format !== 'studynotes-settings') throw new Error('This is not a StudyNotes settings file');
  if (typeof obj.settings !== 'object' || !obj.settings) throw new Error('The settings file is empty or damaged');
  // version 1 is the only one so far; newer versions keep unknown keys.
  return obj.settings;
}

module.exports = {
  NOTEBOOK_VERSION, SETTINGS_VERSION, BACKUP_VERSION,
  migrateNotebook, migratePage, pageIsEmpty, makeSettingsExport, readSettingsImport,
};
