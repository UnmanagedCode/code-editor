import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// A fake cc REST host: GET /api/projects, GET /api/projects/:name/worktrees, GET /api/instances and POST /api/exec, the exec request
// validated as strictly as cc's src/hostExec.ts. Exec runs argv for real on this machine in the resolved directory.
//
// A project with `system !== 'local'` is emulated the way a provider differs from local: its reported `path` does not
// exist here (so any local fs use by the backend fails the tests), the environment is REPLACED (PATH, HOME, LC_ALL plus
// the request's overlay) and stdin is staged to a 0600 file a /bin/sh wrapper opens onto fd 0 and deletes before exec.

const KEYS = new Set(['project', 'worktree', 'system', 'remoteId', 'cwd', 'argv', 'shell', 'env', 'stdin', 'stdinB64', 'timeoutMs', 'encoding', 'maxOutputBytes']);
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const BODY_LIMIT = 16 * 1024 * 1024;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

class Answer extends Error {
  constructor(status, body) { super(body.error); this.status = status; this.body = body; }
}
const invalid = (error) => new Answer(400, { error: `exec: ${error}`, code: 'INVALID_ARGUMENT' });
const bounded = (v, name, max, dflt) => {
  if (v === undefined) return dflt;
  if (!Number.isInteger(v) || v <= 0 || v > max) throw invalid(`${name} must be a positive integer no greater than ${max}`);
  return v;
};

const isRemote = (p) => (p.system ?? 'local') !== 'local';

function parse(state, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('the body must be a JSON object');
  for (const k of Object.keys(body)) if (!KEYS.has(k)) throw invalid(`unknown field ${JSON.stringify(k)}`);
  const formA = body.project !== undefined || body.worktree !== undefined;
  const formB = body.system !== undefined || body.remoteId !== undefined || body.cwd !== undefined;
  if (formB) state.violations.push({ kind: 'formB', body });
  if (body.shell !== undefined) state.violations.push({ kind: 'shell', body });
  if (formA && formB) throw invalid('name the target by project or by system, not both');
  if (!formA) throw invalid('the fake serves form A only');
  if (typeof body.project !== 'string' || !body.project) throw invalid('project must be a non-empty string');
  if (body.worktree !== undefined && (typeof body.worktree !== 'string' || !body.worktree)) throw invalid('worktree must be a non-empty string');
  if ((body.argv !== undefined) === (body.shell !== undefined)) throw invalid('give exactly one of argv and shell');
  if (body.shell !== undefined) throw invalid('the fake does not run shell form');
  const { argv } = body;
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string' || a.includes('\0')) || !argv[0]) throw invalid('argv must be a non-empty array of strings without NUL');
  if (body.env !== undefined) {
    if (!body.env || typeof body.env !== 'object' || Array.isArray(body.env)) throw invalid('env must be an object of string values');
    for (const [k, v] of Object.entries(body.env)) {
      if (!ENV_NAME_RE.test(k)) throw invalid(`env name ${JSON.stringify(k)}`);
      if (typeof v !== 'string' || v.includes('\0')) throw invalid(`env value for ${k} must be a string without NUL`);
    }
  }
  if (body.stdin !== undefined && body.stdinB64 !== undefined) throw invalid('give at most one of stdin and stdinB64');
  if (body.stdin !== undefined && typeof body.stdin !== 'string') throw invalid('stdin must be a string');
  if (body.stdinB64 !== undefined && (typeof body.stdinB64 !== 'string' || !B64_RE.test(body.stdinB64))) throw invalid('stdinB64 must be strict base64');
  if (body.encoding !== undefined && !['utf8', 'base64'].includes(body.encoding)) throw invalid("encoding must be 'utf8' or 'base64'");
  const proj = state.projects[body.project];
  if (!proj) throw new Answer(404, { error: `project '${body.project}' not found`, code: 'PROJECT_UNKNOWN' });
  let cwd = proj.dir;
  if (body.worktree) {
    cwd = proj.worktrees?.[body.worktree];
    if (!cwd) throw new Answer(404, { error: `worktree '${body.worktree}' not found`, code: 'WORKTREE_UNKNOWN' });
  }
  if (state.down.has(body.project)) throw new Answer(502, { error: 'provider down', code: 'SYSTEM_UNREACHABLE' });
  return {
    proj, cwd, argv, env: body.env ?? {},
    stdin: body.stdinB64 !== undefined ? Buffer.from(body.stdinB64, 'base64') : body.stdin !== undefined ? Buffer.from(body.stdin, 'utf8') : null,
    encoding: body.encoding ?? 'utf8',
    timeoutMs: bounded(body.timeoutMs, 'timeoutMs', MAX_TIMEOUT_MS, 120_000),
    maxOutputBytes: bounded(body.maxOutputBytes, 'maxOutputBytes', MAX_OUTPUT_BYTES, 64 * 1024 * 1024),
  };
}

