import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { startApp } from './_app.js';
import { makeTree, readDisk } from './_fixtures.js';

const hasRg = spawnSync('sh', ['-c', 'command -v rg']).status === 0;

// The same golden path against a project the fake reports as living on another System (system 'docker', remoteId 'box').
// The fake gives such a project a path that does not exist here, replaces the env, and stages stdin like a provider.

async function golden(t, system) {
  const tree = makeTree(t);
  const app = await startApp(t, { projects: { p: { dir: tree.root, ...(system ? { system: 'docker', remoteId: 'box' } : {}), hideTools: ['rg'] } } });
  const q = (extra) => app.q({ project: 'p', ...extra });
  const out = {};
  out.list = (await app.get(`/api/list?${q({ path: '' })}`)).body.entries.map((e) => `${e.kind}:${e.name}:${e.ignored}`);
  const loaded = (await app.get(`/api/file?${q({ path: 'notes.txt' })}`)).body;
  out.read = loaded;
  out.write = (await app.put('/api/file', { project: 'p', path: 'notes.txt', content: 'changed ✓\n', expectedHash: loaded.hash })).body;
  fs.writeFileSync(path.join(tree.root, 'notes.txt'), 'worker\n');
  const conflict = await app.put('/api/file', { project: 'p', path: 'notes.txt', content: 'mine\n', expectedHash: out.write.hash });
  out.conflict = { status: conflict.status, code: conflict.body.code };
  out.create = (await app.post('/api/entries', { project: 'p', path: 'newdir', type: 'dir' })).status;
  out.rename = (await app.post('/api/rename', { project: 'p', from: 'newdir', to: 'moved' })).status;
  out.delete = (await app.post('/api/delete', { project: 'p', path: 'moved' })).status;
  out.search = (await app.get(`/api/search?${q({ q: 'needle' })}`)).body;
  out.files = (await app.get(`/api/files?${q({})}`)).body.files.sort();
  out.disk = readDisk(tree.root, 'notes.txt').toString();
  return { out, app };
}

test('a remote-System project behaves exactly like a local one across the whole golden path', async (t) => {
  const local = await golden(t, false);
  const remote = await golden(t, true);
  assert.deepEqual(remote.out, local.out);
  assert.equal(remote.out.search.engine, 'git');
  assert.equal(remote.out.conflict.code, 'SAVE_CONFLICT');
  assert.deepEqual(remote.app.fake.state.violations, [], 'form A, argv only');
});

test('every exec call is form A with argv: no shell, no system/remoteId/cwd, no null worktree', async (t) => {
  const { app } = await golden(t, true);
  assert.ok(app.fake.state.execCalls.length >= 9);
  for (const c of app.fake.state.execCalls) {
    assert.deepEqual(Object.keys(c).filter((k) => ['shell', 'system', 'remoteId', 'cwd'].includes(k)), []);
    assert.ok(Array.isArray(c.argv));
    assert.equal(c.argv[0], 'sh');
    assert.equal(c.encoding, 'base64');
    assert.ok(c.worktree === undefined);
    assert.deepEqual(c.env, { LC_ALL: 'C' });
  }
});

test('the rg engine works the same on a remote project when rg exists there', { skip: !hasRg && 'rg is not on PATH here' }, async (t) => {
  const { root } = makeTree(t);
  const app = await startApp(t, { projects: { p: { dir: root, system: 'docker', remoteId: 'box' } } });
  const r = await app.get(`/api/search?${app.q({ project: 'p', q: 'needle' })}`);
  assert.equal(r.body.engine, 'rg');
  assert.equal(r.body.total, 3);
});

test('an unreachable System answers 502 SYSTEM_UNREACHABLE naming the root on every route', async (t) => {
  const { root } = makeTree(t);
  const app = await startApp(t, { projects: { box: { dir: root, system: 'docker', remoteId: 'box', worktrees: { w: root } } } });
  app.fake.systemDown('box');
  const h = { project: 'box' };
  const results = [
    await app.get(`/api/list?${app.q({ ...h, path: '' })}`),
    await app.get(`/api/file?${app.q({ ...h, path: 'notes.txt' })}`),
    await app.put('/api/file', { ...h, path: 'notes.txt', content: 'x', expectedHash: null }),
    await app.post('/api/entries', { ...h, path: 'x', type: 'file' }),
    await app.post('/api/rename', { ...h, from: 'notes.txt', to: 'y' }),
    await app.post('/api/delete', { ...h, path: 'notes.txt' }),
    await app.get(`/api/search?${app.q({ ...h, q: 'a' })}`),
    await app.get(`/api/files?${app.q(h)}`),
    await app.get(`/api/list?${app.q({ ...h, worktree: 'w', path: '' })}`),
  ];
  for (const r of results) {
    assert.equal(r.status, 502);
    assert.equal(r.body.code, 'SYSTEM_UNREACHABLE');
    assert.match(r.body.error, /box/);
  }
  assert.match(results.at(-1).body.error, /box\/w/);
  assert.equal(fs.existsSync(path.join(root, 'x')), false);
});

test('a remote project is served with the stdin staged before the script runs: a save of non-trivial bytes round-trips', async (t) => {
  const { root } = makeTree(t);
  const app = await startApp(t, { projects: { p: { dir: root, system: 'docker', remoteId: 'box' } } });
  const content = `${'line ✓ ünï\n'.repeat(20_000)}`;
  const r = await app.put('/api/file', { project: 'p', path: 'big.txt', content, expectedHash: null });
  assert.equal(r.status, 200);
  assert.equal(readDisk(root, 'big.txt').toString(), content);
  assert.deepEqual(fs.readdirSync(app.fake.state.home).filter((n) => n.startsWith('stdin-')), [], 'staged stdin is removed');
});
