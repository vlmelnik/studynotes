'use strict';
// Offline background removal ("Hintergrund entfernen").
//
// Model:   ISNet / DIS "isnet-general-use" (Apache-2.0, https://github.com/xuebinqin/DIS),
//          ONNX export from rembg (MIT), weights stored as per-channel int8 + DequantizeLinear
//          (assets/models/isnet-general-use-int8.onnx, ~45 MB). Runs in fp32 after load.
// Runtime: onnxruntime-node (MIT), CPU execution provider.
//
// Everything except decodeImage()/capSize() is pure Node (unit-testable without Electron).
// decodeImage() uses Electron's nativeImage when available (PNG + JPEG), else a built-in
// PNG decoder. Inference, mask resize, compositing and PNG encoding run in a worker thread.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const MODEL_FILE = 'isnet-general-use-int8.onnx';
const MODEL_SIZE = 1024;           // ISNet input is fixed 1x3x1024x1024
const MEAN = [0.5, 0.5, 0.5];      // rembg "isnet-general-use" normalisation
const STD = [1.0, 1.0, 1.0];
const DEFAULT_MAX_SIDE = 4096;     // output/working resolution cap (longest side)

let ort = null;
let sessionPromise = null;
let queue = Promise.resolve();     // serialise inference: one run at a time

function modelPath() {
  if (process.env.STUDYNOTES_BG_MODEL) return process.env.STUDYNOTES_BG_MODEL;
  const p = path.join(__dirname, '..', '..', 'assets', 'models', MODEL_FILE);
  // Packaged app: the model is asarUnpack'ed; native code / workers read it from disk.
  const unpacked = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (unpacked !== p && fs.existsSync(unpacked)) return unpacked;
  return p;
}

// In-thread session (used inside the worker, or directly via computeMask()).
function loadSession(file) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      if (!ort) {
        try {
          ort = require('onnxruntime-node');
        } catch (e) {
          // On Windows onnxruntime.dll needs the MSVC runtime (MSVCP140.dll, VCRUNTIME140(_1).dll,
          // MSVCP140_ATOMIC_WAIT.dll) — normally present via the VC++ 2015-2022 Redistributable.
          if (process.platform === 'win32') e.message += ' (is the Microsoft Visual C++ 2015-2022 Redistributable x64 installed?)';
          throw e;
        }
      }
      const bytes = await fs.promises.readFile(file || modelPath());
      return ort.InferenceSession.create(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        // Inside Electron, ORT's CPU arena / memory-pattern planner leads to a hard crash
        // (SIGTRAP, PartitionAlloc) on the 2nd run once V8 GCs. Plain malloc per run is
        // just as fast for this model and stable.
        enableCpuMemArena: false,
        enableMemPattern: false,
        // Weights are stored as int8 + DequantizeLinear. Disabling QDQ fusion lets the
        // constant folder dequantise them once at load, so inference runs in plain fp32.
        extra: { session: { disable_quant_qdq: '1' } },
      });
    })();
    sessionPromise.catch(() => { sessionPromise = null; }); // allow retry after a failure
  }
  return sessionPromise;
}

// ------------------------------------------------------------- worker thread
// onnxruntime-node's session.run() is synchronous (≈2 s), so it must not run on the
// Electron main thread. All heavy work happens in one persistent worker thread.

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  const w = new Worker(__filename, { workerData: { bgremoveWorker: true, modelPath: modelPath() } });
  worker = w;
  w.unref();
  w.on('message', (msg) => {
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    if (pending.size === 0) w.unref();
    if (msg.error) job.reject(Object.assign(new Error(msg.error), { stack: msg.stack }));
    else job.resolve(msg.result);
  });
  const fail = (err) => {
    if (worker !== w) return; // already replaced (dispose)
    worker = null;
    for (const job of pending.values()) job.reject(err);
    pending.clear();
  };
  w.on('error', fail);
  w.on('exit', (code) => fail(new Error('bgremove worker exited with code ' + code)));
  return w;
}

