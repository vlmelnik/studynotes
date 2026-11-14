'use strict';
// Pen input filtering.

/**
 * Filters (x, y) screen positions of one stroke: a "lazy string". The line
 * follows the pen like a point pulled on a short string of length R: shaking
 * smaller than R is removed completely, and because it depends only on where
 * the pen is (not on when the tablet reports it), uneven timing of the tablet
 * can't bend the line. It never moves points already drawn.
 * `strength` 0..1: 0.5 = gentle (default), 1 = "Smooth my handwriting".
 */
class PenFilter {
  constructor(strength = 0.5) {
    this.on = strength > 0;
    this.r = 0.4 + 2.2 * strength; // screen pixels: 1.5 px default, 2.6 px smooth
    this.x = null; this.y = null;
  }

  push(x, y) {
    if (!this.on) return [x, y];
    if (this.x === null) { this.x = x; this.y = y; return [x, y]; }
    const dx = x - this.x, dy = y - this.y, d = Math.hypot(dx, dy);
    if (d > this.r) {
      const k = (d - this.r) / d;
      this.x += dx * k; this.y += dy * k;
    }
    return [this.x, this.y];
  }
}

module.exports = { PenFilter };
