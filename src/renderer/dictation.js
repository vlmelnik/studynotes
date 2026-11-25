// Dictation: the microphone, cut into phrases at the pauses, each phrase
// turned into text on this computer (Whisper, src/main/speech.js) while you
// keep talking – text comes phrase by phrase, about a second after each pause.
// The popover under a mic button picks the language and the model and
// downloads the model the first time.
import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { t as tr } from './i18n.js';
import { speechSettings, withProgress } from './speech.js';
import { phrases } from '../shared/vad.js';

const NAMES = { german: 'German', english: 'English', russian: 'Russian', french: 'French', spanish: 'Spanish', italian: 'Italian', ukrainian: 'Ukrainian', polish: 'Polish', turkish: 'Turkish' };
// what Whisper "hears" in silence or noise – never typed
const NOISE = /^[\s.,!?…-]*$|^\(.*\)$|^\[.*\]$|untertitel|subtitles by|thank(s| you) for watching|продолжение следует|субтитры/i;

class Dictation {
  constructor() { this.on = false; }

  async start({ settings, onText, onState }) {
    if (this.on) return;
    this.cfg = speechSettings(settings);
    this.onText = onText;
    this.onState = onState || (() => {});
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const src = this.ctx.createMediaStreamSource(this.stream);
    // (ScriptProcessor: no worklet file to load under the app's content policy)
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.cut = phrases({ rate: 16000 });
    this.queue = Promise.resolve();
    proc.onaudioprocess = (e) => {
      const frame = new Float32Array(e.inputBuffer.getChannelData(0));
      const r = this.cut.push(frame);
      this.onState({ level: r.level, speaking: r.speaking });
      for (const seg of r.done) this.transcribe(seg);
    };
    src.connect(proc);
    proc.connect(this.ctx.destination);
    this.proc = proc;
    this.on = true;
    this.onState({ on: true });
  }

  transcribe(samples) {
    this.queue = this.queue.then(async () => {
      this.onState({ busy: true });
      try {
        const text = (await window.api.speechTranscribe(samples, { model: this.cfg.model, language: this.cfg.language })).trim();
        if (text && !NOISE.test(text)) this.onText(text);
      } catch (err) {
        toast(`${tr('Dictation')}: ${err.message || err}`, { error: true });
      }
      this.onState({ busy: false });
    });
  }

  async stop() {
    if (!this.on) return;
    this.on = false;
    const last = this.cut.flush();
    if (last) this.transcribe(last);
    try { this.proc.disconnect(); } catch { /* gone */ }
    for (const t of this.stream.getTracks()) t.stop();
    await this.ctx.close().catch(() => {});
    await this.queue;
    this.onState({ on: false });
  }
}

export const dictation = new Dictation();

/**
 * A mic button: a click starts dictation (after the setup popover the first
 * time); a click while dictating stops it. target() gives { insert(text) }.
 */
export function micButton(app, { target, className = 'icon-btn', size = 18 } = {}) {
  const btn = h('button', { class: `${className} mic-btn`, title: tr('Dictate (speech to text)'), 'aria-label': tr('Dictate'), 'aria-pressed': 'false', html: icon('mic', size) });
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // keeps the caret where it is
  btn.addEventListener('click', async () => {
    if (dictation.on) { await dictation.stop(); return; }
    const ok = await setup(app, btn);
    if (!ok) return;
    const t = target();
    if (!t) return;
    try {
      await dictation.start({
        settings: app.settings,
        onText: (text) => t.insert(text),
        onState: (st) => {
          if ('on' in st) { btn.classList.toggle('on', st.on); btn.setAttribute('aria-pressed', String(st.on)); document.body.classList.toggle('dictating', st.on); }
          if ('level' in st) btn.style.setProperty('--level', String(Math.min(1, st.level * 12)));
          if ('busy' in st) btn.classList.toggle('busy', st.busy);
        },
      });
      toast(tr('Listening… click the microphone again to stop.'), { timeout: 2500 });
    } catch (err) {
      toast(`${tr('The microphone could not be used')}: ${err.message || err}`, { error: true });
    }
  });
  return btn;
}

// language, model, download – shown when the model is missing or on right-click
async function setup(app, anchor, force = false) {
  const s = app.settings;
  const sp = s.speech = speechSettings(s);
  const info = await window.api.speechInfo();
  const st = await window.api.speechStatus(sp.model).catch(() => ({ downloaded: false }));
  if (sp.enabled && st.downloaded && !force) return true;
  return new Promise((resolve) => {
    const r = anchor.getBoundingClientRect();
    const line = h('small', { class: 'hint wrap' }, st.downloaded ? '' : tr('The model is downloaded once, then dictation works offline.'));
    const model = h('select', { class: 'rec-select', 'aria-label': 'Speech model' }, ...Object.entries(info.models).map(([k, l]) => h('option', { value: k, selected: sp.model === k }, l)));
    const lang = h('select', { class: 'rec-select', 'aria-label': 'Language of the recordings' }, ...info.languages.map((l) => h('option', { value: l, selected: sp.language === l }, NAMES[l] || l)));
    const go = h('button', { class: 'btn btn-primary small' }, st.downloaded ? 'Start' : 'Download and start');
    const close = (v) => { pop.remove(); document.removeEventListener('mousedown', outside, true); resolve(v); };
    const outside = (e) => { if (!pop.contains(e.target)) close(false); };
    go.onclick = async () => {
      sp.model = model.value; sp.language = lang.value; sp.enabled = true; app.saveSettings();
      const now = await window.api.speechStatus(sp.model).catch(() => ({ downloaded: false }));
      if (!now.downloaded) {
        go.disabled = true;
        try { await withProgress((id) => window.api.speechDownload(sp.model, id), (f) => { line.textContent = `${tr('Downloading…')} ${Math.round(f * 100)}%`; }); } catch (err) { line.textContent = String(err.message || err); go.disabled = false; return; }
      }
      close(true);
    };
    const pop = h('div', { class: 'mic-pop', role: 'dialog', 'aria-label': tr('Dictation') },
      h('b', {}, 'Dictation'),
      h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Language'), lang),
      h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Model'), model),
      line, h('div', { class: 'row' }, go));
    document.body.append(pop);
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px';
    pop.style.top = (r.bottom + 6 + ph > innerHeight ? r.top - ph - 6 : r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('mousedown', outside, true));
  });
}

export function dictationSetup(app, anchor) { return setup(app, anchor, true); }
