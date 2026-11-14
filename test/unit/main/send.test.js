'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { outlookScript, thunderbirdArgs, psQuote } = require('../../../src/main/send');

test('send: PowerShell / Thunderbird arguments are quoted safely', () => {
  assert.strictEqual(psQuote("it's"), "'it''s'");
  const script = outlookScript("C:\\Temp\\a'b.pdf", "Notes ' ; Remove-Item");
  assert.ok(script.includes("'C:\\Temp\\a''b.pdf'"));
  assert.ok(script.includes("'Notes '' ; Remove-Item'"));
  const args = thunderbirdArgs('C:\\Temp\\x y.pdf', "Sub'ject");
  assert.strictEqual(args[0], '-compose');
  assert.ok(args[1].includes("attachment='file:///C:/Temp/x y.pdf'") && !args[1].includes("Sub'ject"));
});
