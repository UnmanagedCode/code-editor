# Protocol

## Request guard (every `/api/*` except `/api/health`)
- Every request must carry `X-Code-Editor: 1` (`CSRF_HEADER` in `src/http/security.js`); without it, 403 `REQUEST_REFUSED`. A cross-site `<img>` or form cannot set a custom header, and a cross-origin `fetch` that does needs a preflight this backend never grants, so an Origin-less cross-site GET cannot trigger target-side work (search, listing). cc's proxy replays request headers unchanged, so the header reaches the backend. `api()` in the frontend sets it.
- Origin↔Host must match by host and port under Origin's scheme; a Host naming the backend's own listen port by a non-loopback name is refused. Non-GET/HEAD requests require an Origin. Refusal: 403 `REQUEST_REFUSED`.
- Non-GET/HEAD requests require `Content-Type: application/json` (415 `UNSUPPORTED_MEDIA_TYPE`).
- Every `/api` response carries `Cache-Control: no-store`.
- JSON body limits: `WRITE_BODY_LIMIT` for `PUT api/file`, `SMALL_BODY_LIMIT` elsewhere (413 `TOO_LARGE`).

## CSP (every response, including 404/503 and parser-rejected requests)
`CSP` in `src/http/security.js`, with `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`:

```
default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'
```

## Endpoints (relative URLs; target = `project` + optional `worktree`)
| Request | Body / query | 200 |
|---|---|---|
| `GET api/health` | — | `{ok}` |
| `GET api/roots` | — | `{projects: [{name, workspace (string or null), system, remoteId, unreachable, degraded, path, worktrees: [{name, branch, path}]}]}`; `path` = the root's absolute path on its System (cc's `path` / `worktreePath`), null when cc reports none |
| `GET api/sessions` | — | `{sessions: [{sessionId, project, worktree (name or null), label, status, lastActive}]}`: cc's live sessions (status not `exited`/`crashed`, non-null `sessionId`); `label` = cc's `displayLabel`, `lastActive` = `lastResponseAt ?? createdAt` (epoch ms); no other field passes through |
| `GET api/list` | `path` ('' = root) | `{path, entries: [{name, kind: file\|dir\|symlink\|other, target?: file\|dir\|other\|outside\|git\|broken, ignored, unsupported?}], truncated}` dirs first |
| `GET api/file` | `path` | `{path, size, kind: text\|binary, content?, hash?, truncated, readOnly, limitBytes}`; `hash` = sha256 of the bytes read (absent when truncated) |
| `PUT api/file` | `{path, content, expectedHash: string\|null}` (null = must not exist) | `{hash, size}`; stale → 409 `SAVE_CONFLICT {currentHash: string\|null}` |
| `POST api/entries` | `{path, type: file\|dir}` | 201 `{path}` |
| `POST api/rename` | `{from, to}` | `{from, to}` |
| `POST api/delete` | `{path}` | `{path}` |
| `GET api/search` | `q`, `regex=0\|1`, `case=0\|1` | `{engine, files: [{path, matches: [{line, text}]}], total, truncated, limit}` |
| `GET api/files` | — | `{engine, files, truncated, limit}` |

Paths are project-relative POSIX: no leading `/`, empty, `.`/`..` segments or `.git` segment (any letter case) (400 `INVALID_ARGUMENT` before reaching cc); `''` is allowed only for list.

