# Architecture

## Backend modules
`src/app.js` wires security → API router → static UI → 404 → errors. `src/http/` (security, static allowlist `ASSET_RE`, route wrapper), `src/cc/` (`exec` = the only door to files; `projects`), `src/fs/` (`paths` validation, `script` loader + exit-code map, `files`/`search` build args and parse output, `ops.sh` target helper), `src/routes/`, `src/limits.js` (all caps; the body, output and timeout caps derive from `MAX_EDIT_BYTES` and stay within cc's exec caps, pinned by `tests/limits.test.js`).

## Two-layer confinement
1. Backend: `normalizeRel` refuses absolute, `..`, `.`, empty and `.git` segments before any exec call.
2. Target (`ops.sh`): `ROOT=$(pwd -P)`; existing paths resolve with `realpath -e` and must be inside ROOT and not under `.git`; entry operations resolve the parent and keep the leaf literal, so renaming/deleting a symlink acts on the link. Residual risk: a filesystem race between resolution and operation.

## Conditional save
Load: backend hashes the bytes it returns. Save: `write` re-hashes the file on the target, refuses (exit 68, current hash) on mismatch, else writes a temp file in the same directory and `mv`s it over the resolved path (mode preserved, symlinks stay links). cc stages stdin before the script starts, so the check–rename window is local to the target.

## Search
`ops.sh` uses `rg` when present, else `git grep` inside a work tree, else exits SEARCH_UNAVAILABLE. Both honour ignore rules and skip `.git`; the first output line names the engine. Result and snippet caps are enforced on the target and again in Node; a stderr message from the engine is SEARCH_INVALID.

## Frontend
- `state/route.ts` (query-string route), `state/roots.ts`, `state/tree.ts` (lazy dirs), `state/tabs.ts` (pure reducer + `useTabs` side effects), `state/files.ts` (open/save/conflict flow).
- Dirty = `getAlternativeVersionId()` differs from the version recorded at load/save.
- `EditorHost` (`editor/EditorHost.ts`) is the only surface the UI uses for Monaco; `editor/monaco.ts` implements it and is the only importer of `monaco-editor`. Workers are same-origin ES-module assets (`editor/monacoEnv.ts`).
- Theme: `useTheme()` observes `<html class>`; `buildMonacoTheme` converts cc's oklch tokens to hex and `applyMonacoTheme` re-applies on each change.
- Layout: `Workspace` renders a sidebar (desktop) or sheets (below `md`); `App` owns the root guard so every root change goes through the URL.
- `frontend/dist` is built by `prepare`; the manifest is `keepAlive`.

## Tests
- Backend: `node --test`; `tests/_fakeCc.js` runs argv for real and emulates a remote System (nonexistent reported path, replaced env, staged stdin, `hideTools` to drop `rg`). Tests needing `rg` skip when it is not on PATH.
- UI: Vitest + happy-dom; `src/test/fakeBackend.ts` (in-memory project behind `endpoints`) and `fakeEditorHost.ts`; `safety.test.ts` scans sources for banned sinks.
- Harness: `harness/playwright/` runs scenarios standalone, and embedded behind `host.mjs` (cc's real bridge, proxy with Host/Origin unchanged). A scenario fails on CSP violations, page errors, JS dialogs, cross-origin requests and undeclared ≥400 responses.
