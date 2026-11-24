// Audio for the chat: decoded here (Chromium reads mp3, wav, m4a, ogg, webm …)
// to 16 kHz mono and turned into text on this computer (src/main/speech.js).
const listeners = new Map();
if (window.api && window.api.onSpeechProgress) window.api.onSpeechProgress((id, f, file) => { const cb = listeners.get(id); if (cb) cb(f, file); });

export function speechSettings(settings) {
  const lang = { de: 'german', ru: 'russian' }[settings.lang] || 'english';
  return { enabled: false, model: 'base', language: lang, ...(settings.speech || {}) };
}

export async function decodeAudio(bytes) {
  const ctx = new AudioContext();
  let buf;
  try { buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); } finally { ctx.close(); }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

/** progress(0..1) while the model downloads (first time only) */
export function withProgress(fn, progress) {
  const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (progress) listeners.set(id, progress);
  return fn(id).finally(() => listeners.delete(id));
}

export async function transcribe(bytes, cfg, progress) {
  const samples = await decodeAudio(bytes);
  return withProgress((id) => window.api.speechTranscribe(samples, { model: cfg.model, language: cfg.language }, id), progress);
}
