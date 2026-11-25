'use strict';
// Cuts a stream of microphone frames into phrases at the pauses, so each
// phrase can be turned into text while the speaker goes on. Energy based:
// the noise floor follows the quiet parts, speech is clearly louder.

/**
 * phrases({ rate, pause = 0.7, max = 20, min = 0.35 }) → { push(frame) → { level, speaking, done: [Float32Array] }, flush() → Float32Array|null }
 * pause: seconds of quiet that end a phrase; max: longest phrase; min: shorter sounds are dropped.
 */
function phrases({ rate = 16000, pause = 0.7, max = 20, min = 0.35 } = {}) {
  let noise = 0.004;
  let cur = [], curLen = 0, quiet = 0, voiced = 0, pre = null;
  const take = () => {
    const out = voiced / rate >= min ? concat(cur, curLen) : null;
    cur = []; curLen = 0; quiet = 0; voiced = 0;
    return out;
  };
  return {
    push(frame) {
      let e = 0;
      for (let i = 0; i < frame.length; i++) e += frame[i] * frame[i];
      const level = Math.sqrt(e / Math.max(1, frame.length));
      const loud = level > Math.max(0.01, noise * 3);
      if (!loud) noise = noise * 0.95 + level * 0.05;
      const done = [];
      if (curLen) {
        cur.push(frame); curLen += frame.length;
        if (loud) { quiet = 0; voiced += frame.length; } else quiet += frame.length;
        if (quiet / rate >= pause || curLen / rate >= max) { const p = take(); if (p) done.push(p); }
      } else if (loud) {
        // a little of what came before, so the first sound is not cut
        if (pre) { cur.push(pre); curLen += pre.length; }
        cur.push(frame); curLen += frame.length; voiced += frame.length;
      }
      pre = frame;
      return { level, speaking: !!curLen, done };
    },
    flush() { return curLen ? take() : null; },
  };
}

function concat(parts, n) {
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

module.exports = { phrases };
