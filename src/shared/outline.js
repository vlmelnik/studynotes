'use strict';

const MAX_TITLE_LENGTH = 200;

function mapPdfOutline(items, src, pages) {
  const pageIds = new Map();
  for (const page of pages) {
    if (page.kind !== 'pdf' || (page.src || 'main') !== src) continue;
    // Keep the first copy in notebook order when a PDF page was duplicated.
    if (!pageIds.has(page.pdfPage)) pageIds.set(page.pdfPage, page.id);
  }

  // A notebook can reorder pages, so find replacement destinations in PDF order.
  const pageNumbers = [...pageIds.keys()].sort((a, b) => a - b);
  function pageIdFor(page) {
    if (page === null || !pageNumbers.length) return null;
    let low = 0;
    let high = pageNumbers.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (pageNumbers[mid] < page) low = mid + 1;
      else high = mid;
    }
    const pageNumber = pageNumbers[Math.min(low, pageNumbers.length - 1)];
    return pageIds.get(pageNumber);
  }

  function mapItems(nodes, level) {
    return nodes.map((node) => {
      const title = node.title.trim().replace(/\s+/g, ' ');
      return {
        title: [...title].slice(0, MAX_TITLE_LENGTH).join('').trimEnd(),
        pageId: pageIdFor(node.page),
        level,
        items: mapItems(node.items, level + 1),
      };
    });
  }

  return mapItems(items, 0);
}

module.exports = { mapPdfOutline };
