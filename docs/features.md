# Features

- **Entry points.** Plugin nav (root picker: projects with nested worktrees; unreachable or unreadable projects listed disabled with their reason) and the project/worktree ⋮ menu items. The header shows the open root as text (`project` or `project / worktree`) plus a `system · remoteId` badge for non-local projects. The route is in the query string (see protocol).
- **Switching root** with unsaved buffers asks: Save all / Discard / Cancel (Cancel restores the URL).
- **Tree.** Lazy per folder; a Refresh button in the tree header re-lists every expanded folder; `.git` is never listed; gitignored entries hidden unless "Show ignored"; symlinks show a link icon and target kind; links pointing outside the root or broken are greyed and not openable. Names render as text only.
- **Editor.** Monaco tab per file, language from the file name, theme follows cc live. Binary files show a placeholder; files over `MAX_EDIT_BYTES` open read-only with a notice naming size and limit.
- **Save.** Ctrl/Cmd+S or the Save button. Closing a dirty tab asks Save / Discard / Cancel; `beforeunload` guards reload while any buffer is dirty.
- **Conflict.** A save refused because the file changed (or was deleted) on disk shows a bar: **View diff** (disk read-only vs live buffer), **Overwrite** (re-saves against the disk version you were shown; a further change conflicts again), **Reload** (replaces the buffer).
- **File operations.** New file/folder, Rename, Delete via right-click / long-press (context menu) or the per-row ⋮ button. Names are validated locally (no `/`, `.`, `..`, `.git`). Existing names are reported inline; nothing is overwritten. Open tabs follow renames and close on delete; Delete lists dirty tabs it would discard.
- **Search.** Query with Regex and Match case toggles, results grouped by file, capped (`MAX_SEARCH_RESULTS`) with a refine notice, engine label (`rg` or `git grep`). A result opens the file at its line.
- **Quick open.** Ctrl/Cmd+P or button; fuzzy match over the project's file list (ignore rules applied, capped by `MAX_QUICKOPEN_FILES`).
- **Phone layout** (below Tailwind `md`). Files and Search open as sheets; icon buttons for Files, Search, Quick open, Save; per-row ⋮ always visible on touch; long-press opens the row menu; Monaco wraps lines, no minimap.
- **Unreachable System.** A listing failure (`SYSTEM_UNREACHABLE`, unknown project/worktree, cc unavailable) replaces the tree with an alert naming the root and a Retry.
