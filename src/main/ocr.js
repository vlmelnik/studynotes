'use strict';
// Text recognition (offline): Tesseract (WebAssembly) with language data for
// English, German and Russian. The data comes with the app (scanned PDFs are
// made searchable right away). Everything runs on this PC; nothing is sent
// anywhere.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// tessdata "best_int" models (LSTM), gzip-compressed
const FILES = [
  { lang: 'eng', name: 'English', file: 'eng.traineddata.gz', size: 2952873 },
  { lang: 'deu', name: 'Deutsch', file: 'deu.traineddata.gz', size: 1333102 },
  { lang: 'rus', name: 'Русский', file: 'rus.traineddata.gz', size: 2679598 },
];

class Ocr {
  /**
   * @param {{ dir: string, bundledDir: string }} o  dir: the working folder
   *   (the reader's cache); bundledDir: the language data that comes with the app
   */
  constructor({ dir, bundledDir }) {
    this.dir = dir;
    this.bundledDir = bundledDir;
    this.worker = null;
    this.workerLangs = '';
    this.idle = null;
    this.queue = Promise.resolve();
  }

  /** The languages whose data is there (all three in a complete install). */
  async installed() {
    const out = [];
    for (const f of FILES) {
      const st = await fsp.stat(path.join(this.bundledDir, f.file)).catch(() => null);
      if (st && st.size === f.size) out.push(f.lang);
    }
    return out;
  }

  async status() {
    const langs = await this.installed();
    return { installed: langs.length === FILES.length, langs, files: FILES.map(({ lang, name, size }) => ({ lang, name, size })) };
  }

  /**
   * Language data downloaded by early 1.7 builds (now built in): removed once,
   * so it no longer takes room in the app data.
   */
  async forgetDownloaded() {
    for (const f of FILES) await fsp.rm(path.join(this.dir, f.file), { force: true }).catch(() => {});
  }

  async getWorker(langs) {
    const key = langs.join('+');
    if (this.worker && this.workerLangs === key) return this.worker;
    await this.stop();
    const { createWorker } = require('tesseract.js');
    const cachePath = path.join(this.dir, 'cache');
    await fsp.mkdir(cachePath, { recursive: true });
    this.worker = await createWorker(langs, 1 /* LSTM */, { langPath: this.bundledDir, cachePath, gzip: true, logger: () => {}, errorHandler: () => {} });
    this.workerLangs = key;
    return this.worker;
  }

  async stop() {
    clearTimeout(this.idle);
    const w = this.worker;
    this.worker = null; this.workerLangs = '';
    if (w) await w.terminate().catch(() => {});
  }

  /**
   * Recognises text in a PNG/JPEG image. Returns lines (pixel coordinates):
   * [{ text, conf, bbox:{x0,y0,x1,y1}, baseline:{x0,y0,x1,y1}, words:[{ text, conf, bbox }] }]
   */
  recognize(image, langs) {
    const run = async () => {
      clearTimeout(this.idle); // a job is running: don't free the worker under it
      const have = await this.installed();
      const use = (langs && langs.length ? langs : have).filter((l) => have.includes(l));
      if (!use.length) throw new Error('The text recognition data is missing – please reinstall StudyNotes');
      const w = await this.getWorker(use);
      const r = await w.recognize(Buffer.from(image), {}, { blocks: true, text: false });
      clearTimeout(this.idle);
      this.idle = setTimeout(() => this.stop(), 120000); // free the memory when not used
      const lines = [];
      for (const b of r.data.blocks || []) {
        for (const p of b.paragraphs || []) {
          for (const l of p.lines || []) {
            const text = (l.text || '').replace(/\s+$/, '');
            if (!text.trim()) continue;
            lines.push({
              text, conf: l.confidence, bbox: l.bbox, baseline: l.baseline,
              words: (l.words || []).map((wd) => ({ text: wd.text, conf: wd.confidence, bbox: wd.bbox })),
            });
          }
        }
      }
      return lines;
    };
    // one recognition at a time
    // never hang: a broken worker would otherwise leave the user waiting forever
    const guarded = () => {
      let timer;
      const job = run();
      const timeout = new Promise((_, rej) => {
        timer = setTimeout(() => { this.stop(); rej(new Error('Text recognition did not answer – please try again')); }, 180000);
      });
      return Promise.race([job, timeout]).finally(() => clearTimeout(timer));
    };
    const p = this.queue.then(guarded, guarded);
    this.queue = p.catch(() => {});
    return p;
  }
}

module.exports = { Ocr, FILES };
