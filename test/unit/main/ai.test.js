'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Ai } = require('../../../src/main/ai');

// a fake key store: "encrypts" by reversing (enough to see it is not plain)
const safe = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from([...s].reverse().join('')), decryptString: (b) => [...b.toString()].reverse().join('') };

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const { status = 200, json } = handler(url, init) || {};
    return { ok: status < 400, status, text: async () => JSON.stringify(json) };
  };
  f.calls = calls;
  return f;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sn-ai-'));

test('keys are stored encrypted and never in plain text', async () => {
  const dir = tmp();
  const ai = new Ai({ dir, safeStorage: safe, fetchImpl: fakeFetch(() => ({})) });
  await ai.setKey('anthropic', '  sk-ant-secret-123 ');
  const raw = fs.readFileSync(path.join(dir, 'ai-keys.json'), 'utf8');
  assert.ok(!raw.includes('sk-ant-secret-123'));
  assert.strictEqual(await ai.key('anthropic'), 'sk-ant-secret-123');
  assert.ok(await ai.hasKey('anthropic'));
  await ai.setKey('anthropic', '');
  assert.ok(!(await ai.hasKey('anthropic')));
  const noStore = new Ai({ dir, safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(noStore.setKey('openai', 'k'), /no secure key store/);
  await assert.rejects(ai.setKey('local', 'k'), /Unknown provider/);
});

test('each provider gets its own request format and answer parsing', async () => {
  const dir = tmp();
  const f = fakeFetch((url) => {
    if (url.includes('anthropic')) return { json: { content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 3 } } };
    if (url.includes('generativelanguage')) return { json: { candidates: [{ content: { parts: [{ text: '{"g":1}' }] } }] } };
    return { json: { choices: [{ message: { content: '{"o":1}' } }] } };
  });
  const ai = new Ai({ dir, safeStorage: safe, fetchImpl: f });
  for (const p of ['anthropic', 'openai', 'gemini']) await ai.setKey(p, 'k-' + p);
  const a = await ai.request({ provider: 'anthropic', model: 'claude-x' }, { system: 'S', user: 'U' });
  assert.strictEqual(a.text, '{"a":1}');
  assert.strictEqual(f.calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(f.calls[0].init.headers['x-api-key'], 'k-anthropic');
  assert.deepStrictEqual(f.calls[0].body.messages, [{ role: 'user', content: 'U' }]);
  assert.strictEqual(f.calls[0].body.system, 'S');
  assert.strictEqual((await ai.request({ provider: 'openai', model: 'gpt-x' }, { system: 'S', user: 'U' })).text, '{"o":1}');
  assert.strictEqual(f.calls[1].init.headers.authorization, 'Bearer k-openai');
  assert.deepStrictEqual(f.calls[1].body.response_format, { type: 'json_object' });
  assert.strictEqual((await ai.request({ provider: 'gemini', model: 'gemini-x' }, { system: 'S', user: 'U' })).text, '{"g":1}');
  assert.match(f.calls[2].url, /v1beta\/models\/gemini-x:generateContent$/);
  assert.strictEqual(f.calls[2].init.headers['x-goog-api-key'], 'k-gemini');
  assert.strictEqual((await ai.request({ provider: 'local', model: 'llama', baseUrl: 'http://localhost:1234/v1/' }, { system: 'S', user: 'U' })).text, '{"o":1}');
  assert.strictEqual(f.calls[3].url, 'http://localhost:1234/v1/chat/completions');
  assert.ok(!f.calls[3].init.headers.authorization);
  // the log has no content, only sizes
  const log = fs.readFileSync(path.join(dir, 'ai-log.json'), 'utf8');
  assert.ok(!log.includes('"U"') && JSON.parse(log).length === 4 && JSON.parse(log)[0].chars === 2);
});

test('errors are readable; limit, missing key, model and remote "local" servers are refused', async () => {
  const dir = tmp();
  let status = 401;
  const ai = new Ai({ dir, safeStorage: safe, fetchImpl: fakeFetch(() => ({ status, json: { error: { message: 'nope' } } })) });
  await assert.rejects(ai.request({ provider: 'openai', model: 'm' }, { system: '', user: '' }), /No API key/);
  await ai.setKey('openai', 'k');
  await assert.rejects(ai.request({ provider: 'openai', model: 'm' }, { system: '', user: '' }), /key was not accepted/);
  status = 429;
  await assert.rejects(ai.request({ provider: 'openai', model: 'm' }, { system: '', user: '' }), /too many requests/);
  await assert.rejects(ai.request({ provider: 'openai' }, { system: '', user: '' }), /Choose a model/);
  await assert.rejects(ai.request({ provider: 'local', model: 'm', baseUrl: 'https://example.com/v1' }, { system: '', user: '' }), /own network/);
  assert.strictEqual(await ai.usedThisMonth(), 2);
  await assert.rejects(ai.request({ provider: 'openai', model: 'm', monthlyLimit: 2 }, { system: '', user: '' }), /monthly limit of 2/);
  const down = new Ai({ dir, safeStorage: safe, fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  await assert.rejects(down.request({ provider: 'local', model: 'm' }, { system: '', user: '' }), /could not be reached \(ECONNREFUSED\)/);
});

test('model lists', async () => {
  const ai = new Ai({ dir: tmp(), safeStorage: safe, fetchImpl: fakeFetch((url) => (url.includes('generativelanguage')
    ? { json: { models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] } }
    : { json: { data: [{ id: 'm1' }, { id: 'm2' }] } })) });
  await ai.setKey('gemini', 'k');
  assert.deepStrictEqual(await ai.models({ provider: 'gemini' }), ['gemini-a']);
  assert.deepStrictEqual(await ai.models({ provider: 'local' }), ['m1', 'm2']);
});