/** A directory of symlinks to every executable on the real PATH except `hidden`; cached per hidden set. */
function pathWithout(state, hidden) {
  const key = [...hidden].sort().join(',');
  if (state.pathDirs.has(key)) return state.pathDirs.get(key);
  const dir = fs.mkdtempSync(path.join(state.home, 'path-'));
  for (const d of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    let names;
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (hidden.has(n)) continue;
      const target = path.join(d, n);
      try {
        fs.accessSync(target, fs.constants.X_OK);
        if (!fs.statSync(target).isFile()) continue;
        fs.symlinkSync(target, path.join(dir, n));
      } catch { /* already linked by an earlier PATH entry, or not executable */ }
    }
  }
  state.pathDirs.set(key, dir);
  return dir;
}

function childEnv(state, spec) {
  const hidden = new Set(spec.proj.hideTools ?? []);
  const PATH = hidden.size ? pathWithout(state, hidden) : process.env.PATH;
  if (isRemote(spec.proj)) return { PATH, HOME: state.home, LC_ALL: 'C.UTF-8', ...spec.env };
  return { ...process.env, PATH, ...spec.env };
}

/** Resolves the waiters registered for `kind` ('exec' | 'disconnect'). */
function notify(state, kind) {
  const rest = [];
  for (const w of state.waiters) (w.kind === kind ? w.resolve() : rest.push(w));
  state.waiters = rest;
}

