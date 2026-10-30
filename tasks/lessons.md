# Lessons

- **Read the user's sentences as instructions about existing UI first.** "make a line with click an object to select it and drag to move .... as well as zoom dissapear" meant "remove the hint line and the zoom buttons", not a new feature. If a sentence quotes on-screen text, find that text in the app before planning.
- **PDF export: embed fonts without ligatures** (`features: { liga:false, clig:false, calt:false, ... }`). fontkit's default shaping turned "ti" into one glyph, which PDF readers can't copy or search ("Wichtig" → "Wich g"). Check exported text with pdftotext or pdf.js `getTextContent`, not only visually.
- **e2e clicks must scroll the target into view first.** Fixed screen coordinates break as soon as the zoom or layout changes.
- **Electron upgrades change APIs silently** (Electron 44: only the async `clipboard.read/write`). Run the paste tests after every Electron bump.
- **Rich-text styling with execCommand nests spans.** Always normalise (flatten nested single-child spans, drop empty ones) after each operation, then re-sanitise.
- **Pictures from a custom protocol taint canvases.** `sn://lib` is another origin than `sn://app`: reading pixels needs `img.crossOrigin = 'anonymous'` plus an `Access-Control-Allow-Origin` header from the protocol handler. Wrap `getImageData` in try/catch, because an exception in a pointer handler silently kills the whole click.
- **RDP on closed shapes:** when start == end, the base segment has length 0 and everything gets dropped. Split at the farthest point first.
- **`preventDefault()` on pointerdown also prevents the focus change.** When a click should end text editing, blur explicitly.
- **New behaviour can break old tests for the right reason** (clicks through transparent picture corners). Fix the test to express the intent ("click a visible part"), don't weaken the feature.

## 2026-10-26 (v1.4)
- Native `replaceChildren(a, null)` renders the text "null" (unlike our `h()`): filter children with `.filter(Boolean)` first.
- In e2e, close dialogs through their buttons. Removing `.modal-backdrop` by hand leaves the modal's capture-phase key handler alive, and it swallows Enter for later inputs (looked like an app bug).
- e2e coordinates in page units go off-screen when the page is zoomed to fit width: set a known zoom before drawing.
- When a timing constant changes (overscroll 2 s → 0.5 s), update the older e2e suites that encode it.

## 2026-10-30 (v1.5)
- Measure "it wiggles" before fixing: a raster diff of consecutive live outlines (outside the newest tip) showed last:false + end taper as the cause; numbers before/after made the fix verifiable.
- Never resample points that are kept (eraser): re-running the smoothing on denser points reshapes the whole line.
- In Playwright, don't `await` a page function that returns a promise resolved only by a dialog closing (e.g. newNotebook → picker) – it hangs the test.
- UI translation by observing the DOM needs an explicit list of user-content containers, including attributes (a notebook card's title tooltip is user content).
- Secrets: keep them in an uncommitted *.local.js before the repo goes public; grep the tree for them before every publish.
