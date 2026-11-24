# Claude in StudyNotes (MCP)

The Claude app (Claude Desktop) can work with your notebooks: read them,
search them and, when you ask, add text, pages and bookmarks. It uses your
own Claude plan (Pro, Max, Team), so you need no API key. This works the same
way as the MCP plugins for Obsidian.

Anthropic allows a Claude subscription only in Claude's own apps (claude.ai,
Claude Desktop, Claude Code). StudyNotes therefore does not sign in to Claude
itself. Claude Desktop starts a small bridge that connects to the running
app.

## Set up (once)
1. StudyNotes: **Settings → Add-ons → Claude (MCP)**, switch it on.
2. Open its **Settings**, click **Connect Claude Desktop**. This adds
   StudyNotes to `claude_desktop_config.json` (Windows:
   `%APPDATA%\Claude\`) and keeps a copy of the old file as `.bak`.
3. Restart Claude Desktop. "studynotes" now appears in its list of tools.

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
| `read_notebook` | text page by page (typed text, tables, PDF text, recognised scan text), page range for long notebooks |
| `search_notes` | search across all notebooks |
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
