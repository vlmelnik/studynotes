'use strict';

const MAX_NAME_LENGTH = 120;
const MAX_NAME_BYTES = 255;
const DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|(?:COM|LPT)[1-9¹²³]) *(?:\.|$)/i;

function withSuffix(stem, suffix) {
  // Iterate by code point to respect both file systems' limits without
  // splitting an emoji or any other surrogate pair. Suffixes are ASCII.
  const maxLength = MAX_NAME_LENGTH - suffix.length;
  const maxBytes = MAX_NAME_BYTES - suffix.length;
  let end = 0;
  let bytes = 0;
  for (const char of stem) {
    const cp = char.codePointAt(0);
    const width = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (end + char.length > maxLength || bytes + width > maxBytes) break;
    end += char.length;
    bytes += width;
  }
  return stem.slice(0, end).replace(/[. ]+$/, '') + suffix;
}

function safeName(name) {
  let clean = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Windows reserves these stems even when a file extension is present.
  if (DEVICE_NAME.test(clean)) clean = '_' + clean;
  return withSuffix(clean, '') || 'Untitled';
}

function caseKey(name) {
  let key = '';
  for (const char of name) {
    const upper = char.toUpperCase();
    // Use ordinal-like casing rather than context-dependent lowercase or
    // expansions like ß to SS, which would equate differently spelled names.
    key += upper.length === char.length ? upper : char;
  }
  return key;
}

function chooseName(base, taken, marker) {
  const occupied = new Set(Array.from(taken, caseKey));
  let candidate = marker ? withSuffix(base, marker) : base;
  for (let i = 2; occupied.has(caseKey(candidate)); i++) {
    candidate = withSuffix(base, `${marker} (${i})`);
  }
  return candidate;
}

// The base is already sanitized.
function uniqueName(base, taken) {
  return chooseName(base, taken, '');
}

function caseOnlyRename(from, to) {
  return from !== to && caseKey(from) === caseKey(to);
}

function renamePlan(from, to, taken) {
  if (from === to) return [];
  const siblings = Array.from(taken).filter((name) => name !== from);
  const finalName = uniqueName(safeName(to), siblings);
  if (from === finalName) return [];
  if (!caseOnlyRename(from, finalName)) return [[from, finalName]];

  // The final spelling is not yet free on a case-insensitive file system.
  const temp = chooseName(from, [...siblings, from, finalName], '.renaming');
  return [[from, temp], [temp, finalName]];
}

module.exports = { safeName, uniqueName, caseOnlyRename, renamePlan };
