# Features

- **Entry points.** Plugin nav (root picker: a "Filter projects" box matching project name, workspace, worktree name and branch; projects grouped by workspace; worktrees behind a chevron with a "(main checkout)" row, pre-expanded when only a worktree matches or when the open root is one of its worktrees; the open root marked current; unreachable or unreadable projects listed disabled with their reason; the listing refreshed on every open; keyboard: Tab, Enter, Esc) and the project/worktree ⋮ menu items. The header shows the open root as text (`project` or `project / worktree`) plus a `system · remoteId` badge for non-local projects. The route is in the query string (see protocol).
- **Switching root** with unsaved buffers asks: Save all / Discard / Cancel (Cancel restores the URL).
- **Tree.** Lazy per folder; a Refresh button in the tree header re-lists every expanded folder; `.git` is never listed; gitignored entries hidden unless "Show ignored"; symlinks show a link icon and target kind; links pointing outside the root, into a `.git` directory, or broken are greyed, labelled and not openable. Names render as text only.
- **Editor.** Monaco tab per file, language from the file name, theme follows cc live. Binary files show a placeholder; files over `MAX_EDIT_BYTES` open read-only with a notice naming size and limit.
- **Save.** Ctrl/Cmd+S or the Save button. Closing a dirty tab asks Save / Discard / Cancel; `beforeunload` guards reload while any buffer is dirty.
- **Conflict.** A save refused because the file changed (or was deleted) on disk shows a bar: **View diff** (disk read-only vs live buffer), **Overwrite** (re-saves against the disk version you were shown; a further change conflicts again), **Reload** (replaces the buffer).
- **File operations.** New file/folder, Rename, Delete via right-click / long-press (context menu) or the per-row ⋮ button. Names are validated locally (no `/`, `.`, `..`, `.git`). Existing names are reported inline; nothing is overwritten. Open tabs follow renames and close on delete; Delete lists dirty tabs it would discard.
- **Search.** Query with Regex and Match case toggles, results grouped by file, capped (`MAX_SEARCH_RESULTS`) with a refine notice, engine label (`rg` or `git grep`). A result opens the file at its line, highlighted.
- **Quick open.** Ctrl/Cmd+P or button; fuzzy match over the project's file list (ignore rules applied, capped by `MAX_QUICKOPEN_FILES`).
- **Phone layout** (below Tailwind `md`). Files and Search open as sheets; icon buttons for Files, Search, Quick open, Save; per-row ⋮ always visible on touch; long-press opens the row menu; Monaco wraps lines, no minimap.
- **Unreachable System.** A listing failure (`SYSTEM_UNREACHABLE`, unknown project/worktree, cc unavailable) replaces the tree with an alert naming the root and a Retry.

## Opening a file from a session link

A link of the form in [protocol → Deep links](protocol.md#deep-links) in a session's reply opens Code Editor on that file, scrolled to the line or range, with the lines highlighted until the next edit or reveal.

- **Where it opens** is cc's rule: in the dock when a plugin is docked beside the session, else in the full plugin view in the same tab (Back returns to the conversation); a middle-click opens a new tab.
- **Which root:** the project or worktree whose path is the longest prefix of the link's absolute path, across every cc project and worktree. A worktree nested under its project's tree wins over the project, so a conductor's link into a worker's worktree opens in that worktree. Two roots with the identical path (projects on different Systems) resolve to cc's active session's place; otherwise the link does not resolve.
- **The open root** stays open: a link into it opens or activates the tab without reloading; other tabs and unsaved buffers stay. Following the same link again re-reveals.
- **Another root** goes through the root switch, so unsaved buffers ask Save all / Discard / Cancel first; Cancel drops the link.
- **No root contains the path** (or the path is not a clean absolute path): a text notice `No project contains <path>`; the open root is left alone. A file that does not exist shows the not-found refusal.
- **Standalone** (outside cc), a pasted `…/?ccPath=…&ccLine=…` URL opens and highlights the same way.

## Comment on selection

Select text in the editor and send a comment about it to a live cc session. The prompt cites the selection as a deep link, so the reference is clickable in the session's transcript.

- **Entry points:** "Comment on selection…" in the editor's context menu (keybinding Ctrl/Cmd+K Ctrl/Cmd+M), and a **Comment** button in the tab bar while the active tab has a non-empty selection (the touch path).
- **Dialog:** the reference (`<absolute path>:<start>[-<end>]`), a comment box (capped at `MAX_COMMENT_CHARS`, `frontend/src/lib/limits.ts`), a **Send to** picker of every live session (`label · project[ / worktree]`), Send / Cancel. Send needs a session and a non-blank comment.
- **Default session:** cc's active session when it works in the open root; else the most recently active live session in the open root; else none.
- **Sent:** the dialog closes and the tab bar shows `Sent to <session>` for a few seconds.
- **Refused:** the dialog and the comment stay, with a message per cc result code (`SESSION_NOT_READY`, `SESSION_NOT_LIVE`, `SESSION_UNKNOWN`, `VIEW_ONLY`, `SEND_FAILED`), or a timeout notice when cc does not answer within `SEND_PROMPT_TIMEOUT_MS` (the comment may then have been sent).
- **Unsaved buffer:** the prompt notes that its line numbers refer to the buffer, not the file on disk.
- **Lines:** the selection's first to last line; a selection ending at column 1 does not count that last line.
- **Unavailable:** outside cc (no `window.ccBridge`) the button is disabled and the action only says "Open Code Editor inside cc to send comments"; likewise when cc reports no path for the project.
- Session labels and the reference render as text only.

## Make sessions write links

Sessions write these links only when told to. After this version of Code Editor is installed on a cc that supports `cc.internal` deep links, add this line to **Settings → Conventions → Workspace** (it reaches every project's `CONVENTIONS.md` and the conductor's):

```
- **Cite code locations in replies as Code Editor links**, never in backticks or in files or commits: `[<path>:<line>](http://cc.internal/#plugin/code-editor/?ccPath=<absolute path>&ccLine=<n>&ccEndLine=<m>)`, `&ccEndLine` only for a range, percent-encoding path characters other than letters, digits and `/._-` — e.g. [src/app.ts:12-18](http://cc.internal/#plugin/code-editor/?ccPath=/srv/app/src/app.ts&ccLine=12&ccEndLine=18).
```

- Saving it regenerates each project's tracked `CONVENTIONS.md`; sessions commit that change on their next turn.
- Remove the line if Code Editor is disabled or uninstalled: links then open cc's unavailable-plugin view.
- On a cc without `cc.internal` deep links, such a link is an ordinary new-tab link to a host that resolves nowhere; do not add the line there.
