// pdf.js wrapper: incremental loading over the sn:// protocol (HTTP range
// requests, so a 300 MB script opens instantly), a page-proxy LRU and a
// prioritised render queue shared by all open notebooks.
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { encodeRel } from './ui.js';

pdfjs.GlobalWorkerOptions.workerSrc = 'sn://app/pdf.worker.min.mjs';
export const Util = pdfjs.Util;

// ---------- render queue ----------
const MAX_CONCURRENT = 2;
const queue = [];
let running = 0;

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    queue.sort((a, b) => a.priority - b.priority);
    const task = queue.shift();
    if (task.cancelled) continue;
    running++;
    task.run().then(task.resolve, task.reject).finally(() => { running--; pump(); });
  }
}

function enqueue(priority, run) {
  let task;
  const promise = new Promise((resolve, reject) => {
    task = { priority, run, resolve, reject, cancelled: false, cancelInner: null };
  });
  task.cancel = () => {
    task.cancelled = true;
    if (task.cancelInner) task.cancelInner();
    task.reject(new CancelError());
  };
  queue.push(task);
  queue.length && setTimeout(pump, 0);
  return { promise, task };
}

export class CancelError extends Error {
  constructor() { super('cancelled'); this.cancelled = true; }
}

export function isCancel(e) {
  return e && (e.cancelled || e.name === 'RenderingCancelledException' || /cancel/i.test(e.message || ''));
}

// ---------- document ----------
export class PdfDoc {
  // `file` is relative to the notebook folder (source.pdf, sources/<id>.pdf).
  static async open(rel, file = 'source.pdf', onProgress) {
    const task = pdfjs.getDocument({
      url: `sn://lib/${encodeRel(rel)}/${file.split('/').map(encodeURIComponent).join('/')}`,
      rangeChunkSize: 1 << 20,
      disableAutoFetch: true,
      cMapUrl: 'sn://app/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'sn://app/standard_fonts/',
      wasmUrl: 'sn://app/wasm/',
      iccUrl: 'sn://app/iccs/',
      isEvalSupported: false,
      enableXfa: false,
    });
    if (onProgress) task.onProgress = onProgress;
    const proxy = await task.promise;
    return new PdfDoc(proxy, task);
  }

  constructor(proxy, loadingTask) {
    this.proxy = proxy;
    this.loadingTask = loadingTask;
    this.numPages = proxy.numPages;
    this.pageCache = new Map(); // n -> Promise<PDFPageProxy>, insertion order = LRU
    this.destroyed = false;
  }

  getPage(n) {
    let p = this.pageCache.get(n);
    if (p) {
      this.pageCache.delete(n);
      this.pageCache.set(n, p);
      return p;
    }
    p = this.proxy.getPage(n);
    this.pageCache.set(n, p);
    while (this.pageCache.size > 16) {
      const [oldN, oldP] = this.pageCache.entries().next().value;
      this.pageCache.delete(oldN);
      oldP.then((pg) => pg.cleanup()).catch(() => {});
    }
    return p;
  }

  // Page sizes at scale 1 with /Rotate applied (what the user sees).
  async pageSizes(onEach) {
    // Requests are batched: the worker answers them back to back instead of
    // paying one message round trip per page.
    const out = new Array(this.numPages);
    const BATCH = 64;
    for (let start = 1; start <= this.numPages; start += BATCH) {
      const end = Math.min(this.numPages, start + BATCH - 1);
      const jobs = [];
      for (let n = start; n <= end; n++) {
        jobs.push(this.proxy.getPage(n).then((page) => {
          const vp = page.getViewport({ scale: 1 });
          out[n - 1] = { w: Math.round(vp.width * 100) / 100, h: Math.round(vp.height * 100) / 100 };
          page.cleanup();
        }));
      }
      await Promise.all(jobs);
      if (onEach) onEach(end, this.numPages);
    }
    return out;
  }

  /**
   * Render page n at `scale` into a new canvas. Lower priority runs first.
   * Returns { promise, cancel }.
   */
  render(n, scale, priority = 0, rotate = 0) {
    const { promise, task } = enqueue(priority, async () => {
      if (this.destroyed) throw new CancelError();
      const page = await this.getPage(n);
      if (task.cancelled) throw new CancelError();
      const vp = page.getViewport({ scale, rotation: (page.rotate + rotate) % 360 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const rt = page.render({ canvas, canvasContext: ctx, viewport: vp, background: '#ffffff' });
      task.cancelInner = () => rt.cancel();
      try {
        await rt.promise;
      } catch (err) {
        canvas.width = canvas.height = 0; // free immediately, don't wait for GC
        throw err;
      }
      if (task.cancelled) { canvas.width = canvas.height = 0; throw new CancelError(); }
      return canvas;
    });
    return { promise, cancel: task.cancel, setPriority: (pr) => { task.priority = pr; } };
  }

  async textContent(n) {
    const page = await this.getPage(n);
    return page.getTextContent();
  }

  async pageText(n) {
    const tc = await this.textContent(n);
    let s = '';
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      s += it.str;
      s += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : '');
    }
    return s;
  }

  // rotate: the user's extra rotation of the page (0 / 90 / 180 / 270).
  async viewport(n, scale = 1, rotate = 0) {
    const page = await this.getPage(n);
    return page.getViewport({ scale, rotation: (page.rotate + rotate) % 360 });
  }

  destroy() {
    this.destroyed = true; // queued tasks for this doc fail fast
    this.loadingTask.destroy();
  }
}