function run(state, spec, req, res, body) {
  const started = Date.now();
  let argv = spec.argv;
  let staged = null;
  if (spec.stdin && isRemote(spec.proj)) {
    staged = path.join(state.home, `stdin-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(staged, spec.stdin, { mode: 0o600 });
    argv = ['/bin/sh', '-c', 'f=$1; shift; exec < "$f"; rm -f "$f"; exec "$@"', 'stage', staged, ...argv];
  }
  const child = spawn(argv[0], argv.slice(1), { cwd: spec.cwd, env: childEnv(state, spec), detached: true });
  state.children.add(child);
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
  const out = [];
  const err = [];
  let bytes = 0;
  let done = false;
  const enc = (chunks) => Buffer.concat(chunks).toString(spec.encoding);
  const finish = (status, payload) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (staged) fs.rmSync(staged, { force: true });
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
  };
  const timer = setTimeout(() => {
    kill();
    finish(504, { error: 'exec: timed out', code: 'EXEC_TIMEOUT', stdout: enc(out), stderr: enc(err), encoding: spec.encoding, durationMs: Date.now() - started });
  }, spec.timeoutMs);
  const collect = (into) => (chunk) => {
    bytes += chunk.length;
    if (bytes > spec.maxOutputBytes) {
      kill();
      return finish(422, { error: 'exec: output too large', code: 'EXEC_OUTPUT_TOO_LARGE', limitBytes: spec.maxOutputBytes });
    }
    into.push(chunk);
  };
  child.stdout.on('data', collect(out));
  child.stderr.on('data', collect(err));
  child.on('error', (e) => finish(422, { error: `exec: ${e.message}`, code: 'EXEC_SPAWN_FAILED', errno: e.code ?? null }));
  child.on('close', (code, signal) => {
    state.children.delete(child);
    finish(200, {
      exitCode: code ?? (signal ? 128 : 1), stdout: enc(out), stderr: enc(err), encoding: spec.encoding,
      durationMs: Date.now() - started,
    });
  });
  child.stdin.on('error', () => {}); // the command may exit before reading stdin
  if (staged) child.stdin.end(); else child.stdin.end(spec.stdin ?? undefined);
  res.on('close', () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (staged) fs.rmSync(staged, { force: true });
    state.disconnects.push(body);
    notify(state, 'disconnect');
    kill();
  });
}

/**
 * Starts the fake and points CONDUCTOR_URL at it; `close()` restores it.
 * `projects`: {name: {dir, workspace?, system?, remoteId?, worktrees?: {name: dir}, systemUnreachable?, degraded?, hideTools?: [names]}}.
 * Knobs on the returned object: `state.instances` (the rows GET /api/instances answers), `state.instancesHook()` → `{status, body}` | `'reset'`, `state.execCalls`, `state.violations` (any form-B or shell use), `state.disconnects`,
 * `state.execHook(body)` → `{status, body}` | `{status, raw}` | `'hold'` | `'reset'` | undefined, `systemDown(project, down)`.
 */
export async function fakeCc({ projects = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-fakecc-'));
  const state = {
    projects, home, execCalls: [], violations: [], disconnects: [], execHook: null, instances: [], instancesHook: null,
    down: new Set(), children: new Set(), pathDirs: new Map(), projectsRequests: 0, waiters: [],
  };
  const sockets = new Set();
  const send = (res, body, status = 200) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/exec') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > BODY_LIMIT) { res.statusCode = 413; res.end('{}'); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (size > BODY_LIMIT) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, { error: 'bad json', code: 'INVALID_ARGUMENT' }, 400); }
        state.execCalls.push(body);
        notify(state, 'exec');
        let spec;
        try {
          spec = parse(state, body);
        } catch (e) {
          if (!(e instanceof Answer)) throw e;
          return send(res, e.body, e.status);
        }
        const hooked = state.execHook?.(body);
        if (hooked === 'reset') return req.socket.destroy();
        if (hooked === 'hold') { // never answered; a client disconnect is recorded
          res.on('close', () => { if (!res.writableEnded) { state.disconnects.push(body); notify(state, 'disconnect'); } });
          return;
        }
        if (hooked?.raw !== undefined) { res.statusCode = hooked.status; return res.end(hooked.raw); }
        if (hooked) return send(res, hooked.body, hooked.status);
        run(state, spec, req, res, body);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      state.projectsRequests++;
      if (state.projectsHook) { const h = state.projectsHook(); if (h === 'reset') return req.socket.destroy(); if (h) return send(res, h.body, h.status); }
      return send(res, Object.entries(state.projects).map(([name, p]) => ({
        name, path: p.degraded ? '' : (isRemote(p) ? `/srv/cc-remote/${name}` : p.dir), workspace: p.workspace ?? null,
        system: p.system ?? 'local', remoteId: p.remoteId ?? null,
        systemUnreachable: p.systemUnreachable ?? null, gitRefusal: null,
        ...(p.degraded ? { degraded: p.degraded } : {}),
        worktrees: Object.entries(p.worktrees ?? {}).map(([w, dir]) => ({ worktreeName: w, branch: `code-conductor/${w}`, worktreePath: isRemote(p) ? `/srv/cc-remote/${name}/.worktrees/${w}` : dir })),
      })));
    }
    if (req.method === 'GET' && url.pathname === '/api/instances') {
      if (state.instancesHook) { const h = state.instancesHook(); if (h === 'reset') return req.socket.destroy(); if (h) return send(res, h.body, h.status); }
      return send(res, state.instances);
    }
    const m = req.method === 'GET' && url.pathname.match(/^\/api\/projects\/([^/]+)\/worktrees$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const p = state.projects[name];
      if (!p) return send(res, { error: `project '${name}' not found`, code: 'PROJECT_UNKNOWN' }, 404);
      return send(res, Object.entries(p.worktrees ?? {}).map(([w, dir]) => ({ parentProject: name, worktreeName: w, worktreePath: isRemote(p) ? `/srv/cc-remote/${name}/.worktrees/${w}` : dir, branch: `code-conductor/${w}`, baseBranch: 'main', sessionIds: [] })));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = process.env.CONDUCTOR_URL;
  const url = `http://127.0.0.1:${server.address().port}`;
  process.env.CONDUCTOR_URL = url;
  return {
    state,
    url,
    server,
    /** Resolves when the next exec request arrives / the next exec's client disconnects. */
    nextExec() { return new Promise((resolve) => state.waiters.push({ kind: 'exec', resolve })); },
    nextDisconnect() { return new Promise((resolve) => state.waiters.push({ kind: 'disconnect', resolve })); },
    systemDown(project, down = true) { if (down) state.down.add(project); else state.down.delete(project); },
    async close() {
      if (prev === undefined) delete process.env.CONDUCTOR_URL; else process.env.CONDUCTOR_URL = prev;
      for (const c of state.children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
