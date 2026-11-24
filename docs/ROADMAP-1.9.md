# Roadmap 1.9: AI in the notebook, study sessions, handwriting to text

Status (2026-11-24): the AI core is built (AI panel, providers, edit plans, Claude over MCP); study session, handwriting and host API v2 are planned. Version 1.9 brings the AI core. The two larger
features after it ship as extensions in 1.9.x, so they can be switched off
and worked on separately.

| Version | What | Where |
|---|---|---|
| 1.9 | AI core: ask, edit and summarise inside a notebook. Providers and sign-in. | app (maintainer) + `src/shared` (queue) |
| 1.9 | Extension host API v2: `host.ai`, `host.notebook`, `host.capture`, `host.ink`, `host.models` | app (maintainer) |
| 1.9.x | **Study session** extension: collect material from the whole screen, then let the AI file it into the notebook | `src/extensions/study-session` |
| 1.9.x | **Handwriting to text** extension: local recognition, typed text in place of the handwriting | `src/extensions/handwriting` |

## 1. AI core (1.9)

### What the user gets
- An **AI panel** in the editor: ask about the notebook, the current page or
  the selection.
- **Actions** on a selection or a page: summarise, explain, make a glossary,
  rewrite a text box, turn notes into a list or a table.
- The AI never changes the notebook directly. It returns an **edit plan**
  (see below). The app shows a preview of the plan. *Apply* adds it as one undo
  step.
- Every request shows what is sent (pages, pictures, the number of
  characters) before it leaves the computer.

### Providers and sign-in
Facts checked on 2026-11-24 (sources at the end):

| Provider | Sign-in | Notes |
|---|---|---|
| Anthropic (Claude) | **API key only** | Since February 2026 Anthropic does not allow third-party apps to use Claude Pro/Max subscription sign-in. |
| OpenAI (GPT) | API key; **"Sign in with ChatGPT"** where available | Launched October 2026 for a first group of partner apps, with use counted against the user's ChatGPT plan. Open-source tools are said to be eligible. Access for StudyNotes must be requested and confirmed before it is built. |
| Google (Gemini) | API key (AI Studio) | No official way for third-party apps to use a Gemini subscription is known. |
| Local model | none | Any OpenAI-compatible local server (Ollama, LM Studio) at `http://localhost:…`. Works offline, nothing leaves the computer. |

- Keys are stored with Electron `safeStorage` (Windows: DPAPI), never in
  settings files, logs, notebooks or the repository.
- Calls run in the **main process** (`src/main/ai.js`), never in the renderer
  or an extension. Extensions use `host.ai`.
- Per request: provider and model chosen in Settings → AI, a monthly limit
  for the number of requests, and a log of the requests (time, provider,
  size, without content).
- **With a Claude subscription (no API key):** the Claude app connects to
  StudyNotes as an MCP server ([CLAUDE-MCP.md](CLAUDE-MCP.md), built
  2026-11-24). The work then happens in the Claude window, with the user's
  plan. Next MCP tools: page pictures, underlining, applying an edit plan with
  a preview (after `sn-ai-edit-plan`).

### Edit plan (shared, queue task `sn-ai-edit-plan`)
The AI answers with JSON in a fixed format. `src/shared/ai-plan.js` checks it
and turns it into page data:
`addText`, `replaceText`, `underline` (terms in a text box), `highlight`,
`addBookmark`, `moveItem` (to another page), `addImage` (from the session's
material only), `addPage` (after a given page, with a title).
- Unknown operations, missing targets, pages outside the notebook and
  oversized text are refused with a reason. The plan is never partly applied
  without saying so.
- Nothing is deleted unless the user switched on "allow removing" for this
  request.

### Context (shared, queue task `sn-ai-context`)
`src/shared/ai-context.js` builds what is sent: page text (typed text, text
recognised from scans, PDF text), bookmarks, the selection and pictures on
request. Everything fits a size budget, current page and selection first, and
each piece carries an id so the edit plan can point at it.

## 2. Study session extension (1.9.x)

### Idea
While learning, the user works in the browser, in PDFs and in other apps. A
**study session** collects what is worth keeping. At the end, the AI files it
into the notebook.

### During the session
- **Floating bar** above all windows (always on top, small, draggable),
  similar to screen-sharing bars. It stays out of screenshots. It shows the
  session time, the number of items and the last item.
- **Capture** (buttons on the bar and global shortcuts, configurable):

  | Default shortcut | Captures |
  |---|---|
  | `Ctrl+Alt+S` | a region: drag a rectangle (mouse or touch) |
  | `Ctrl+Alt+W` | the window under the pointer |
  | `Ctrl+Alt+P` | the whole page: scrolls the window under the pointer and stitches the pictures (`sn-scroll-stitch`) |
  | `Ctrl+Alt+C` | the selected text (copied through the clipboard, which is restored afterwards) |
  | `Ctrl+Alt+N` | a short note typed into the bar |

