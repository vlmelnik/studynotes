'use strict';
// Speech to text on this computer (Whisper through transformers.js and
// onnxruntime-node, which StudyNotes already ships for recognition). The
// model is downloaded once from Hugging Face into userData/models/speech and
// then works offline. Audio comes in as 16 kHz mono samples (the renderer
// decodes the file). STUDYNOTES_SPEECH_FAKE=1 answers without a model (tests).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MODELS = {
  base: { id: 'onnx-community/whisper-base', label: 'Base (about 80 MB, fast)' },
  small: { id: 'onnx-community/whisper-small', label: 'Small (about 250 MB, more accurate)' },
};
const LANGUAGES = ['german', 'english', 'russian', 'french', 'spanish', 'italian', 'ukrainian', 'polish', 'turkish'];
const MAX_SECONDS = 2 * 60 * 60;

class Speech {
  constructor(dir) {
    this.dir = dir;
    this.pipes = new Map(); // model key -> Promise<pipeline>
    this.fake = process.env.STUDYNOTES_SPEECH_FAKE === '1';
  }

  modelDir(key) { return path.join(this.dir, ...MODELS[key].id.split('/')); }

  async status(key) {
    if (!MODELS[key]) throw new Error('Unknown model');
    if (this.fake) return { downloaded: true, size: 1 };
    let size = 0;
    const walk = async (d) => { for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else size += (await fsp.stat(p)).size; } };
    await walk(this.modelDir(key));
    return { downloaded: fs.existsSync(path.join(this.modelDir(key), 'onnx', 'decoder_model_merged_quantized.onnx')), size };
  }

  // the pipeline for a model, downloading it first if needed; progress(0..1, file)
  load(key, progress = () => {}) {
    if (!MODELS[key]) return Promise.reject(new Error('Unknown model'));
    if (!this.pipes.has(key)) {
      const p = (async () => {
        const { pipeline, env } = require('@huggingface/transformers');
        env.cacheDir = this.dir;
        env.allowLocalModels = false;
        const files = new Map();
        return pipeline('automatic-speech-recognition', MODELS[key].id, {
          dtype: 'q8',
          progress_callback: (ev) => {
            if (ev.status === 'progress' && ev.total) {
              files.set(ev.file, [ev.loaded, ev.total]);
              let a = 0, b = 0;
              for (const [l, t] of files.values()) { a += l; b += t; }
              progress(b ? a / b : 0, ev.file);
            }
          },
        });
      })();
      p.catch(() => this.pipes.delete(key));
      this.pipes.set(key, p);
    }
    return this.pipes.get(key);
  }

  async download(key, progress) {
    if (this.fake) { progress(1, 'fake'); return this.status(key); }
    await this.load(key, progress);
    return this.status(key);
  }

  async remove(key) {
    if (!MODELS[key]) throw new Error('Unknown model');
    const p = this.pipes.get(key);
    this.pipes.delete(key);
    if (p) { try { await (await p).dispose(); } catch { /* not loaded */ } }
    await fsp.rm(this.modelDir(key), { recursive: true, force: true });
  }

  /** samples: Float32Array (16 kHz mono) → text */
  async transcribe(samples, { model = 'base', language = 'german' } = {}, progress = () => {}) {
    if (!(samples instanceof Float32Array) || !samples.length) throw new Error('No audio.');
    if (samples.length / 16000 > MAX_SECONDS) throw new Error('The recording is longer than 2 hours.');
    const lang = LANGUAGES.includes(language) ? language : 'german';
    if (this.fake) return `fake transcript: ${(samples.length / 16000).toFixed(1)} s, ${lang}, ${model}`;
    const asr = await this.load(model, progress);
    const r = await asr(samples, { language: lang, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    return String((r && r.text) || '').trim();
  }
}

module.exports = { Speech, MODELS, LANGUAGES };
