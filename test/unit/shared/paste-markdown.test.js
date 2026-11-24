'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { markdownToRich } = require('../../../src/shared/paste-markdown');
const { parseRich } = require('../../../src/shared/richtext');

test('converts headings, nested list emphasis, numbered items and blank lines', () => {
  const result = markdownToRich('# Summary\n\n- **Important** and *brief*\n* Second\n3. __Example__', 15);
  assert.deepEqual(result, {
    html: '<div><span data-fs="24"><b>Summary</b></span></div><div><br></div>'
      + '<div>• <b>Important</b> and <i>brief</i></div><div>• Second</div><div>3. <b>Example</b></div>',
    plain: 'Summary\n\n• Important and brief\n• Second\n3. Example',
  });
  const [heading, , item] = parseRich(result.html);
  assert.equal(heading[0].fs, 24);
  assert.equal(item.find((run) => run.t === 'Important').b, true);
  assert.equal(item.find((run) => run.t === 'brief').i, true);
});

test('rounds the three heading sizes to half points', () => {
  const { html } = markdownToRich('# Alpha\r\n## Beta\r### Gamma', 13);
  assert.match(html, /data-fs="21".*data-fs="17.5".*data-fs="15"/);
});

test('leaves isolated marks literal and escapes all text outside of markup it creates', () => {
  for (const text of ['one * star', '# Single', '**Only one**', '- <tag> & sample']) {
    const { html, plain } = markdownToRich(text, 12);
    assert.equal(plain, text);
    assert.doesNotMatch(html, /<(?:b|i|tag)\b/);
  }
  assert.equal(markdownToRich('# <topic>\n- **A & B**', 10).plain, '<topic>\n• A & B');
});
