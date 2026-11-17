# Code Editor

A code-conductor (cc) plugin to browse, view, edit and search the files of any cc project or worktree from the cc UI, on desktop and on a phone, without a worker or a terminal. Local and remote-System projects behave the same.

## Using it

- Open it from cc's plugin nav, or from a project's or worktree's ⋮ menu ("Edit files").
- File tree, Monaco editor with tabs, Ctrl/Cmd+S save, create/rename/delete, search across files, Ctrl/Cmd+P quick open. Details: [docs/features.md](docs/features.md).
- Saves are conditional: a file a worker changed since you opened it is a conflict (view diff / overwrite / reload), never silently overwritten.

## Stack and layout

Node ≥ 24, Express backend (`server.js`, `src/`), React 19 + Vite + Tailwind + radix-ui frontend (`frontend/`) with Monaco bundled locally.

```
conductor.plugin.json   manifest (keepAlive, project + worktree menu items)
server.js, src/         backend: http/ (security, static), cc/ (exec client), fs/ (ops.sh helper), routes/
frontend/src/           editor/ (Monaco host), state/, components/
tests/                  node --test, with a fake cc
harness/playwright/     visual harness
docs/                   features, protocol, architecture
```

All file I/O is `POST $CONDUCTOR_URL/api/exec` running one POSIX `sh` helper (`src/fs/ops.sh`) on the project's own System; the backend never reads project paths itself. See [docs/architecture.md](docs/architecture.md).

## Run, test

- `npm install` builds `frontend/dist` (the `prepare` script). `npm start` listens on `127.0.0.1:$PORT` (default in `server.js`).
- `npm test` (backend `node --test` + Vitest), `npm run typecheck`.
- `CC_PROJECTS_ROOT=<projects root> npm run harness` runs the Playwright scenarios against a fake cc; screenshots land in `harness/playwright/out/`.
- Caps and timeouts are named constants in `src/limits.js`.

## Known limitations

- A save stages the new content first, then hashes and renames back to back on the target; a writer landing in the gap between that hash and the rename is still overwritten.
- Confinement refuses any `.git` component (any letter case) of a resolved path, covering request-borne tricks and symlinks that already exist; it does not stop a process racing the filesystem between resolution and the operation.
- Mixed line endings are normalised by Monaco; only UTF-8 files open as text.
- Regex dialect depends on the engine shown in the search panel (ripgrep, or `git grep -E` which needs a git work tree).
- Changes on disk are detected only at save, not live.
- Unsaved buffers are lost if cc evicts the page (plugin restart/update/disable).
- iOS Safari editing is limited; the phone layout is verified in Chromium mobile emulation. Windows is untested.
- No plugin icon: cc has no editor icon.
- The remote path is covered by the fake cc's provider emulation only.