function callWorker(op, args, transfer) {
  const w = getWorker();
  const id = nextId++;
  const entry = {};
  entry.promise = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
  });
  pending.set(id, entry);
  w.ref();
  w.postMessage({ id, op, args }, transfer || []);
  return entry.promise;
}

if (!isMainThread && workerData && workerData.bgremoveWorker) {
  parentPort.on('message', async ({ id, op, args }) => {
    try {
      let result;
      if (op === 'warmup') { await loadSession(workerData.modelPath); result = true; }
      else if (op === 'rgbaToPng') {
        await loadSession(workerData.modelPath);
        const { data, width, height, opts } = args;
        const out = await removeBackgroundRGBAInThread({ data: Buffer.from(data.buffer, data.byteOffset, data.length), width, height }, opts);
        const png = encodePNG(out.data, out.width, out.height);
        const ab = png.buffer.slice(png.byteOffset, png.byteOffset + png.length);
        parentPort.postMessage({ id, result: ab }, [ab]);
        return;
      } else throw new Error('unknown op ' + op);
      parentPort.postMessage({ id, result });
    } catch (e) {
      parentPort.postMessage({ id, error: String(e && e.message || e), stack: e && e.stack });
    }
  });
}

/** Load the model once in the worker (cached). Safe to call repeatedly / concurrently. */
async function warmup() {
  await callWorker('warmup', {});
}

