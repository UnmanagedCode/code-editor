import assert from 'node:assert/strict';
import test from 'node:test';
import { exec } from '../src/cc/exec.js';
import { startApp } from './_app.js';
import { makePlainTree } from './_fixtures.js';

async function setup(t) {
  const { root } = makePlainTree(t, { 'a.txt': 'x' });
  const app = await startApp(t, { projects: { p: { dir: root } } });
  const list = () => app.get(`/api/list?${app.q({ project: 'p', path: '' })}`);
  return { app, list, root };
}

test('cc exec refusals map to our codes', async (t) => {
  const { app, list } = await setup(t);
  const table = [
    [{ status: 404, body: { code: 'PROJECT_UNKNOWN', error: "project 'p' not found" } }, 404, 'PROJECT_UNKNOWN'],
    [{ status: 404, body: { code: 'WORKTREE_UNKNOWN', error: 'no such worktree' } }, 404, 'WORKTREE_UNKNOWN'],
    ...['SYSTEMS_UNAVAILABLE', 'SYSTEM_NOT_REGISTERED', 'SYSTEM_NO_PROVIDER', 'SYSTEM_NO_REMOTES', 'SYSTEM_UNREACHABLE', 'REMOTE_NOT_FOUND']
      .map((code) => [{ status: 502, body: { code, error: 'x' } }, 502, 'SYSTEM_UNREACHABLE']),
    [{ status: 504, body: { code: 'EXEC_TIMEOUT', error: 'x' } }, 504, 'TIMEOUT'],
    [{ status: 422, body: { code: 'EXEC_OUTPUT_TOO_LARGE', limitBytes: 5, error: 'x' } }, 422, 'OUTPUT_TOO_LARGE'],
    [{ status: 422, body: { code: 'EXEC_SPAWN_FAILED', error: 'x' } }, 501, 'TOOL_MISSING'],
    [{ status: 404, body: {} }, 503, 'CONDUCTOR_UNAVAILABLE'],
    [{ status: 502, raw: '<html>bad gateway</html>' }, 503, 'CONDUCTOR_UNAVAILABLE'],
    [{ status: 400, body: { code: 'INVALID_ARGUMENT', error: 'exec: bad' } }, 500, 'INTERNAL'],
  ];
  const origError = console.error;
  console.error = () => {};
  t.after(() => { console.error = origError; });
  for (const [hook, status, code] of table) {
    app.fake.state.execHook = () => hook;
    const r = await list();
    assert.equal(r.status, status, JSON.stringify(hook));
    assert.equal(r.body.code, code, JSON.stringify(hook));
  }
});

test('an unreachable-System refusal names the root and carries cc’s code as detail', async (t) => {
  const { app, list } = await setup(t);
  app.fake.state.execHook = () => ({ status: 502, body: { code: 'SYSTEM_NO_PROVIDER', error: 'x' } });
  const r = await list();
  assert.match(r.body.error, /System of p is unreachable/);
  assert.equal(r.body.detail, 'SYSTEM_NO_PROVIDER');
});

test('an exit code outside the helper contract is OP_FAILED (422) with the stderr tail', async (t) => {
  const { app, list } = await setup(t);
  app.fake.state.execHook = () => ({ status: 200, body: { exitCode: 3, stdout: '', stderr: Buffer.from('boom happened').toString('base64') } });
  const r = await list();
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'OP_FAILED');
  assert.match(r.body.error, /boom happened/);
});

test('CONDUCTOR_URL unset is 503 CONDUCTOR_UNAVAILABLE', async (t) => {
  const { list } = await setup(t);
  const saved = process.env.CONDUCTOR_URL;
  delete process.env.CONDUCTOR_URL;
  t.after(() => { process.env.CONDUCTOR_URL = saved; });
  const r = await list();
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'CONDUCTOR_UNAVAILABLE');
});

test('a read is retried after a dropped connection; a write is not', async (t) => {
  const { app, list } = await setup(t);
  let n = 0;
  app.fake.state.execHook = () => (n++ === 0 ? 'reset' : undefined);
  assert.equal((await list()).status, 200);
  assert.equal(app.fake.state.execCalls.length, 2, 'one reset, one retry');

  const before = app.fake.state.execCalls.length;
  app.fake.state.execHook = () => 'reset';
  const w = await app.put('/api/file', { project: 'p', path: 'a.txt', content: 'y', expectedHash: null });
  assert.equal(w.status, 503);
  assert.equal(app.fake.state.execCalls.length, before + 1, 'a write is sent exactly once');
});

test('exec kills a command that outlives timeoutMs and reports TIMEOUT', async (t) => {
  await setup(t);
  const started = Date.now();
  await assert.rejects(
    exec({ project: 'p', worktree: null }, ['sleep', '5'], { timeoutMs: 50, maxOutputBytes: 1024 }),
    (e) => e.code === 'TIMEOUT',
  );
  assert.ok(Date.now() - started < 3000, 'did not wait out the sleep');
});

test('exec past maxOutputBytes is OUTPUT_TOO_LARGE, never a clipped answer', async (t) => {
  await setup(t);
  await assert.rejects(
    exec({ project: 'p', worktree: null }, ['sh', '-c', 'head -c 10000 /dev/zero'], { timeoutMs: 5000, maxOutputBytes: 100 }),
    (e) => e.code === 'OUTPUT_TOO_LARGE',
  );
});

test('api/roots shapes projects with worktrees, system placement, and unreachable/degraded rows', async (t) => {
  const { root } = makePlainTree(t);
  const app = await startApp(t, { projects: {
    zeta: { dir: root, workspace: 'team', worktrees: { w1: root } },
    alpha: { dir: root, system: 'docker', remoteId: 'box' },
    down: { dir: root, system: 'docker', systemUnreachable: 'provider died' },
    bad: { dir: root, degraded: 'record unreadable' },
  } });
  const r = await app.get('/api/roots');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.projects.map((p) => [p.name, p]));
  assert.deepEqual(r.body.projects.map((p) => p.name), ['alpha', 'bad', 'down', 'zeta']);
  assert.deepEqual(by.zeta.worktrees, [{ name: 'w1', branch: 'code-conductor/w1' }]);
  assert.equal(by.zeta.system, 'local');
  assert.equal(by.zeta.remoteId, null);
  assert.equal(by.alpha.system, 'docker');
  assert.equal(by.alpha.remoteId, 'box');
  assert.equal(by.down.unreachable, 'provider died');
  assert.equal(by.bad.degraded, 'record unreadable');
  assert.equal(by.zeta.unreachable, null);
  assert.equal(by.zeta.workspace, 'team');
  assert.deepEqual([by.alpha, by.bad, by.down].map((p) => p.workspace), [null, null, null]);
});

test('api/roots is 503 CONDUCTOR_UNAVAILABLE when cc is not set or answers garbage', async (t) => {
  const { app } = await setup(t);
  app.fake.state.projectsHook = () => ({ status: 500, body: { error: 'x' } });
  assert.equal((await app.get('/api/roots')).body.code, 'CONDUCTOR_UNAVAILABLE');
  delete process.env.CONDUCTOR_URL;
  assert.equal((await app.get('/api/roots')).status, 503);
});
