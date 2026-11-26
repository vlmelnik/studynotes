'use strict';
// Handwriting → text, read by Google's handwriting recognizer from the pen
// strokes themselves (the one behind Google's handwriting keyboards): fast
// (a fraction of a second) and good at untidy writing. Online; no account.
// The text written just before goes along as context, so a line that goes on
// is read as one sentence.

const URL = 'https://inputtools.google.com/request?ime=handwriting&app=studynotes&dbg=0&cs=1&oe=UTF-8';

/** The request for strokes [[x, y, x, y, …], …] (page units; pressure already left out). */
function inkRequest(strokes, { lang = 'de', pre = '' } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of strokes) for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  const r = (v) => Math.round(v * 10) / 10;
  const ink = strokes.filter((p) => p.length >= 2).map((p) => {
    const xs = [], ys = [];
    for (let i = 0; i + 1 < p.length; i += 2) { xs.push(r(p[i] - x0)); ys.push(r(p[i + 1] - y0)); }
    return [xs, ys];
  });
  return {
    app_version: 0.4, api_level: '537.36', device: 'StudyNotes', input_type: 0, options: 'enable_pre_space',
    requests: [{
      writing_guide: { writing_area_width: Math.max(1, Math.round(x1 - x0)), writing_area_height: Math.max(1, Math.round(y1 - y0)) },
      pre_context: String(pre || '').slice(-40), max_num_results: 1, max_completions: 0, language: lang, ink,
    }],
  };
}

/** The best reading from Google's answer, or ''. */
function inkAnswer(json) {
  if (!Array.isArray(json) || json[0] !== 'SUCCESS') throw new Error('Google could not read the handwriting' + (json && json[0] ? ` (${json[0]})` : ''));
  const first = json[1] && json[1][0];
  return String((first && first[1] && first[1][0]) || '').trim();
}

async function recognizeGoogle(strokes, opts, fetch) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inkRequest(strokes, opts)), signal: ctl.signal });
    if (!res.ok) throw new Error(`Google could not read the handwriting (HTTP ${res.status})`);
    return { text: inkAnswer(await res.json()) };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Google did not answer in time – check the internet connection');
    throw err;
  } finally { clearTimeout(t); }
}

module.exports = { inkRequest, inkAnswer, recognizeGoogle };
