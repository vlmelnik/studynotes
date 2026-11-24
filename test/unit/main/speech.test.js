'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

test('speech: checks the audio, the length and the language before anything runs', async () => {
  process.env.STUDYNOTES_SPEECH_FAKE = '1';
  const { Speech, MODELS, LANGUAGES } = require('../../../src/main/speech');
  const s = new Speech(path.join(os.tmpdir(), 'sn-speech-test'));
  assert.deepStrictEqual(Object.keys(MODELS), ['base', 'small']);
  assert.ok(LANGUAGES.includes('german') && LANGUAGES.includes('russian'));
  await assert.rejects(() => s.transcribe(new Float32Array(0)), /No audio/);
  await assert.rejects(() => s.transcribe([1, 2, 3]), /No audio/);
  await assert.rejects(() => s.transcribe(new Float32Array(16000 * 60 * 60 * 2 + 16000)), /longer than 2 hours/);
  assert.strictEqual(await s.transcribe(new Float32Array(16000 * 3), { language: 'klingon' }), 'fake transcript: 3.0 s, german, base');
  await assert.rejects(() => s.status('huge'), /Unknown model/);
  delete process.env.STUDYNOTES_SPEECH_FAKE;
});