/** Terminate the worker (e.g. on app quit). The next call starts a new one. */
async function dispose() {
  if (!worker) return;
  // Let a running inference finish first (killing the thread inside native
  // onnxruntime code can crash the process on exit); give up after 8 s.
  if (pending.size) {
    await Promise.race([
      Promise.allSettled([...pending.values()].map((j) => j.promise).filter(Boolean)),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
  }
  if (!worker) return;
  const w = worker;
  worker = null;
  for (const job of pending.values()) job.reject(new Error('bgremove: disposed'));
  pending.clear();
  await w.terminate();
}

// ---------------------------------------------------------------- resampling

// Resize RGBA (Uint8) to CHW float tensor of size S x S, area-averaging when downscaling,
// bilinear when upscaling. Normalises like rembg: x / max(x), then (x - mean) / std.
function toInputTensor(rgba, w, h, S) {
  const plane = S * S;
  const out = new Float32Array(3 * plane);
  const sx = w / S, sy = h / S;
  let maxV = 0;
  if (sx >= 1 && sy >= 1) {
    // box filter over the source footprint of each target pixel
    for (let ty = 0; ty < S; ty++) {
      const y0 = ty * sy, y1 = y0 + sy;
      const iy0 = Math.floor(y0), iy1 = Math.min(h, Math.ceil(y1));
      for (let tx = 0; tx < S; tx++) {
        const x0 = tx * sx, x1 = x0 + sx;
        const ix0 = Math.floor(x0), ix1 = Math.min(w, Math.ceil(x1));
        let r = 0, g = 0, b = 0, wsum = 0;
        for (let y = iy0; y < iy1; y++) {
          const wy = Math.min(y + 1, y1) - Math.max(y, y0);
          let row = (y * w + ix0) * 4;
          for (let x = ix0; x < ix1; x++, row += 4) {
            const wt = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
            r += rgba[row] * wt; g += rgba[row + 1] * wt; b += rgba[row + 2] * wt; wsum += wt;
          }
        }
        const i = ty * S + tx;
        r /= wsum; g /= wsum; b /= wsum;
        out[i] = r; out[plane + i] = g; out[2 * plane + i] = b;
        if (r > maxV) maxV = r; if (g > maxV) maxV = g; if (b > maxV) maxV = b;
      }
    }
  } else {
    for (let ty = 0; ty < S; ty++) {
      const fy = Math.min(h - 1, Math.max(0, (ty + 0.5) * sy - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), dy = fy - y0;
      for (let tx = 0; tx < S; tx++) {
        const fx = Math.min(w - 1, Math.max(0, (tx + 0.5) * sx - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), dx = fx - x0;
        const a = (y0 * w + x0) * 4, b2 = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
        const i = ty * S + tx;
        for (let ch = 0; ch < 3; ch++) {
          const v = (rgba[a + ch] * (1 - dx) + rgba[b2 + ch] * dx) * (1 - dy) +
                    (rgba[c + ch] * (1 - dx) + rgba[d + ch] * dx) * dy;
          out[ch * plane + i] = v;
          if (v > maxV) maxV = v;
        }
      }
    }
  }
  const inv = 1 / Math.max(maxV, 1e-6);
  for (let ch = 0; ch < 3; ch++) {
    const m = MEAN[ch], s = STD[ch], o = ch * plane;
    for (let i = 0; i < plane; i++) out[o + i] = (out[o + i] * inv - m) / s;
  }
  return out;
}

// Bilinear resize of a single-channel float mask (S x S) to w x h, returns Uint8 alpha.
function resizeMask(mask, S, w, h, lo, hi) {
  const alpha = new Uint8Array(w * h);
  const sx = S / w, sy = S / h;
  const span = Math.max(hi - lo, 1e-6);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(S - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(S - 1, y0 + 1), dy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(S - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(S - 1, x0 + 1), dx = fx - x0;
      const v = (mask[y0 * S + x0] * (1 - dx) + mask[y0 * S + x1] * dx) * (1 - dy) +
                (mask[y1 * S + x0] * (1 - dx) + mask[y1 * S + x1] * dx) * dy;
      let a = (v - lo) / span;
      a = a <= 0 ? 0 : a >= 1 ? 1 : a;
      alpha[y * w + x] = Math.round(a * 255);
    }
  }
  return alpha;
}

// --------------------------------------------------------------------- core

/**
 * Run the model on an RGBA image and return the foreground alpha mask at full size.
 * @param {Uint8Array|Buffer} rgba  width*height*4 bytes, RGBA, non-premultiplied
 * @returns {Promise<Uint8Array>} width*height alpha values (0 = background, 255 = foreground)
 */
async function computeMask(rgba, width, height, opts = {}) {
  if (!(width > 0 && height > 0) || rgba.length < width * height * 4) throw new Error('bgremove: bad image size');
  const session = await loadSession();
  const input = toInputTensor(rgba, width, height, MODEL_SIZE);
  const run = queue.then(() => session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]),
  }));
  queue = run.catch(() => {});
  const result = await run;
  const pred = result[session.outputNames[0]].data; // sigmoid output, 1x1x1024x1024
  // rembg-style min/max normalisation, then a light clamp of the extremes to remove
  // faint haze in the background and pin solid foreground to 255.
  let mi = Infinity, ma = -Infinity;
  for (let i = 0; i < pred.length; i++) { const v = pred[i]; if (v < mi) mi = v; if (v > ma) ma = v; }
  const refine = opts.refine !== false;
  const lo = refine ? 0.04 : 0, hi = refine ? 0.96 : 1;
  const span = Math.max(ma - mi, 1e-6);
  return resizeMask(pred, MODEL_SIZE, width, height, mi + lo * span, mi + hi * span);
}

// Apply the mask in the current thread.
async function removeBackgroundRGBAInThread(img, opts = {}) {
  const { width, height } = img;
  const src = img.data;
  const alpha = await computeMask(src, width, height, opts);
  const data = Buffer.allocUnsafe(width * height * 4);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const a = (alpha[i] * src[p + 3] + 127) / 255 | 0; // keep existing transparency
    if (a === 0) { data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0; continue; }
    data[p] = src[p]; data[p + 1] = src[p + 1]; data[p + 2] = src[p + 2]; data[p + 3] = a;
  }
  return { data, width, height };
}