- Each item keeps where it came from: app name, window title and, for
  browsers, the page address when the window title shows it.
- Works with every app on the screen, not only browsers. There is no browser
  extension.
- Laptop first: everything works with the keyboard and a touchpad. On touch
  screens the region is selected with a finger.

### At the end of the session
- The user chooses the **notebook and the topic** (free text) and an optional
  **own prompt** ("lecture notes in German, short, with formulas"). Prompts
  can be saved and reused.
- The AI gets the items (`sn-capture-session` groups and orders them) and
  returns an edit plan. Typical plan: new pages per sub-topic, bookmarks for
  the sections, text in its own words, the relevant pictures, key terms
  underlined.
- A preview shows the plan page by page. Single changes can be dropped. *Apply*
  is one undo step. The raw items stay in the session folder until the user
  deletes them.

### Android (2.0)
The same extension on Android uses a screen overlay and the system's screen
capture (with the user's permission each session). It is planned with
Android 2.0 and needs the same `host.capture` API.

## 3. Handwriting to text extension (1.9.x)

Like TypeDraw: written ink turns into typed text at the same place, in a
similar size, and can still be edited.

- **Local only.** The model runs on the computer through `onnxruntime-node`,
  as background removal already does. Nothing is sent anywhere. The model is
  downloaded once on request, checked against its SHA-256 and stored in the
  user data folder, not in the app.
- Model candidates (decided by measurement on a test set of handwriting in
  English, German and Russian, with accuracy and time per line): TrOCR small
  (handwritten), a CRNN/CTC line model. The size limit is 150 MB.
- **Use:** a switch next to the pencil options ("convert after writing"), and
  "Convert to text" on a selection of strokes. A convert button appears briefly
  after writing and can be undone. The original strokes can be kept hidden
  under the text.
- `src/shared/ink-lines.js` (queue task `sn-ink-lines`) groups strokes into
  lines and words and prepares them for the model. It also recognises what is
  not text (drawings, arrows, underlines), so they are left alone.

## Extension host API v2 (maintainer, 1.9)

New parts of the host, in addition to [API v1](EXTENSIONS.md). Extensions
still have no network and no file access of their own:

| API | For |
|---|---|
| `host.ai.request({ messages, images, schema })` | AI calls through the user's provider and limits; the user sees and confirms what is sent |
| `host.notebook.read(range)`, `host.notebook.preview(plan)`, `host.notebook.apply(plan)` | reading pages and applying a checked edit plan as one undo step |
| `host.capture.region() / window() / page() / selection()`, `host.capture.bar(spec)`, `host.capture.shortcuts(map)` | screen capture, the floating bar and global shortcuts (main process) |
| `host.ink.selection()`, `host.ink.replace(strokeIds, textBox)` | handwriting conversion |
| `host.models.ensure(id)`, `host.models.run(id, input)` | local models: download on request with a checksum, run in a worker |

## Queue tasks (now)

`ai-plan.js` and `ai-context.js` were built with the AI core and left the queue.


| Task | Module |
|---|---|
| `sn-capture-session` | `src/shared/capture-session.js` |
| `sn-scroll-stitch` | `src/shared/scroll-stitch.js` |
| `sn-ink-lines` | `src/shared/ink-lines.js` |

The extension tasks (`study-session`, `handwriting`) are added after host API
v2 is merged.

## Tests that decide "done"
- AI core: e2e with a fake provider (local test server): request preview,
  plan preview, apply, undo, refusal of a bad plan, no key in any file.
- Study session: e2e on Linux and Windows: shortcuts, region, window and
  scrolled page capture of a test window, session folder, AI plan with the
  fake provider, apply.
- Handwriting: a fixed set of written lines (synthetic and real, neutral
  content) with an error rate limit per language, and time per line on a
  laptop CPU.

## Sources
- Anthropic and subscription sign-in in other apps: [The Register, 2026-02-20](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access)
- Sign in with ChatGPT: [ProPakistani, 2026-10-23](https://propakistani.pk/2026/10/23/your-chatgpt-subscription-can-now-work-in-other-apps/), [OpenAI help](https://help.openai.com/articles/20001410)
- Gemini subscription for other apps: [Google AI developer forum, 2026-07](https://discuss.ai.google.dev/t/gemini-subscription-access-for-third-party-apps-is-a-sanctioned-program-planned/175577)
