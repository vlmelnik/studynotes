'use strict';
// "Send" a PDF: e-mail with attachment, or Telegram via the clipboard.
// Windows-only helpers; every step has a fallback that still gets the file
// to the user (Explorer with the file selected).

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

// PowerShell single-quoted string literal.
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function powershell(script) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

function outlookScript(file, subject) {
  return [
    '$ErrorActionPreference = "Stop"',
    '$o = New-Object -ComObject Outlook.Application',
    '$m = $o.CreateItem(0)',
    `$m.Subject = ${psQuote(subject)}`,
    `[void]$m.Attachments.Add(${psQuote(file)})`,
    '$m.Display()',
  ].join('; ');
}

function findThunderbird() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Mozilla Thunderbird', 'thunderbird.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Mozilla Thunderbird', 'thunderbird.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function thunderbirdArgs(file, subject) {
  const url = 'file:///' + file.replace(/\\/g, '/');
  // Thunderbird's -compose syntax: comma-separated key='value' pairs.
  return ['-compose', `subject='${subject.replace(/'/g, '')}',attachment='${url}'`];
}

/** Returns { method: 'outlook'|'thunderbird'|'fallback' }. */
async function sendMail(file, subject, shell) {
  if (process.platform === 'win32') {
    const r = await powershell(outlookScript(file, subject));
    if (r.ok) return { method: 'outlook' };
    const tb = findThunderbird();
    if (tb) {
      const t = await run(tb, thunderbirdArgs(file, subject), { timeout: 5000 });
      if (t.ok || /timed out|ETIMEDOUT|SIGTERM/i.test(t.stderr)) return { method: 'thunderbird' };
    }
  }
  // No mail program we can attach to: open a new mail and show the file.
  shell.showItemInFolder(file);
  await shell.openExternal('mailto:?subject=' + encodeURIComponent(subject));
  return { method: 'fallback' };
}

/** Put the PDF on the clipboard as a file and open Telegram. */
async function sendTelegram(file, shell) {
  let copied = false;
  if (process.platform === 'win32') {
    const r = await powershell(`Set-Clipboard -LiteralPath ${psQuote(file)}`);
    copied = r.ok;
  }
  let opened = false;
  try {
    await shell.openExternal('tg://');
    opened = true;
  } catch { /* Telegram Desktop not installed */ }
  if (!opened) await shell.openExternal('https://web.telegram.org/');
  if (!copied) shell.showItemInFolder(file);
  return { copied, desktop: opened };
}

module.exports = { sendMail, sendTelegram, outlookScript, thunderbirdArgs, psQuote };