## Refusal codes
`{error, code, …}` with: INVALID_ARGUMENT 400, NOT_A_DIRECTORY 400, NOT_A_FILE 400, SEARCH_INVALID 400, REQUEST_REFUSED 403, PATH_OUTSIDE_ROOT 403, PATH_REFUSED 403, PERMISSION_DENIED 403, NOT_FOUND 404, PROJECT_UNKNOWN 404, WORKTREE_UNKNOWN 404, ALREADY_EXISTS 409, SAVE_CONFLICT 409, TOO_LARGE 413, UNSUPPORTED_MEDIA_TYPE 415, OP_FAILED 422, OUTPUT_TOO_LARGE 422, INTERNAL 500, SEARCH_UNAVAILABLE 501, TOOL_MISSING 501, SYSTEM_UNREACHABLE 502 (`detail` = cc's code), CONDUCTOR_UNAVAILABLE 503, TIMEOUT 504. Source: `HTTP_STATUS` in `src/refusals.js`.

## ops.sh contract
Run as `sh -c <script> code-editor <op> <args…>`, cwd = the project's tree, `LC_ALL=C`. Ops: `list rel max`, `read rel cap`, `write rel expectedHash|-` (content on stdin), `create`, `mkdir`, `rename from to`, `delete`, `search fixed|regex sensitive|insensitive max snipBytes pattern`, `files max` (git engine: the paths, then a `/ignored` marker and the tracked files an ignore rule matches, to be subtracted). Exit codes map to refusals in `EXIT_REFUSALS` (`src/fs/script.js`): 65 NOT_FOUND, 66 PATH_OUTSIDE_ROOT, 67 ALREADY_EXISTS, 68 SAVE_CONFLICT (stdout = current hash or `-`), 69 NOT_A_DIRECTORY, 70 NOT_A_FILE, 71 PATH_REFUSED, 72 PERMISSION_DENIED, 73 SEARCH_INVALID (stderr = message), 74 SEARCH_UNAVAILABLE, 75 TOOL_MISSING (stderr = tool); any other non-zero → OP_FAILED. `list` output: NUL-separated `kind\0name\0` records (kinds `d f o l:d l:f l:o l:outside l:git l:broken`), then optional `/truncated\0`, then `/ignored\0` + paths.

## UI route keys
- `?project=&worktree=&file=` (replaceState; never the hash). The revealed line is not persisted.
- cc keys (`CC_KEYS` in `frontend/src/state/route.ts`: `ccProject`, `ccWorktree`, `ccPath`, `ccLine`, `ccEndLine`) are consumed on load and on `popstate`: removed from the URL, which then holds the current route (on load: no route until the request resolves). Values render as text only.
- `ccProject`/`ccWorktree` (cc's ⋮ menu items): validated against `api/roots`, then the root opens with no file; unknown → `Project not found: …` notice.
- `ccPath`/`ccLine`/`ccEndLine` (deep links, below). `ccPath` wins when both forms arrive.

## Deep links
```
http://cc.internal/#plugin/code-editor/?ccPath=<absolute path>&ccLine=<n>[&ccEndLine=<m>]
```
cc's stable plugin deep-link form; cc frames `/plugins/code-editor/` + the part after `#plugin/code-editor/`, so the query becomes the page's `location.search`.

| Key | Rule |
|---|---|
| `ccPath` | Absolute POSIX path on the project's System: `/`-led, no NUL, no empty (so no trailing `/`), `.` or `..` segment. Otherwise the request is invalid → `No project contains <path>` notice. |
| `ccLine` | Digits only, `1 ≤ n ≤ MAX_LINK_LINE` (`frontend/src/lib/limits.ts`). Invalid or missing → open the file, no reveal. |
| `ccEndLine` | Digits only, clamped to `MAX_LINK_LINE`; used only when greater than `ccLine`, else a single line. |

**Encoding:** percent-encode every path character outside `A–Z a–z 0–9 / . _ -` (`encodeCcPath`, `frontend/src/lib/ccLink.ts`):

| Raw | What goes wrong |
|---|---|
| `#` | cc accepts the link, but in the frame URL it starts the frame's own hash: `ccPath` arrives cut at the `#`. |
| `+` | Decodes as a space. |
| `%`, `&`, `=` | Break percent-decoding or split the query. |
| space, `(`, `)`, `<`, `>` | A space ends an autolink and is invalid in a markdown link destination; an unbalanced parenthesis ends the destination. |
| `?` | Survives inside the fragment; encoded anyway. A query *before* the `#` makes cc refuse the link (it renders as text). |
| `/` | Safe raw; `%2F` also works. |
| non-ASCII | Survives raw (the URL parser encodes it as UTF-8); encoding is also fine. |

The table rows are pinned in `frontend/src/test/ccLinkFixtures.ts`, decoded by `state/ccLink.test.ts` and checked against cc's real `viewLinkHash` by `npm run test:cc-link` ([architecture → Tests](architecture.md#tests)).

**Resolution** (`placeForPath`, `frontend/src/lib/placeFor.ts`): candidates are every project and worktree `path` from `api/roots` (one trailing `/` stripped) that is a prefix of `ccPath` at a `/` boundary; the longest wins; equal-length ties go to the place equal to `ccBridge.session`'s `(project, worktree)`, else no match. The remainder must pass `relPathError` (`frontend/src/lib/paths.ts`, the backend's relative-path rules). No match → notice, the open root is left alone.

## Comment prompt
`ccBridge.sendPrompt(sessionId, text)` with `text` built by `buildCommentPrompt` (`frontend/src/lib/commentPrompt.ts`):

````
Comment on [{label}]({link}) (project {project}[, worktree {worktree}]){dirtyNote}

{comment}

Selected text:
{fence}{lang}
{selection}
{fence}
[{truncation marker}]
````

- `link`: the deep link above for the selection's absolute path (root `path` + `/` + file) and lines.
- `label`: `{abs}:{start}[-{end}]`, ASCII punctuation other than `/ . - :` backslash-escaped, control characters percent-encoded.
- `dirtyNote` (only when the tab is dirty): ` — the editor buffer has unsaved changes; line numbers refer to the buffer, not the file on disk`.
- `comment`: trimmed. `fence`: one backtick longer than the longest backtick run in the selection, at least three. `lang`: the editor's language id for the file.
- A selection over `MAX_COMMENT_SELECTION_CHARS` is cut at a line boundary and followed by `[selection truncated: showing lines {start}–{k} of {start}–{end}]`.

## cc surfaces consumed
- `POST /api/exec` (form A: `project`, `worktree?`, `argv`, `env`, `stdinB64`, `encoding: base64`, `timeoutMs`, `maxOutputBytes`). cc refusals map in `src/cc/exec.js`.
- `GET /api/projects` (`name`, `path`, `worktrees[].worktreeName`/`worktreePath`/`branch`, placement fields).
- `GET /api/instances` (`sessionId`, `project`, `worktree.worktreeName`, `status`, `displayLabel`, `lastResponseAt`, `createdAt`).
- Bridge (`window.ccBridge`, optional, `frontend/src/lib/ccBridge.ts`): `session` (for the tie rule and the default session) and `sendPrompt` (a deadline of `SEND_PROMPT_TIMEOUT_MS` turns a missing reply into `TIMEOUT`). cc's `navigate` arrives as `popstate`.
- The `cc.internal` deep-link form above.
