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
| `GET api/roots` | — | `{projects: [{name, system, remoteId, unreachable, degraded, worktrees: [{name, branch}]}]}` |
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
`?project=&worktree=&file=` (replaceState; never the hash). `ccProject`/`ccWorktree` from cc's menu items are consumed on load and on `popstate`, validated against `api/roots`, then replaced by `project`/`worktree`; both render as text only.

## cc routes consumed
`POST /api/exec` (form A: `project`, `worktree?`, `argv`, `env`, `stdinB64`, `encoding: base64`, `timeoutMs`, `maxOutputBytes`) and `GET /api/projects`. cc refusals map in `src/cc/exec.js`.
