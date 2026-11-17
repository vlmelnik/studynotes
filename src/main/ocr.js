'use strict';
// Text recognition (offline): Tesseract (WebAssembly) with language data for
// English, German and Russian. The data comes with the app (scanned PDFs are
// made searchable right away). Everything runs on this PC; nothing is sent
// anywhere.

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

// tessdata "best_int" models (LSTM), gzip-compressed
const FILES = [
  { lang: 'eng', name: 'English', file: 'eng.traineddata.gz', size: 2952873 },
  { lang: 'deu', name: 'Deutsch', file: 'deu.traineddata.gz', size: 1333102 },
  { lang: 'rus', name: 'Русский', file: 'rus.traineddata.gz', size: 2679598 },
];

// One reader with the three languages holds 100–140 MB (measured: 176 MB
// for the process with one, 268 with two, 441 with four).
const READER_BYTES = 150e6;
const MAX_READERS = 8;
/**
 * How many readers to run side by side: one core is left for the app, the
 * readers together take at most 40 % of the memory that is free right now,
 * eight at most (a page rarely has more blocks waiting than that can use),
 * and one always.
 */
function readerCount(cores, freeBytes) {
  const byCores = (cores || 1) - 1;
  const byMemory = Math.floor(((freeBytes || 0) * 0.4) / READER_BYTES);
  return Math.max(1, Math.min(MAX_READERS, byCores, byMemory));
}

class Ocr {
  /**
   * @param {{ dir: string, bundledDir: string }} o  dir: the working folder
   *   (the reader's cache); bundledDir: the language data that comes with the app
   */
  constructor({ dir, bundledDir, maxWorkers, createWorker }) {
    this.dir = dir;
    this.bundledDir = bundledDir;
    // several readers at once (the blocks of a page are read side by side):
    // as many as this computer carries – see readerCount
    this.max = maxWorkers ? Math.max(1, Math.min(MAX_READERS, maxWorkers)) : readerCount(os.availableParallelism ? os.availableParallelism() : os.cpus().length, os.freemem());
    this.make = createWorker || null; // (tests: a stand-in for the real reader)
    this.workers = []; // [{ w, busy }]
    this.starting = 0;
    this.langsKey = '';
    this.jobs = []; // waiting: [{ image, use, key, resolve, reject }]
    this.order = Promise.resolve();
    this.idle = null;
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
    return { installed: langs.length === FILES.length, langs, workers: this.max, files: FILES.map(({ lang, name, size }) => ({ lang, name, size })) };
  }

  /**
   * Language data downloaded by early 1.7 builds (now built in): removed once,
   * so it no longer takes room in the app data.
   */
  async forgetDownloaded() {
    if (path.resolve(this.dir) === path.resolve(this.bundledDir)) return; // (never the app's own data)
    for (const f of FILES) await fsp.rm(path.join(this.dir, f.file + '.part'), { force: true }).catch(() => {});
    for (const f of FILES) await fsp.rm(path.join(this.dir, f.file), { force: true }).catch(() => {});
  }

  async newWorker(langs) {
    if (this.make) return this.make(langs);
    const { createWorker } = require('tesseract.js');
    const cachePath = path.join(this.dir, 'cache');
    await fsp.mkdir(cachePath, { recursive: true });
    return createWorker(langs, 1 /* LSTM */, { langPath: this.bundledDir, cachePath, gzip: true, logger: () => {}, errorHandler: () => {} });
  }

  /** Ends all readers (their memory is freed); waiting jobs are kept. */
  async stop() {
    clearTimeout(this.idle);
    const ws = this.workers;
    this.workers = []; this.langsKey = '';
    await Promise.all(ws.map((x) => x.w.terminate().catch(() => {})));
  }

  /**
   * Recognises text in a PNG/JPEG image. Returns lines (pixel coordinates):
   * [{ text, conf, bbox:{x0,y0,x1,y1}, baseline:{x0,y0,x1,y1}, words:[{ text, conf, bbox }] }]
   * Calls made at the same time run side by side on up to `max` readers; a
   * second and third reader are only started when jobs are waiting.
   */
  recognize(image, langs) {
    // (queued in the order of the calls, whatever the file checks take)
    const queued = this.order.then(() => this.installed()).then((have) => {
      const use = (langs && langs.length ? langs : have).filter((l) => have.includes(l));
      if (!use.length) throw new Error('The text recognition data is missing – please reinstall StudyNotes');
      let resolve, reject;
      const result = new Promise((a, b) => { resolve = a; reject = b; });
      this.jobs.push({ image, use, key: use.join('+'), resolve, reject });
      this.pump();
      return { result };
    });
    this.order = queued.then(() => {}, () => {});
    return queued.then((q) => q.result);
  }

  /** Gives waiting jobs to free readers, starting readers as needed. */
  pump() {
    clearTimeout(this.idle);
    while (this.jobs.length) {
      // jobs in the languages the readers have loaded go first: switching
      // languages means starting the readers anew
      let at = this.langsKey ? this.jobs.findIndex((jb) => jb.key === this.langsKey) : 0;
      if (at < 0) {
        // only other languages are waiting: when the readers are done,
        // start over with the new ones
        if (this.workers.some((x) => x.busy) || this.starting > 0) return;
        const old = this.workers;
        this.workers = [];
        old.forEach((x) => x.w.terminate().catch(() => {}));
        at = 0;
      }
      const key = this.jobs[at].key;
      this.langsKey = key;
      const free = this.workers.find((x) => !x.busy);
      if (free) { this.run(free, this.jobs.splice(at, 1)[0]); continue; }
      // every reader is busy: one more, while there are fewer than allowed
      // and no more being started than jobs waiting
      if (this.workers.length + this.starting < this.max && this.starting < this.jobs.filter((jb) => jb.key === key).length) {
        this.starting++;
        this.newWorker(this.jobs[at].use).then(
          (w) => { this.starting--; if (this.langsKey === key) this.workers.push({ w, busy: false }); else w.terminate().catch(() => {}); this.pump(); },
          (err) => { this.starting--; const k = this.jobs.findIndex((jb) => jb.key === key); if (k >= 0) this.jobs.splice(k, 1)[0].reject(err); this.pump(); },
        );
        continue;
      }
      return;
    }
    // nothing to do: free the memory after a while
    if (!this.workers.some((x) => x.busy) && !this.starting) {
      this.idle = setTimeout(() => this.stop(), 120000);
      if (this.idle.unref) this.idle.unref(); // (never keeps the process alive)
    }
  }

  run(slot, job) {
    slot.busy = true;
    // never hang: a broken reader would otherwise leave the user waiting forever
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => {
        this.workers = this.workers.filter((x) => x !== slot);
        slot.w.terminate().catch(() => {});
        rej(new Error('Text recognition did not answer – please try again'));
      }, 180000);
    });
    const read = slot.w.recognize(Buffer.from(job.image), {}, { blocks: true, text: false }).then((r) => {
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
    });
    // (the reader is free again before the caller goes on)
    const done = (fn) => (v) => { clearTimeout(timer); slot.busy = false; this.pump(); fn(v); };
    Promise.race([read, timeout]).then(done(job.resolve), done(job.reject));
  }
}

module.exports = { readerCount, Ocr, FILES };
