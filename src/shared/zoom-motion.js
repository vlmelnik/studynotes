'use strict';

function easeZoom(current, target, dtMs, tauMs = 60) {
  const elapsed = Math.max(0, Math.min(100, dtMs));
  // Decaying the log distance gives the same result at different frame rates.
  const remaining = Math.log(target / current) * Math.exp(-elapsed / tauMs);
  if (Math.abs(Math.expm1(remaining)) <= 0.004) return target;
  return elapsed === 0 ? current : target * Math.exp(-remaining);
}

function wheelZoomFactor({ deltaY, deltaMode }) {
  const perUnit = deltaMode === 1 ? 0.05 : 0.0025;
  return Math.max(0.5, Math.min(2, Math.exp(-deltaY * perUnit)));
}

function isTouchpadPinch({ deltaY, deltaMode }) {
  return deltaMode === 0 && Math.abs(deltaY) < 40;
}

function clampZoom(zoom) {
  return Math.max(0.1, Math.min(8, zoom));
}

function anchorScroll({ zoom, newZoom, scrollLeft, scrollTop, pointX, pointY, pageX, pageY,
  layoutX = pageX / zoom, layoutY = pageY / zoom, nextPageX = pageX + layoutX * (newZoom - zoom),
  nextPageY = pageY + layoutY * (newZoom - zoom) }) {
  const ratio = newZoom / zoom;
  // Move the old page-local point to the new origin and subtract the viewport
  // point. Only the unscaled layout offset moves; screen-pixel gaps stay fixed.
  const anchored = (scroll, point, before, after) => Math.max(0, after + (scroll + point - before) * ratio - point);
  return {
    scrollLeft: anchored(scrollLeft, pointX, pageX, nextPageX),
    scrollTop: anchored(scrollTop, pointY, pageY, nextPageY),
  };
}

module.exports = { easeZoom, wheelZoomFactor, isTouchpadPinch, clampZoom, anchorScroll };
