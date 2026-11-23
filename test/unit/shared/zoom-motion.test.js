'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { easeZoom, wheelZoomFactor, isTouchpadPinch, clampZoom, anchorScroll } = require('../../../src/shared/zoom-motion');

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

test('log-space easing is independent of frame rate in both directions', () => {
  for (const [current, target] of [[1, 2], [2, 1]]) {
    const expectedLog = Math.log(target) + (Math.log(current) - Math.log(target)) * Math.exp(-2);
    for (const frames of [2, 8, 15]) {
      let zoom = current;
      for (let frame = 0; frame < frames; frame++) zoom = easeZoom(zoom, target, 120 / frames);
      near(Math.log(zoom), expectedLog);
    }
  }
});

test('doubling zoom snaps to target at about 310 ms with a 60 ms time constant', () => {
  let zoom = 1;
  for (let frame = 0; frame < 30; frame++) zoom = easeZoom(zoom, 2, 10);
  assert.ok(zoom < 2);
  assert.equal(easeZoom(zoom, 2, 10), 2);
  assert.equal(easeZoom(1.002, 1, 16), 1);
  assert.equal(easeZoom(2, 2, 16), 2);
});

test('easing caps a stalled frame at 100 ms and ignores negative time', () => {
  near(easeZoom(1, 4, 500), Math.exp(Math.log(4) * (1 - Math.exp(-100 / 60))));
  assert.equal(easeZoom(1, 4, -12), 1);
  near(easeZoom(1, 4, 25, 25), Math.exp(Math.log(4) * (1 - Math.exp(-1))));
});

test('easing snaps inside the 0.4 percent target ratio band, including zoom-out', () => {
  assert.equal(easeZoom(1, 1.00399, 0), 1.00399);
  assert.equal(easeZoom(1, 0.99601, 0), 0.99601);
  assert.equal(easeZoom(1, 1.00401, 0), 1);
  assert.equal(easeZoom(1, 0.99599, 0), 1);
});

test('wheel factors respect line and pixel units, with a hard limit per event', () => {
  near(wheelZoomFactor({ deltaY: -2, deltaMode: 1, ctrlKey: true }), Math.exp(0.1));
  near(wheelZoomFactor({ deltaY: 40, deltaMode: 0, ctrlKey: false }), Math.exp(-0.1));
  assert.equal(wheelZoomFactor({ deltaY: 0, deltaMode: 0 }), 1);
  assert.equal(wheelZoomFactor({ deltaY: -100, deltaMode: 1 }), 2);
  assert.equal(wheelZoomFactor({ deltaY: 1e5, deltaMode: 0 }), 0.5);
});

test('only small pixel deltas qualify as touchpad pinches', () => {
  assert.equal(isTouchpadPinch({ deltaMode: 0, deltaY: -39.9 }), true);
  assert.equal(isTouchpadPinch({ deltaMode: 0, deltaY: 40 }), false);
  assert.equal(isTouchpadPinch({ deltaMode: 0, deltaY: -40 }), false);
  assert.equal(isTouchpadPinch({ deltaMode: 1, deltaY: 2 }), false);
  assert.equal(isTouchpadPinch({ deltaMode: 2, deltaY: 2 }), false);
});

test('zoom is capped at the viewer range', () => {
  for (const [z, expected] of [[0, 0.1], [0.1, 0.1], [1.5, 1.5], [8, 8], [10, 8]]) {
    assert.equal(clampZoom(z), expected);
  }
});

test('anchor locks a centre or corner under the pointer when zooming in and out', () => {
  const pos = Object.freeze({ zoom: 1, newZoom: 2, scrollLeft: 60, scrollTop: 90, pageX: 0, pageY: 0 });
  assert.deepEqual(anchorScroll({ ...pos, pointX: 150, pointY: 210 }), { scrollLeft: 270, scrollTop: 390 });
  assert.deepEqual(anchorScroll({ ...pos, pointX: 0, pointY: 0 }), { scrollLeft: 120, scrollTop: 180 });
  assert.deepEqual(anchorScroll({ ...pos, newZoom: 0.5, pointX: 10, pointY: 10 }), { scrollLeft: 25, scrollTop: 40 });
  assert.deepEqual(anchorScroll({ ...pos, newZoom: 0.5, pointX: 100, pointY: 100 }), { scrollLeft: 0, scrollTop: 0 });
});

test('a second-page anchor keeps fixed screen gaps unscaled and survives a round trip', () => {
  const layoutX = 10;
  const layoutY = 600;
  const cursor = { pointX: 60, pointY: 100, layoutX, layoutY };
  const original = { scrollLeft: 14, scrollTop: 640 };
  const grown = anchorScroll({ ...cursor, ...original, zoom: 1, newZoom: 3, pageX: 28, pageY: 636 });
  assert.deepEqual(grown, { scrollLeft: 126, scrollTop: 2048 });
  const restored = anchorScroll({ ...cursor, ...grown, zoom: 3, newZoom: 1, pageX: 48, pageY: 1836 });
  near(restored.scrollLeft, original.scrollLeft, 0.5);
  near(restored.scrollTop, original.scrollTop, 0.5);
});

test('anchor uses measured next origins when rounded or centred layouts differ from a linear layout', () => {
  const anchored = anchorScroll({ zoom: 1, newZoom: 2, pointX: 150, pointY: 100, scrollLeft: 40, scrollTop: 650,
    pageX: 100, pageY: 636, nextPageX: 36, nextPageY: 1237 });
  assert.deepEqual(anchored, { scrollLeft: 66, scrollTop: 1365 });
});

test('a capped wheel zoom keeps its content point and stops at the zoom limit', () => {
  const current = 4;
  const notchedWheel = { deltaY: -400, deltaMode: 0 };
  assert.equal(isTouchpadPinch(notchedWheel), false);
  const factor = wheelZoomFactor(notchedWheel);
  const target = clampZoom(current * factor);
  assert.equal(target, 8);
  let zoom = current;
  for (let frame = 0; frame < 25; frame++) zoom = easeZoom(zoom, target, 16);
  assert.equal(zoom, target);
  const pos = anchorScroll({ zoom: current, newZoom: zoom, scrollLeft: 80, scrollTop: 400, pointX: 120, pointY: 100,
    pageX: 20, pageY: 300 });
  assert.deepEqual(pos, { scrollLeft: 280, scrollTop: 900 });
});

test('a tiny pixel pinch supplies a direct zoom factor without easing', () => {
  const pinch = { deltaY: -4, deltaMode: 0 };
  assert.equal(isTouchpadPinch(pinch), true);
  near(clampZoom(wheelZoomFactor(pinch)), Math.exp(0.01));
});
