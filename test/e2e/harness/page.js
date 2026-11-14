// Page units -> window (client) coordinates for mouse input, using the page's
// current position and zoom.
async function at(ed, x, y, page = 0) {
  const r = await ed((p) => window.__app.active.viewer.pageClientRect(p), page);
  const z = await ed(() => window.__app.active.viewer.zoom);
  return [r.left + x * z, r.top + y * z];
}

module.exports = { at };
