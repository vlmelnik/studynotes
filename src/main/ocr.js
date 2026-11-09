'use strict';
// Text recognition (offline): Tesseract (WebAssembly) with language data for
// English, German and Russian. Since 1.7 the data comes with the app (scanned
// PDFs are made searchable right away); older installs could download it from
// the StudyNotes GitHub release into userData. Everything runs on this PC;
// nothing is sent anywhere.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const RELEASE = 'ocr-data-1';
const BASE_URL = `https://github.com/vlmelnik/studynotes/releases/download/${RELEASE}/`;
// tessdata "best_int" models (LSTM), gzip-compressed
const FILES = [
  { lang: 'eng', name: 'English', file: 'eng.traineddata.gz', size: 2952873, sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91' },
  { lang: 'deu', name: 'Deutsch', file: 'deu.traineddata.gz', size: 1333102, sha256: '306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b' },
  { lang: 'rus', name: 'Русский', file: 'rus.traineddata.gz', size: 2679598, sha256: 'f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a' },
];

class Ocr {
  /** @param {{ dir: string, fetch: Function, baseUrl?: string }} o */
  constructor({ dir, fetch, baseUrl, bundledDir = null }) {
    this.dir = dir;
    this.bundledDir = bundledDir; // the data that comes with the app
    this.fetch = fetch;
    this.baseUrl = baseUrl || BASE_URL;
    this.worker = null;
    this.workerLangs = '';
    this.idle = null;
    this.queue = Promise.resolve();
  }

  /** The folder with the language data: the app's own, else the downloaded one. */
  async dataDir() {
    for (const d of [this.bundledDir, this.dir].filter(Boolean)) {
      let all = true;
      for (const f of FILES) {
        const st = await fsp.stat(path.join(d, f.file)).catch(() => null);
        if (!st || st.size !== f.size) { all = false; break; }
      }
      if (all) return d;
    }
    return this.dir;
  }

  async installed() {
    const dir = await this.dataDir();
    const out = [];
    for (const f of FILES) {
      const st = await fsp.stat(path.join(dir, f.file)).catch(() => null);
      if (st && st.size === f.size) out.push(f.lang);
    }
    return out;
  }

  async status() {
    const langs = await this.installed();
    return {
      installed: langs.length === FILES.length,
      langs,
      builtIn: !!this.bundledDir && (await this.dataDir()) === this.bundledDir,
      files: FILES.map(({ lang, name, size }) => ({ lang, name, size })),
      size: FILES.reduce((a, f) => a + f.size, 0),
    };
  }

  /** Downloads the language data; onProgress(done, total). Checks every file's SHA-256. */
  async install(onProgress = () => {}) {
    await fsp.mkdir(this.dir, { recursive: true });
    const total = FILES.reduce((a, f) => a + f.size, 0);
    let done = 0;
    for (const f of FILES) {
      const dest = path.join(this.dir, f.file);
      const st = await fsp.stat(dest).catch(() => null);
      if (st && st.size === f.size) { done += f.size; onProgress(done, total); continue; }
      const res = await this.fetch(this.baseUrl + f.file);
      if (!res.ok) throw new Error(`Download failed (${res.status}) – check the internet connection`);
      const hash = crypto.createHash('sha256');
      const chunks = [];
      const reader = res.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        const buf = Buffer.from(value);
        hash.update(buf); chunks.push(buf);
        done += buf.length; onProgress(Math.min(done, total), total);
      }
      if (hash.digest('hex') !== f.sha256) throw new Error(`${f.file}: download damaged (checksum) – please try again`);
      const tmp = dest + '.part';
      await fsp.writeFile(tmp, Buffer.concat(chunks));
      await fsp.rename(tmp, dest);
    }
    onProgress(total, total);
    return this.status();
  }

  async remove() {
    await this.stop();
    for (const f of FILES) await fsp.rm(path.join(this.dir, f.file), { force: true });
    await fsp.rm(path.join(this.dir, 'cache'), { recursive: true, force: true });
    return this.status();
  }

  async getWorker(langs) {
    const key = langs.join('+');
    if (this.worker && this.workerLangs === key) return this.worker;
    await this.stop();
    const { createWorker } = require('tesseract.js');
    const cachePath = path.join(this.dir, 'cache');
    await fsp.mkdir(cachePath, { recursive: true });
    this.worker = await createWorker(langs, 1 /* LSTM */, { langPath: await this.dataDir(), cachePath, gzip: true, logger: () => {}, errorHandler: () => {} });
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
      if (!use.length) throw new Error('Text recognition is not installed (Settings → Add-ons)');
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

module.exports = { Ocr, FILES, RELEASE };
