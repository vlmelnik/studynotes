# Extensions

An extension is an optional feature that lives in its own folder,
`src/extensions/<id>/`, and reaches the app only through a small **host**
object. Users switch extensions on and off in *Settings → Extensions*. Outside
contributors can build a complete, user-visible feature this way without
touching the editor, the viewer or the main process.

> **Status:** API version 1, implemented in `src/renderer/extensions.js`
> (host), tested by `test/e2e/extensions-host.js` (a test extension goes
> through every part below) and `test/unit/extensions/fake-host.test.js`.

## Files

| Path | What |
|---|---|
| `src/extensions/<id>/index.js` | the extension (ES module, default export below) |
| `src/extensions/<id>/*.js`, `*.css` | more code and styles of the same extension |
| `test/unit/extensions/<id>*.test.js` | unit tests with the fake host (`node --test`) |
| `test/e2e/extensions/<id>.js` | end-to-end test in the real app (Playwright harness) |
| `docs/NOTES-<CHAIN>.md` | handover notes of the task chain |

`<id>`: lower case letters, digits and `-`. No sub folders, only `.js` and
`.css`. The build picks up every `src/extensions/*/index.js` by itself, so
no shared list has to be edited. CSS is imported from the code
(`import './styles.css';`, `import 'katex/dist/katex.min.css';`) and
bundled into `dist/app.css` together with the fonts it points to.

### What extension code may use
`test/unit/main/extensions-guard.test.js` checks this:
- imports only from its own folder (`./x.js`), from `../../shared/<module>.js`
  (pure shared code) and from packages the maintainer allowed (`katex`);
- no `window.api`, `require`, `fetch` or other network access, no
  `eval`/`Function`, no `localStorage` (use `host.settings`).
DOM access is fine inside the elements the host hands over (a text box's
element, a menu, a dialog) and for `document.createElement`.

## The module

```js
export default {
  id: 'rich-paste',                 // = folder name
  name: 'Formulas and formatting on paste',
  description: 'Shows LaTeX formulas, bold text, headings and lists from pasted text.',
  apiVersion: 1,
  defaultEnabled: false,
  activate(host) {
    // register things on host …
    return () => { /* optional: undo anything not registered through host */ };
  },
};
```

Everything registered through `host` is removed automatically when the user
switches the extension off. `activate` must not throw. If it does, the host
disables the extension and shows a short message.

## Host API version 1

### `host.paste.addTransform(fn, { priority = 0 })`
Called when text is pasted into a text box or onto the page (also when
"Paste keeps formatting" is off), before the app sanitises it. `fn({ html, text, target })` gets the clipboard's `text/html`
(or `''`), `text/plain` and `target` (`'textbox'` or `'page'`). It returns
`null` (not mine) or `{ html }` in the app's rich-text subset (see
`src/shared/richtext.js`: `<b> <i> <u> <br> <div>`,
`<span data-fs data-ff data-c>`) plus inline elements registered with
`host.inline`. The first non-null result wins (higher priority first).
Build inline elements with `host.inline.html(kind, value, { display })`.

### `host.inline.register(kind, def)`
An atomic inline element stored as
`<span data-x="<kind>" data-v="<value>" [data-display="1"]>fallback</span>`,
with `kind` = `<extension id>` or `<extension id>:<name>`, `value` a string
and `fallback` = `toText(value)`, which the host writes in. The box's plain
`text` holds the fallback too, so search, older versions and the app with
the extension off show it. `def`:
- `render(el, value, { display, color, fontSize })`: fill the empty element
  on screen. It is called again when the size or colour changes.
- `toText(value, { display })`: plain text for copy, search and older app
  versions (for example `$…$` or `$$…$$`).
- `toHtml(value, { display })`: HTML for copying into other programs.
- `edit(value, { display }) → Promise<string | null>` (optional): runs on
  double-click. Return the new value, or `null` to cancel. Use
  `host.ui.prompt` or your own dialog.
- `exportImage(value, { display, color, fontSize, scale }) → Promise<{ png, width, height, baseline }>`:
  used by *Export PDF*. `png` is the PNG file (Uint8Array, drawn at `scale` ×
  for sharpness). `width`, `height` and `baseline` (measured from the top)
  are given in the same units as `fontSize`. The export places the picture
  on the text line. A display formula alone on its line is centred. The host
  caches results per value and style. Other ways out (send by e-mail,
  saving into an opened PDF, Drive) get the fallback text for now.

On screen the element is `contenteditable="false"`, so the caret steps over
it as one character and Backspace removes it whole. Double-click calls
`edit` (one undo step). If the extension is off or missing, the element
shows its fallback text, so nothing is lost.

### `host.menus.add(where, item)`
`where`: `'textbox-more'` (the `…` menu of a selected text box),
`'page-more'`, `'view'`. `item = { id, label, icon?, when?(ctx), run(ctx) }`.
`ctx` for `'textbox-more'` (one box selected or edited):
`{ textbox: { text, html, setHtml(html) } }`. `setHtml` is one undo step. For
`'view'` (the editor's `…` menu) and `'page-more'` (right-click on a page):
`{ notebook, pageIndex }`. The host translates labels with `host.ui.t`.

### `host.view.addPagePass(fn)` and `host.view.setInkFilter(fn)`
- `fn({ canvas, ctx, page, scale, imageRegions })` runs after a PDF page (or
  a sharp part of it when zoomed in) is drawn, on that canvas only. It never
  runs for exports or stored data. `page` is the 0-based page of the PDF.
  `imageRegions` are the picture rectangles `{ x0, y0, x1, y1 }` in canvas
  pixels (`src/shared/pdf-images.js`), so they can be left alone (see
  `darkenImage(…, { keep })`). It may be `async`. Call `host.view.refresh()`
  after the effect changes.
- `setInkFilter(color => color)` changes the colours used to *draw* ink and
  highlighter on screen. The stored colours stay as they are.
- `setClass(name, on)` puts the class `ext-<id>-<name>` on the editor, so the
  extension's CSS can change the look (for example the highlighter's blend
  mode).

### `host.settings`
`get(key, fallback)`, `set(key, value)` (JSON values) and
`onChange(key, fn)`. They are stored per extension. `host.settings.notebook`
works the same way but is stored per notebook.

### `host.ui`
`toast(text)`, `prompt({ title, value }) → Promise<string|null>` (the app's
one-line input dialog), `t(text)` (translation of the app's language,
English fallback).

### `host.log(...)`
Writes to the developer console with the extension id.

## Planned: API version 2 (1.9)

`host.ai`, `host.notebook`, `host.capture`, `host.ink` and `host.models`, see
[ROADMAP-1.9.md](ROADMAP-1.9.md#extension-host-api-v2-maintainer-19). Version 1
extensions keep working.

## Tests

- **Unit** (`test/unit/extensions/<id>*.test.js`, run in the sandbox):
  `test/unit/extensions/fake-host.js` gives a host that records every call
  (maintainer-owned, comes with the host). Test the logic: transforms on
  real-looking clipboard samples, `toText` / `toHtml`, menu `when` rules.
- **End to end** (`test/e2e/extensions/<id>.js`, run by the maintainer before
  merging, and by you if you can run Electron): use `test/e2e/harness/app.js`,
  switch the extension on through Settings and go through the user's path:
  paste, look at the result, edit, undo, export, switch off. Print a
  `check(...)` per step like the other suites.
- Say in the report which tests you actually ran.

## Review checklist (maintainer)
Guard test green. No access outside the host. Off by default unless agreed.
Switching it off leaves notebooks readable. The e2e test passes on Linux and
Windows. Notes file updated.
