# StudyNotes – notes for Claude

GoodNotes-like Electron app (Windows). Main process: `src/main`, renderer: `src/renderer`, shared: `src/shared`.

## Code map (graphify)
A knowledge graph of the code is in `graphify-out/` (`GRAPH_REPORT.md`, `graph.html`, `graph.json`).
- Before searching the code, read `graphify-out/GRAPH_REPORT.md` or ask the graph:
  `graphify query "how does Drive sync skip open notebooks"`, `graphify explain "Editor"`, `graphify affected "writeNotebook"`.
- After changing code: `npm run graph` (AST only, no API key, ~10 s).
- Setup on a new PC: `pip install graphifyy` (or `uv tool install graphifyy`), then `graphify install` for the `/graphify` skill.

## Checks
- `npm test` (unit), `npm run build`, e2e: `xvfb-run -a node test/e2e/<suite>.js`.
- Plans and lessons: `tasks/todo.md`, `tasks/lessons.md`.
