'use strict';
// Pen input filtering.
//
// One-Euro filter (Casiez et al. 2012): an adaptive low-pass filter. When the
// pen moves slowly it smooths strongly (removes hand tremor and digitiser
// jitter, the "shaking"); when it moves fast it follows almost directly (so
// small curls and loops of handwriting keep their shape). It is causal: a
// point, once filtered, never changes again – the line already drawn can't
// move while you keep writing.

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class OneEuro {
  /** minCutoff in Hz (lower = smoother when slow), beta: speed coefficient. */
  constructor(minCutoff = 1.5, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0; this.t = null;
  }

  filter(x, tMs) {
    if (this.x === null) { this.x = x; this.t = tMs; return x; }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000 || 1 / 120);
    this.t = tMs;
    const dxRaw = (x - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
}

/** Filters (x, y) screen positions of one stroke. `strength` 0..1 (0 = off). */
class PenFilter {
  constructor(strength = 0.5) {
    // strength 0.5 ≈ gentle (default), 1 ≈ "smooth my handwriting"
    const minCutoff = 6 - 5 * strength; // 3.5 Hz … 1 Hz
    const beta = 0.16 - 0.12 * strength; // fast movements (scribbles, curls) follow closely
    this.on = strength > 0;
    this.fx = new OneEuro(minCutoff, beta);
    this.fy = new OneEuro(minCutoff, beta);
  }

  push(x, y, tMs) {
    if (!this.on) return [x, y];
    return [this.fx.filter(x, tMs), this.fy.filter(y, tMs)];
  }
}

// "Smooth my handwriting": after the pen lifts, the line is evened out a
// little more – tremor removed, curves rounded – while its start, end and
// corners stay where they are. p = [x, y, pressure, …] (page units).
function smoothStroke(p, passes = 2) {
  const n = p.length / 3;
  if (n < 5) return p.slice();
  let q = p.slice();
  for (let k = 0; k < passes; k++) {
    const out = q.slice();
    for (let i = 1; i < n - 1; i++) {
      const a = i - 1, b = i + 1;
      // keep sharp corners (angle < ~100°) – they are intended
      const ux = q[i * 3] - q[a * 3], uy = q[i * 3 + 1] - q[a * 3 + 1];
      const vx = q[b * 3] - q[i * 3], vy = q[b * 3 + 1] - q[i * 3 + 1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu > 0 && lv > 0 && (ux * vx + uy * vy) / (lu * lv) < -0.17) continue;
      out[i * 3] = 0.25 * q[a * 3] + 0.5 * q[i * 3] + 0.25 * q[b * 3];
      out[i * 3 + 1] = 0.25 * q[a * 3 + 1] + 0.5 * q[i * 3 + 1] + 0.25 * q[b * 3 + 1];
      out[i * 3 + 2] = 0.25 * q[a * 3 + 2] + 0.5 * q[i * 3 + 2] + 0.25 * q[b * 3 + 2];
    }
    q = out;
  }
  return q.map((v) => Math.round(v * 100) / 100);
}

module.exports = { OneEuro, PenFilter, smoothStroke };
