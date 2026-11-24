# Claude in StudyNotes (MCP)

The Claude app (Claude Desktop) can work with your notebooks: read them,
search them and, when you ask, add text, pages and bookmarks. It uses your
own Claude plan (Pro, Max, Team), so you need no API key. This works the same
way as the MCP plugins for Obsidian.

Anthropic allows a Claude subscription only in Claude's own apps (claude.ai,
Claude Desktop, Claude Code). StudyNotes therefore does not sign in to Claude
itself. Claude Desktop starts a small bridge that connects to the running
app.

## Chat inside StudyNotes (Claude Code)
Instead of Claude Desktop you can chat in StudyNotes itself, like the Claude
plugins for Obsidian (Claudian):
1. Install Claude Code and sign in once: run `claude` in a terminal.
2. **Settings → AI assistant → How to connect: Claude Code** → **Find Claude Code**
   (or enter its path). Choose a model if you like.
3. In a notebook press **Ctrl+J**: the chat opens on the right.

In the chat you can attach pictures, PDFs and text files (paper clip, drag and
drop, Ctrl+V); pictures and PDFs go to Claude as attachments, text files as
part of the message, and Claude can place an attached picture in the notes
(`write_notes` image block). All chats are kept in `chats.json` in the app's
user data folder (history button); the gear button has the model, your own
instructions and the notebook's notes style. Drag the panel's left edge to
make it wider.

StudyNotes starts `claude -p` with `--strict-mcp-config` and only the
StudyNotes tools allowed; built-in tools (files, shell, web) are blocked.
Whether this use of a subscription is covered by Anthropic's terms is not
settled; the settings say so.

## Set up Claude Desktop (once)
1. StudyNotes: **Settings → AI assistant → How to connect: Claude app**, switch
   on **Let the Claude app use StudyNotes**.
2. Click **Connect Claude Desktop**. This adds StudyNotes to every copy of
   `claude_desktop_config.json` (Windows: `%APPDATA%\Claude\` and, for the
   Microsoft Store build, `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\`)
   and keeps a copy of each old file as `.bak`. The check below the buttons
   shows which files now contain StudyNotes and whether the bridge answers.
3. **Quit Claude Desktop completely** (tray icon next to the clock → Quit,
   not only closing the window) and start it again. StudyNotes then appears
   under "+" → Connectors.

If it does not appear: click **Test connection**. Claude Desktop's own log is
in `%APPDATA%\Claude\logs\mcp-server-studynotes.log`.

## Use
Ask Claude in plain words, for example:
- "Which of my notebooks are about power electronics?"
- "Summarise page 3 of *Power electronics* and add the summary on a new page
  after it, with the title *Summary*."
- "Search my notes for *duty cycle* and bookmark the pages."

Claude Desktop asks before each tool is used, unless you allowed it for good.
Every change appears in the open notebook at once. **Ctrl+Z** in StudyNotes
undoes it.

## Tools
| Tool | Does |
|---|---|
| `list_notebooks` | notebooks with folder, pages, last change |
| `read_notebook` | text page by page (typed text, tables, PDF text, recognised scan text) and what else is on each page (paper, handwriting, pictures, how full), page range for long notebooks |
| `search_notes` | search across all notebooks |
| `write_notes` | notes as blocks (headings, paragraphs, lists, formulas, a framed box); StudyNotes places them on the ruled lines in the notes style, continues on new pages, never over a PDF page |
| `clear_page` | removes the user's text, ink and pictures from pages, after the user confirms in StudyNotes |
| `add_text` | a text box below what is on a page |
| `add_page` | a new page after a given page, optional bookmarked title |
| `bookmark_page` | set or remove a page bookmark |

Planned next (ROADMAP-1.9): pictures of pages for handwriting, underlining terms,
and applying a whole edit plan with a preview.

## Privacy
- The connection is a local pipe on your computer. Nothing is reachable from
  the network.
- Only what Claude reads with these tools goes to Claude, as part of your
  conversation. It is handled like anything else you send to Claude.
- Switching **Claude (MCP)** off closes the pipe at once.

## How it works (developers)
`claude_desktop_config.json` starts `StudyNotes.exe src/main/mcp-bridge.js` with
`ELECTRON_RUN_AS_NODE=1`. The bridge connects stdin/stdout to the app's pipe
(`src/main/mcp-pipe.js`) and starts the app if it is not running. The app
answers MCP (`src/shared/mcp-protocol.js`) in `src/main/mcp-server.js` and
runs the tools in the renderer (`src/renderer/mcp.js`, definitions in
`src/shared/mcp-tools.js`), through the editor and with undo. Test:
`test/e2e/mcp.js`.
