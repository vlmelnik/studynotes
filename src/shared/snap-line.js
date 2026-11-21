'use strict';

function snapLine(bbox, paper) {
  const { x0, y0, y1 } = bbox;
  const height = y1 - y0;
  const free = { baseline: y1, x: x0, lineHeight: height, kind: 'free' };
  const lines = paper?.lines ?? [];

  // Full-page ruling excludes the short lines of templates such as music and planners.
  const rows = lines.filter(([left, top, right, bottom]) => left === 0 && right > left && top === bottom);
  if (rows.length < 2) return free;
  const first = rows[0];
  const sameStyle = (line) => line[4] === first[4] && line[5] === first[5];
  const ruling = rows.filter(sameStyle);
  if (ruling.length < 2) return free;

  // Aim below the body of the handwriting while allowing strokes to have descenders.
  const anchor = y0 + height * 0.75;
  const baseline = ruling.find((row) => row[1] >= anchor)?.[1] ?? y1;
  const lineHeight = ruling[1][1] - first[1];
  const vertical = lines.filter(([left, top, right, bottom]) => left === right && top === 0 && bottom > top);
  const columns = vertical.filter(sameStyle);
  if (columns.length > 0) {
    const x = columns.findLast((line) => line[0] <= x0)?.[0] ?? x0;
    return { baseline, x, lineHeight, kind: 'grid' };
  }

  const margin = vertical.at(-1)?.[0];
  const x = x0 < margin ? margin + 4 : x0;
  return { baseline, x, lineHeight, kind: 'ruled' };
}

module.exports = { snapLine };
