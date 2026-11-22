'use strict';

function writeDarkColor(data, offset, backgroundOnly) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const lightness = (min + max) / 2;

  if (backgroundOnly) {
    // Compare HSL saturation without dividing, since pure white has zero chroma.
    if (lightness > 0.9 * 255 && (max === min || max - min < 0.15 * (510 - 2 * lightness))) {
      data[offset] = data[offset + 1] = data[offset + 2] = 30;
    }
    return;
  }

  const darkLightness = 0.88 * 255 - 0.76 * lightness;
  if (min === max) {
    data[offset] = data[offset + 1] = data[offset + 2] = Math.round(darkLightness);
    return;
  }

  // Scale the channel offsets together to retain HSL hue and saturation at the new lightness.
  const chroma = 255 - Math.abs(2 * lightness - 255);
  const darkChroma = 255 - Math.abs(2 * darkLightness - 255);
  const scale = darkChroma / chroma;
  data[offset] = Math.round(darkLightness + (r - lightness) * scale);
  data[offset + 1] = Math.round(darkLightness + (g - lightness) * scale);
  data[offset + 2] = Math.round(darkLightness + (b - lightness) * scale);
}

function darkColor(r, g, b, mode) {
  const rgb = [r, g, b];
  writeDarkColor(rgb, 0, mode === 'background');
  return rgb;
}

function darkenImage(im, { mode = 'full', keep = [] } = {}) {
  const { width, height, data } = im;
  const backgroundOnly = mode === 'background';
  const rects = [];
  for (const rect of keep) {
    const x0 = rect.x0 ?? rect.x;
    const y0 = rect.y0 ?? rect.y;
    const x1 = rect.x1 ?? (x0 + rect.w);
    const y1 = rect.y1 ?? (y0 + rect.h);
    if (!(x1 > x0 && y1 > y0)) continue;
    const left = Math.max(0, Math.floor(x0));
    const top = Math.max(0, Math.floor(y0));
    const right = Math.min(width, Math.ceil(x1));
    const bottom = Math.min(height, Math.ceil(y1));
    if (right > left && bottom > top) rects.push({ left, top, right, bottom });
  }

  // Reuse one row of coverage so overlapping pictures need no per-pixel rectangle lookups.
  const mask = rects.length ? new Uint8Array(width) : null;
  for (let y = 0, offset = 0; y < height; y++) {
    let masked = false;
    for (const rect of rects) {
      if (y < rect.top || y >= rect.bottom) continue;
      if (!masked) mask.fill(0);
      mask.fill(1, rect.left, rect.right);
      masked = true;
    }
    for (let x = 0; x < width; x++, offset += 4) {
      if (!masked || !mask[x]) writeDarkColor(data, offset, backgroundOnly);
    }
  }
  return im;
}

module.exports = { darkColor, darkenImage };
