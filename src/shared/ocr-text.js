'use strict';
// Small helpers for recognised text (used in the app and in unit tests).

/** Edit distance (letters), for comparing two readings. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Of Google's lines for the picture of one line, the one that is this line:
 * real text (not a separator "________"), and of several the most like what
 * we read (neighbouring lines are cut off and differ more). Nothing when
 * several lines come back and none is close.
 */
function googleLine(got, ours) {
  const cands = String(got || '').split('\n').map((s) => s.trim())
    .filter((s) => (s.match(/[\p{L}\p{N}]/gu) || []).length >= Math.max(1, s.replace(/\s/g, '').length * 0.5));
  if (cands.length <= 1) return cands[0] || '';
  const o = String(ours || '').toLowerCase();
  const dist = (s) => editDistance(s.toLowerCase(), o) / Math.max(1, s.length, o.length);
  const best = cands.map((s) => [s, dist(s)]).sort((p, q) => p[1] - q[1] || q[0].length - p[0].length)[0];
  return best[1] <= 0.7 ? best[0] : '';
}

module.exports = { editDistance, googleLine };