/**
 * Remove the background of a raw RGBA image (runs in the worker thread).
 * @param {{data: Uint8Array|Buffer, width: number, height: number}} img RGBA, 8 bit, non-premultiplied
 * @param {{refine?: boolean}} [opts]
 * @returns {Promise<Buffer>} PNG (RGBA) with transparent background, same size as img
 */
async function removeBackgroundRGBA(img, opts = {}) {
  const { width, height } = img;
  if (!(width > 0 && height > 0) || img.data.length < width * height * 4) throw new Error('bgremove: bad image size');
  const copy = new Uint8Array(width * height * 4);
  copy.set(img.data.subarray(0, width * height * 4));
  const ab = await callWorker('rgbaToPng', { data: copy, width, height, opts: { refine: opts.refine } }, [copy.buffer]);
  return Buffer.from(ab);
}

/**
 * Remove the background of an encoded image.
 * @param {Buffer|Uint8Array} inputBytes PNG or JPEG (in Electron via nativeImage; PNG only in plain Node)
 * @param {{maxSide?: number, refine?: boolean}} [opts] maxSide: cap longest side (default 4096)
 * @returns {Promise<Buffer>} PNG (RGBA, 8 bit) with transparent background
 */
async function removeBackground(inputBytes, opts = {}) {
  let img = decodeImage(Buffer.from(inputBytes.buffer, inputBytes.byteOffset, inputBytes.length));
  img = capSize(img, opts.maxSide || DEFAULT_MAX_SIDE);
  return removeBackgroundRGBA(img, opts);
}

// ------------------------------------------------------------------ decoding

function isPNG(b) { return b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a; }

let electronNativeImage; // undefined = not looked up yet, null = not available
function getNativeImage() {
  if (electronNativeImage === undefined) {
    electronNativeImage = null;
    if (process.versions.electron) {
      try { electronNativeImage = require('electron').nativeImage || null; } catch { /* plain node */ }
    }
  }
  return electronNativeImage;
}

/** Decode PNG/JPEG to RGBA. Uses Electron nativeImage if available, else built-in PNG decoder. */
function decodeImage(buf) {
  const ni = getNativeImage();
  if (ni) {
    const im = ni.createFromBuffer(buf);
    if (!im.isEmpty()) {
      const { width, height } = im.getSize();
      return { data: bgraPremulToRGBA(im.toBitmap()), width, height };
    }
    if (!isPNG(buf)) throw new Error('bgremove: unsupported image format');
  }
  if (isPNG(buf)) return decodePNG(buf);
  throw new Error('bgremove: unsupported image format (PNG only outside Electron)');
}

// nativeImage.toBitmap() is Skia N32: BGRA, premultiplied alpha.
function bgraPremulToRGBA(bgra) {
  const out = Buffer.allocUnsafe(bgra.length);
  for (let p = 0; p < bgra.length; p += 4) {
    const a = bgra[p + 3];
    let r = bgra[p + 2], g = bgra[p + 1], b = bgra[p];
    if (a !== 255 && a !== 0) {
      r = Math.min(255, Math.round(r * 255 / a));
      g = Math.min(255, Math.round(g * 255 / a));
      b = Math.min(255, Math.round(b * 255 / a));
    }
    out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = a;
  }
  return out;
}

