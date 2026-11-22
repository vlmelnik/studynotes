# Shared modules

These modules serve the renderer and desktop export. They use CommonJS and
can run without Node, Electron, or the DOM. Imports within `src/shared` use
relative paths to other shared modules. The dependency and load checks run
in [shared-guard.test.js](../test/unit/shared/shared-guard.test.js).

## richtext.js

Parses and lays out stored rich text in text boxes and table cells.

- `parseRich(html, base?)` returns paragraphs of runs with text `t`, booleans
  `b`, `i`, `u`, and optional font size `fs`, font key `ff`, and colour `c`.
  The optional base supplies the three boolean styles.
- `plainFromParas(paras)` joins run text within each paragraph and adds
  newlines between paragraphs. `richToPlain(html)` parses first, then joins.
- `plainToHtml(text)` escapes text and converts newlines to `<br>`.
  `decode(text)` decodes supported named and numeric entities and preserves
  unknown or out-of-range references.
- `layoutRich(paras, maxWidth, measure)` wraps styled runs into
  `{ runs, width }` lines. `measure(text, style)` supplies widths in the
  caller's units. Returned runs include their horizontal offset `x` and width `w`.

The parser expects the renderer's stored subset of HTML. Its tags are
`<b>`, `<i>`, `<u>`, `<br>`, `<div>`, and styled `<span>` elements. Layout
breaks long words by character when necessary.
[Source](../src/shared/richtext.js) · [Parsing and layout tests](../test/unit/shared/richtext.test.js)

## paper.js

Computes page backgrounds and template geometry for display and PDF export.

- `paperGeometry(kind, w, h, area?, pc?, cover?)` returns `{ lines, dots, rects }`.
  Lines are `[x0, y0, x1, y1, colour, width]`, dots are
  `[x, y, radius, colour]`, and rectangles are `[x, y, w, h, colour]`.
  Pass a template key and page dimensions, with an optional board area
  `[x0, y0, x1, y1]`, paper colour key, or cover preset.
- `pageBackground(page, exp = false)` returns a hex background colour for the
  page. The export flag selects the export colour for paper styles.
- `isDark(hex)` returns whether the weighted RGB brightness is below 140.

`PAPERS` lists template keys and labels. `PAPER_GROUPS` defines picker
groups, `PAPER_COLORS` holds display and export colours, `PAGE_SIZES` maps
names to width and height, and `COVERS` contains cover presets. Board dots
align to the page origin across render areas.
[Source](../src/shared/paper.js) · [Template geometry tests](../test/unit/shared/paper.test.js)

## stacking.js

Orders pictures, tables, and text boxes around the ink layer.

- `layerOf(kind, obj)` returns explicit `obj.lay` when set to `'b'` or `'f'`.
  A `'text'` defaults to front. An `'item'` defaults to back.
- `stacked(data, layer)` reads `data.items` and `data.texts` and returns
  `{ kind, obj, key, seq }` entries from bottom to top in the given layer.
- `restack(data, ids, dir)` returns page data with new item and text arrays.
  The `Set` of selected IDs receives new layer and `z` values. Positive
  `dir` brings the selection to the front. Zero or negative sends it to the back.

Higher `z` draws above lower `z` within a layer. Objects without `z` use
array order, with items below text. Ink is drawn between the layers.
[Source](../src/shared/stacking.js) · [Layer and restacking tests](../test/unit/shared/stacking.test.js)

## paths.js

Handles library-relative POSIX paths for the platform adapters.

- `normalize(path)` returns a canonical string, with `''` representing the
  root. It collapses empty segments, `.`, and internal `..` pairs.
- `join(...parts)` joins segments and normalizes the combined path.
- `dirname(path)` and `basename(path)` return the normalized path's parent
  and final segment. `extname(path)` returns the final extension including
  its dot, or `''` when the last segment has no extension.
- `isInside(parent, child)` compares normalized whole segments and returns
  true for a descendant or the parent itself.

Normalization rejects absolute paths, drive prefixes, backslashes, NULs,
and traversal above the library root.
[Source](../src/shared/paths.js) · [Path tests](../test/unit/shared/paths.test.js)

## format.js

Defines notebook, settings, and backup versions and prepares loaded data.
`NOTEBOOK_VERSION`, `SETTINGS_VERSION`, and `BACKUP_VERSION` hold the
current version of each format.

- `migrateNotebook(nb)` updates and returns the input object. It supplies
  v2 notebook defaults, ensures pages and sources are present, and sets
  `newerVersion` to the input version when that version is ahead.
- `migratePage(data)` returns an object with `strokes`, `texts`, and `items`
  arrays, filling them on the input object when one exists.
- `pageIsEmpty(data)` returns true for an absent page or one with missing
  or empty content arrays and no other keys.
- `makeSettingsExport(settings, appVersion)` wraps settings with a format
  marker, version, app version, and ISO timestamp. `readSettingsImport(obj)`
  validates the marker and settings object, then returns the settings.

Migrations preserve unknown data. An unknown page field keeps the page from
being treated as empty.
[Source](../src/shared/format.js) · [Migration and settings tests](../test/unit/shared/format.test.js)

## util.js

Exports small text and numeric helpers.

- `escHtml(value)` converts the value to a string and escapes `&`, `<`,
  and `>` for HTML text content.
- `median(numbers)` returns the middle value in a sorted copy, using the
  upper middle for even counts. It returns `undefined` for an empty list.
  `medianOr0(numbers)` uses the same rule with zero for an empty list.
- `LINE_H` is the text-box line-height multiplier, currently 1.3.

The shared guard loads this module. The plain-text round trip exercises
`escHtml` through `plainToHtml`.
[Source](../src/shared/util.js) · [Rich-text tests](../test/unit/shared/richtext.test.js)

## scan-blocks.js

Finds text blocks in scanned page images before recognition.

- `findBlocks(im, { maxSide = 1500, maxBlocks = 400 }?)` accepts
  `{ width, height, data }` with RGBA pixels. It returns a list of blocks
  `{ x0, y0, x1, y1, h, zone }`, or `null` when the page should be read as
  a whole. `h` estimates letter height. `zone` identifies an area separated by rules.
  `maxSide` bounds the working mask and `maxBlocks` caps the block count.
- `label(mask, width, height)` returns `{ lab, n }` for connected areas in
  a binary pixel mask. `lab` is an `Int32Array` with zero for background
  and positive labels for the `n` areas.
- `smear(mask, width, height, rx, ry)` grows the marked area by the
  horizontal and vertical radii and returns a new `Uint8Array` mask.

Blocks are sorted by top edge and then left edge. Coordinates are in the
original image, with exclusive right and bottom bounds. The detector expects
dark text on light paper and uses four-neighbour connectivity. Block tests
exercise the mask helpers through `findBlocks`.
[Source](../src/shared/scan-blocks.js) · [Block detection tests](../test/unit/shared/scan-blocks.test.js)
