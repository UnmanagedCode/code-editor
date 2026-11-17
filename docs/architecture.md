# Architecture

## Backend modules
`src/app.js` wires security → API router → static UI → 404 → errors. `src/http/` (security, static allowlist `ASSET_RE`, route wrapper), `src/cc/` (`exec` = the only door to files; `projects`), `src/fs/` (`paths` validation, `script` loader + exit-code map, `files`/`search` build args and parse output, `ops.sh` target helper), `src/routes/`, `src/limits.js` (all caps; the body, output and timeout caps derive from `MAX_EDIT_BYTES` and stay within cc's exec caps, pinned by `tests/limits.test.js`).

## Conditional save
Load: the backend hashes the bytes it returns. Save: `write` first stages the new content (`mktemp` in the target directory, `cat` of stdin, mode copied), and only then hashes the file on disk and compares, immediately before the rename. A mismatch (or a file that appeared or vanished) is exit 68 with the current hash, and the temp file is removed. An existing file is replaced with `mv -f`; a new file ("must not exist") with the no-clobber `mv -n -T`, and a temp file that survives it means the file appeared meanwhile, again a conflict. Mode and symlinks are preserved (the write goes to the resolved path). cc stages stdin on the target before the script starts, so the network round trip is over before the helper runs; what remains of the race is the gap between the hash and the rename, local to the target.

The UI serialises saves of one tab and applies each response to its tab by id, so a rename or a second save in flight cannot misdirect it; Rename and Delete are disabled for a file while its save is in flight, and likewise for a folder containing such a file; a rename or delete already confirmed from an open dialog first waits for the queued saves of the affected tabs (the path and anything under it). A BOM (which Monaco strips from the buffer) is remembered per tab and written back.

## Two-layer confinement
1. Backend: `normalizeRel` refuses absolute, `..`, `.`, empty and `.git` segments (in any letter case) before any exec call.
2. Target (`ops.sh`): `ROOT=$(pwd -P)`; existing paths resolve with `realpath -e` and entry operations resolve the parent (the leaf stays literal, so renaming or deleting a symlink acts on the link). `allowed()` then refuses the resolved path when it is outside ROOT, when **any** component of it relative to ROOT is `.git` in any letter case (the root's or a nested repository's, reached directly or through a symlink), or when it or an ancestor is the same file as `$ROOT/.git` (`-ef`). A symlink in the tree can therefore never lead into a `.git` directory.

Residual risk: a filesystem race between path resolution and the operation (a directory swapped for a symlink inside one helper run) is not defended; confinement covers request-borne path tricks and symlinks that already exist.

## Search
`ops.sh` uses `rg` when present, else `git grep` inside a work tree, else exits SEARCH_UNAVAILABLE. Both honour ignore rules and skip `.git`. rg skips every file an ignore rule matches; `git ls-files` lists tracked ones regardless, so the helper appends the tracked files a rule matches after a `/ignored` marker and the backend subtracts them, which keeps the two engines' file lists identical. Result records are parsed with the NUL-terminated path first, so a newline in a file name is not a record boundary. The first output line names the engine. Result and snippet caps are enforced on the target and again in Node (a file name containing newlines uses up the helper's line budget, so a capped result can hold fewer records than the limit; the UI therefore says only that results were capped); a stderr message from the engine is SEARCH_INVALID.

## Frontend
- `state/route.ts` (query-string route), `state/roots.ts` (keeps the last project list while a reload runs or fails), `lib/rootFilter.ts` (pure filter and workspace grouping for the picker), `components/RootPicker.tsx` (`RootPicker` header dialog and `RootBrowser`, also the no-root landing page), `state/tree.ts` (lazy dirs), `state/tabs.ts` (pure reducer + `useTabs` side effects), `state/files.ts` (open/save/conflict flow).
- Dirty = `getAlternativeVersionId()` differs from the version recorded at load/save.
- `EditorHost` (`editor/EditorHost.ts`) is the only surface the UI uses for Monaco; `editor/monaco.ts` implements it and is the only importer of `monaco-editor`. Workers are same-origin ES-module assets (`editor/monacoEnv.ts`).
- Theme: `useTheme()` observes `<html class>`; `buildMonacoTheme` converts cc's oklch tokens to hex and `applyMonacoTheme` re-applies on each change.
- Layout: `Workspace` renders a sidebar (desktop) or sheets (below `md`); `App` owns the root guard so every root change goes through the URL.
- `frontend/dist` is built by `prepare`.
- **keepAlive.** The manifest sets `frontend.keepAlive`: leaving cc's plugin view otherwise removes the iframe without a `beforeunload`, silently dropping unsaved buffers. With keep-alive the frame is only hidden, so buffers survive; they are lost only when cc evicts the page (plugin restart, update, disable, or a cc reload, which prompts via `beforeunload`).
- The tree header has a Refresh button (re-lists every expanded folder and drops the quick-open cache); `useTabs` disposes every buffer when the workspace unmounts.

## Tests
- Backend: `node --test`; `tests/_fakeCc.js` runs argv for real and emulates a remote System (nonexistent reported path, replaced env, staged stdin, `hideTools` to drop `rg`). Tests needing `rg` skip when it is not on PATH.
- UI: Vitest + happy-dom; `src/test/fakeBackend.ts` (in-memory project behind `endpoints`) and `fakeEditorHost.ts`; `safety.test.ts` scans sources for banned sinks.
- Harness: `harness/playwright/` runs scenarios standalone, and embedded behind `host.mjs` (cc's real bridge, proxy with Host/Origin unchanged). A scenario fails on CSP violations, page errors, JS dialogs, cross-origin requests and undeclared ≥400 responses.
