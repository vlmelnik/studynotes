'use strict';
// Handwriting → text with the recognizer that is built into Windows
// (Windows.UI.Input.Inking, works offline). It is reached through a small
// PowerShell script (no extra program to install). Languages: the ones whose
// "Handwriting" feature is installed in Windows (Settings → Time & language →
// Language → <language> → Options → Handwriting).

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, 'scripts', 'ink-recognize.ps1');
const SCALE = 2; // page units → about screen pixels, the size the recognizer expects

let scriptB64 = null;
function encodedScript() {
  if (!scriptB64) scriptB64 = Buffer.from(fs.readFileSync(SCRIPT, 'utf8'), 'utf16le').toString('base64');
  return scriptB64;
}

function runPowerShell(request, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { reject(new Error('Handwriting recognition uses the recognizer built into Windows')); return; }
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript()], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { ps.kill(); reject(new Error('Handwriting recognition took too long')); }, timeoutMs);
    // (a decoder per stream: letters split between chunks stay whole)
    ps.stdout.setEncoding('utf8'); ps.stderr.setEncoding('utf8');
    ps.stdout.on('data', (d) => { out += d; });
    ps.stderr.on('data', (d) => { err += d; });
    ps.stdin.on('error', () => {}); // PowerShell ended early: reported by 'close'
    ps.on('error', (e) => { clearTimeout(timer); reject(e); });
    ps.on('close', () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out.trim().replace(/^﻿/, ''));
        if (!r.ok) reject(new Error(r.error || 'Handwriting recognition failed'));
        else resolve(r);
      } catch {
        reject(new Error(`Handwriting recognition failed${err ? ': ' + err.trim().split('\n')[0] : ''}`));
      }
    });
    ps.stdin.end(JSON.stringify(request), 'utf8');
  });
}

// Tests (not on Windows): every stroke group is a "word".
function fakeRecognize(strokes) {
  return strokes.map((p, k) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    return { alts: [`word${k + 1}`], x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
}

const fake = () => !!process.env.STUDYNOTES_FAKE_INK;

/** Names of the handwriting recognizers Windows has. */
async function recognizers() {
  if (fake()) return ['Fake Handwriting Recognizer'];
  const r = await runPowerShell({ mode: 'list' }, 20000);
  return r.recognizers || [];
}

/**
 * strokes: [[x, y, x, y, …], …] in page units. Returns words in page units
 * [{ text, alts, x, y, w, h }] and the text in reading order.
 */
async function recognize(strokes, recognizer = '') {
  const scaled = strokes.map(thin);
  const raw = fake() ? fakeRecognize(scaled) : (await runPowerShell({ mode: 'recognize', recognizer, strokes: scaled })).words || [];
  const words = raw.map((w) => {
    const alts = Array.isArray(w.alts) ? w.alts : [w.alts];
    return { text: String(alts[0] || ''), alts, x: w.x / SCALE, y: w.y / SCALE, w: w.w / SCALE, h: w.h / SCALE };
  }).filter((w) => w.text);
  return { words, text: wordsToText(words) };
}

// Scaled points, thinned to ~1 px apart (the recognizer doesn't need the
// tablet's sampling density, and PowerShell is slow per point).
function thin(p) {
  const out = [];
  let lx = null, ly = null;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = Math.round(p[i] * SCALE * 10) / 10, y = Math.round(p[i + 1] * SCALE * 10) / 10;
    const last = i + 3 >= p.length;
    if (lx !== null && !last && Math.hypot(x - lx, y - ly) < 1.2) continue;
    out.push(x, y); lx = x; ly = y;
  }
  return out;
}

/**
 * Several stroke groups (e.g. the pages of an export) in one run of the
 * recognizer – starting PowerShell takes a second or two each time.
 * Returns [{ words, text }] in the same order.
 */
async function recognizeMany(groups, recognizer = '') {
  if (!groups.length) return [];
  const scaled = groups.map((g) => g.map(thin));
  const raw = fake()
    ? scaled.map((g) => fakeRecognize(g))
    : ((await runPowerShell({ mode: 'batch', recognizer, groups: scaled }, 30000 + groups.length * 15000)).results || []).map((r) => (r && r.words) || []);
  return groups.map((_, k) => {
    const words = (raw[k] || []).map((w) => {
      const alts = Array.isArray(w.alts) ? w.alts : [w.alts];
      return { text: String(alts[0] || ''), alts, x: w.x / SCALE, y: w.y / SCALE, w: w.w / SCALE, h: w.h / SCALE };
    }).filter((w) => w.text);
    return { words, text: wordsToText(words) };
  });
}

/** Words → lines (by vertical overlap) → text in reading order. */
function wordsToText(words) {
  const lines = [];
  for (const w of [...words].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))) {
    const cy = w.y + w.h / 2;
    const line = lines.find((l) => cy > l.y0 && cy < l.y1);
    if (line) { line.words.push(w); line.y0 = Math.min(line.y0, w.y); line.y1 = Math.max(line.y1, w.y + w.h); } else lines.push({ y0: w.y, y1: w.y + w.h, words: [w] });
  }
  return lines.map((l) => l.words.sort((a, b) => a.x - b.x).map((w) => w.text).join(' ')).join('\n');
}

module.exports = { recognize, recognizeMany, recognizers, wordsToText };
