'use strict';
// AI providers for 1.9 (docs/ROADMAP-1.9.md): Anthropic, OpenAI, Google Gemini
// with the user's API key, or a local OpenAI-compatible server (Ollama, LM
// Studio). Runs in the main process only: keys never reach the renderer, an
// extension or a log. Keys are encrypted with the system's key store
// (Electron safeStorage, Windows DPAPI). Every request is counted for the
// monthly limit and logged without its content.

const fsp = require('fs').promises;
const path = require('path');

const PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', key: true, base: 'https://api.anthropic.com' },
  openai: { name: 'OpenAI (GPT)', key: true, base: 'https://api.openai.com' },
  gemini: { name: 'Google (Gemini)', key: true, base: 'https://generativelanguage.googleapis.com' },
  local: { name: 'Local model (Ollama, LM Studio)', key: false, base: 'http://localhost:11434/v1' },
};

const TIMEOUT = 180000;

class Ai {
  /** dir: where keys and the log are kept; safeStorage: Electron's (or a fake in tests) */
  constructor({ dir, safeStorage, fetchImpl = globalThis.fetch }) {
    this.dir = dir;
    this.safe = safeStorage;
    this.fetch = fetchImpl;
  }

  keyFile() { return path.join(this.dir, 'ai-keys.json'); }
  logFile() { return path.join(this.dir, 'ai-log.json'); }

  async readKeys() { try { return JSON.parse(await fsp.readFile(this.keyFile(), 'utf8')); } catch { return {}; } }

  async hasKey(provider) { return !!(await this.readKeys())[provider]; }

  async setKey(provider, key) {
    if (!PROVIDERS[provider] || !PROVIDERS[provider].key) throw new Error('Unknown provider');
    const keys = await this.readKeys();
    if (!key) delete keys[provider];
    else {
      if (!this.safe || !this.safe.isEncryptionAvailable()) throw new Error('This computer has no secure key store, so the key was not saved.');
      keys[provider] = this.safe.encryptString(String(key).trim()).toString('base64');
    }
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.keyFile(), JSON.stringify(keys));
  }

  async key(provider) {
    const enc = (await this.readKeys())[provider];
    if (!enc) return null;
    try { return this.safe.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
  }

  async readLog() { try { return JSON.parse(await fsp.readFile(this.logFile(), 'utf8')); } catch { return []; } }

  async usedThisMonth(now = new Date()) {
    const month = now.toISOString().slice(0, 7);
    return (await this.readLog()).filter((e) => e.at.slice(0, 7) === month).length;
  }

  async log(entry) {
    const log = (await this.readLog()).concat([{ at: new Date().toISOString(), ...entry }]).slice(-500);
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.logFile(), JSON.stringify(log));
  }

  base(cfg) {
    const p = PROVIDERS[cfg.provider];
    if (!p) throw new Error('Choose an AI provider in Settings → AI.');
    if (cfg.provider === 'local') {
      const b = String(cfg.baseUrl || p.base).replace(/\/+$/, '');
      // a local model stays on this computer (or the user's own network)
      if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?(\/|$)/i.test(b)) throw new Error('A local model must run on this computer or in your own network (for example http://localhost:11434/v1).');
      return b;
    }
    return p.base;
  }

  async headers(cfg) {
    const h = { 'content-type': 'application/json' };
    if (!PROVIDERS[cfg.provider].key) return h;
    const key = await this.key(cfg.provider);
    if (!key) throw new Error(`No API key for ${PROVIDERS[cfg.provider].name}. Add it in Settings → AI.`);
    if (cfg.provider === 'anthropic') Object.assign(h, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
    else if (cfg.provider === 'openai') h.authorization = `Bearer ${key}`;
    else if (cfg.provider === 'gemini') h['x-goog-api-key'] = key;
    return h;
  }

  async call(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    let res;
    try { res = await this.fetch(url, { ...init, signal: ctrl.signal }); } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'The AI did not answer in time.' : `The AI service could not be reached (${err.cause && err.cause.code || err.message}).`);
    } finally { clearTimeout(timer); }
    const body = await res.text();
    let json = null;
    try { json = JSON.parse(body); } catch { /* not JSON */ }
    if (!res.ok) {
      const msg = (json && (json.error && (json.error.message || json.error) || json.message)) || body.slice(0, 200);
      if (res.status === 401 || res.status === 403) throw new Error('The API key was not accepted. Check it in Settings → AI.');
      if (res.status === 429) throw new Error('The AI service says: too many requests or no credit left. ' + String(msg).slice(0, 200));
      throw new Error(`The AI service answered with an error (${res.status}): ${String(msg).slice(0, 300)}`);
    }
    if (!json) throw new Error('The AI service sent an answer that is not JSON.');
    return json;
  }

  /** The models the provider offers (for the model picker). */
  async models(cfg) {
    const base = this.base(cfg);
    const h = await this.headers(cfg);
    if (cfg.provider === 'gemini') {
      const j = await this.call(`${base}/v1beta/models?pageSize=200`, { headers: h });
      return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
    }
    const j = await this.call(cfg.provider === 'local' ? `${base}/models` : `${base}/v1/models`, { headers: h });
    return (j.data || []).map((m) => m.id).filter(Boolean);
  }

  /**
   * request(cfg, { system, user, json = true }) -> { text, model, usage }
   * cfg: { provider, model, baseUrl, monthlyLimit }
   */
  async request(cfg, { system, user, json = true }) {
    const limit = Number(cfg.monthlyLimit) || 0;
    if (limit > 0 && (await this.usedThisMonth()) >= limit) throw new Error(`The monthly limit of ${limit} AI requests is reached (Settings → AI).`);
    if (!cfg.model) throw new Error('Choose a model in Settings → AI.');
    const base = this.base(cfg);
    const h = await this.headers(cfg);
    const chars = String(system).length + String(user).length;
    let text = '', usage = null;
    try {
      if (cfg.provider === 'anthropic') {
        const j = await this.call(`${base}/v1/messages`, { method: 'POST', headers: h, body: JSON.stringify({ model: cfg.model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }) });
        text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
        usage = j.usage || null;
      } else if (cfg.provider === 'gemini') {
        const j = await this.call(`${base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: 'POST', headers: h, body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
        }) });
        text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
        usage = j.usageMetadata || null;
      } else {
        const url = cfg.provider === 'local' ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
        const j = await this.call(url, { method: 'POST', headers: h, body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }) });
        text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        usage = j.usage || null;
      }
    } catch (err) {
      await this.log({ provider: cfg.provider, model: cfg.model, chars, ok: false }).catch(() => {});
      throw err;
    }
    await this.log({ provider: cfg.provider, model: cfg.model, chars, ok: true }).catch(() => {});
    if (!text.trim()) throw new Error('The AI sent an empty answer.');
    return { text, model: cfg.model, usage };
  }
}

module.exports = { Ai, PROVIDERS };
