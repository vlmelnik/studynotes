'use strict';

function fitToolbar(groups, available, { gap = 8, minGap = 2, more = 36 } = {}) {
  const activeGroups = groups.filter(group => group.items.length);
  const items = activeGroups.flatMap(group => group.items);
  let width = items.reduce((total, item) => total + item.w, 0);
  let gaps = Math.max(0, activeGroups.length - 1);
  const allVisible = items.map(item => item.id);
  if (width + gap * gaps <= available) return { gap, visible: allVisible, overflow: [] };
  if (gaps && width + minGap * gaps <= available) {
    return { gap: Math.max(minGap, Math.floor((available - width) / gaps)), visible: allVisible, overflow: [] };
  }

  const remaining = activeGroups.map(group => group.items.length);
  const candidates = activeGroups.flatMap((group, index) =>
    group.items.filter(item => !item.keep).map(item => ({ item, index })));
  candidates.sort((a, b) => a.item.rank - b.item.rank);
  const hidden = new Set();
  for (const { item, index } of candidates) {
    if (!hidden.size) {
      width += more;
      gaps = activeGroups.length;
    }
    hidden.add(item.id);
    width -= item.w;
    if (--remaining[index] === 0) gaps--;
    if (width + minGap * gaps <= available) break;
  }
  const result = { gap: minGap, visible: allVisible.filter(id => !hidden.has(id)), overflow: allVisible.filter(id => hidden.has(id)) };
  if (width + minGap * gaps > available) result.tooNarrow = true;
  return result;
}

module.exports = { fitToolbar };