function capSize(img, maxSide) {
  const { width: w, height: h } = img;
  const s = Math.max(w, h);
  if (s <= maxSide) return img;
  const k = maxSide / s;
  const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
  const ni = getNativeImage();
  if (ni) {
    // fast native resize; go through BGRA bitmap
    const src = img.data, bgra = Buffer.allocUnsafe(src.length);
    for (let p = 0; p < src.length; p += 4) {
      const a = src[p + 3];
      bgra[p] = src[p + 2] * a / 255 | 0; bgra[p + 1] = src[p + 1] * a / 255 | 0;
      bgra[p + 2] = src[p] * a / 255 | 0; bgra[p + 3] = a;
    }
    const r = ni.createFromBitmap(bgra, { width: w, height: h }).resize({ width: nw, height: nh, quality: 'best' });
    const sz = r.getSize();
    return { data: bgraPremulToRGBA(r.toBitmap()), width: sz.width, height: sz.height };
  }
  // pure-JS box downscale
  const data = Buffer.alloc(nw * nh * 4);
  const sx = w / nw, sy = h / nh;
  for (let ty = 0; ty < nh; ty++) {
    const y0 = Math.floor(ty * sy), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((ty + 1) * sy)));
    for (let tx = 0; tx < nw; tx++) {
      const x0 = Math.floor(tx * sx), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((tx + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = (y * w + x) * 4; r += img.data[p]; g += img.data[p + 1]; b += img.data[p + 2]; a += img.data[p + 3]; n++;
      }
      const q = (ty * nw + tx) * 4;
      data[q] = r / n; data[q + 1] = g / n; data[q + 2] = b / n; data[q + 3] = a / n;
    }
  }
  return { data, width: nw, height: nh };
}

// Minimal PNG decoder: 8/16-bit, colour types 0/2/3/4/6, non-interlaced and Adam7.
function decodePNG(buf) {
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') palette = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!chans || !width || !height) throw new Error('bgremove: invalid PNG');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (chans * depth) >> 3);
  const out = Buffer.alloc(width * height * 4);
  const maxv = (1 << depth) - 1;
  let rp = 0;
  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  for (const [ox, oy, dx, dy] of passes) {
    const pw = Math.ceil((width - ox) / dx), ph = Math.ceil((height - oy) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * chans * depth) / 8);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[rp++];
      const line = Buffer.from(raw.subarray(rp, rp + stride)); rp += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        line[i] = v & 255;
      }
      prev = line;
      const sample = (idx) => {
        if (depth === 8) return line[idx];
        if (depth === 16) return line[idx * 2];
        const bit = idx * depth; return (line[bit >> 3] >> (8 - depth - (bit & 7))) & maxv;
      };
      const scale8 = (v) => depth >= 8 ? v : Math.round(v * 255 / maxv);
      for (let x = 0; x < pw; x++) {
        const o = (((oy + y * dy) * width) + ox + x * dx) * 4, s = x * chans;
        let r, g, b, a = 255;
        if (ctype === 3) {
          const i = sample(s); r = palette[i * 3]; g = palette[i * 3 + 1]; b = palette[i * 3 + 2];
          if (trns && i < trns.length) a = trns[i];
        } else if (ctype === 0 || ctype === 4) {
          r = g = b = scale8(sample(s));
          if (ctype === 4) a = scale8(sample(s + 1));
          else if (trns && depth <= 8 && sample(s) === trns.readUInt16BE(0)) a = 0;
        } else {
          r = sample(s); g = sample(s + 1); b = sample(s + 2);
          if (ctype === 6) a = sample(s + 3);
        }
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
      }
    }
  }
  return { data: out, width, height };
}

// ------------------------------------------------------------------ encoding

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA (8 bit, non-premultiplied) as PNG. */
function encodePNG(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // filter "Up" (2) compresses photos noticeably better than "None" and is cheap
    const o = y * (stride + 1), s = y * stride;
    raw[o] = 2;
    if (y === 0) raw.set(rgba.subarray(s, s + stride), o + 1);
    else for (let i = 0; i < stride; i++) raw[o + 1 + i] = (rgba[s + i] - rgba[s - stride + i]) & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = {
  removeBackground,
  removeBackgroundRGBA,
  warmup,
  dispose,
  computeMask, // in-thread (blocks ~2 s): only for tests / worker use
  decodeImage,
  decodePNG,
  encodePNG,
  MODEL_FILE,
  _modelPath: modelPath,
};
