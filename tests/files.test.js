import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { makeTree, readDisk } from './_fixtures.js';
import { startApp } from './_app.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const isRoot = process.getuid?.() === 0;

async function setup(t, opts = {}, treeOpts = {}) {
  const tree = makeTree(t, treeOpts);
  const app = await startApp(t, { projects: { app: { dir: tree.root } }, ...opts });
  const list = (p = '') => app.get(`/api/list?${app.q({ project: 'app', path: p })}`);
  const read = (p) => app.get(`/api/file?${app.q({ project: 'app', path: p })}`);
  const save = (p, content, expectedHash) => app.put('/api/file', { project: 'app', path: p, content, expectedHash });
  const create = (p, type) => app.post('/api/entries', { project: 'app', path: p, type });
  const rename = (from, to) => app.post('/api/rename', { project: 'app', from, to });
  const del = (p) => app.post('/api/delete', { project: 'app', path: p });
  return { ...tree, app, list, read, save, create, rename, del };
}

test('list: directories first, then case-insensitive by name; .git never listed', async (t) => {
  const { list } = await setup(t);
  const r = await list();
  assert.equal(r.status, 200);
  const names = r.body.entries.map((e) => e.name);
  assert.ok(!names.includes('.git'));
  const firstFile = r.body.entries.findIndex((e) => e.kind !== 'dir');
  assert.ok(r.body.entries.slice(0, firstFile).every((e) => e.kind === 'dir'));
  assert.ok(r.body.entries.slice(firstFile).every((e) => e.kind !== 'dir'));
  assert.deepEqual(names.slice(0, firstFile), ['build', 'empty-dir', 'src']);
  assert.ok(names.indexOf('notes.txt') < names.indexOf('README.md'), 'case-insensitive order');
});

test('list: ignored flags honour dir-only patterns, globs, and tracked files are never ignored', async (t) => {
  const { list } = await setup(t);
  const byName = Object.fromEntries((await list()).body.entries.map((e) => [e.name, e]));
  assert.equal(byName.build.ignored, true, 'build/ pattern');
  assert.equal(byName['debug.log'].ignored, true, '*.log');
  assert.equal(byName['ignored.txt'].ignored, true);
  assert.equal(byName['tracked.log'].ignored, false, 'tracked file matching an ignore pattern');
  assert.equal(byName['notes.txt'].ignored, false);
  assert.equal(byName.src.ignored, false);
});

test('list: a subdirectory is listed relative to the root; ignored flags still apply there', async (t) => {
  const { list } = await setup(t);
  const r = await list('src');
  assert.deepEqual(r.body.entries.map((e) => e.name), ['lib', 'main.ts']);
});

test('list: truncates at MAX_DIR_ENTRIES and says so', async (t) => {
  const { list } = await setup(t, { limits: { MAX_DIR_ENTRIES: 3 } });
  const r = await list();
  assert.equal(r.body.entries.length, 3);
  assert.equal(r.body.truncated, true);
});

test('list: a file is NOT_A_DIRECTORY, a missing path NOT_FOUND', async (t) => {
  const { list } = await setup(t);
  const a = await list('notes.txt');
  assert.equal(a.status, 400);
  assert.equal(a.body.code, 'NOT_A_DIRECTORY');
  const b = await list('nope');
  assert.equal(b.status, 404);
  assert.equal(b.body.code, 'NOT_FOUND');
});

test('list: a non-UTF-8 file name is returned flagged unsupported', async (t) => {
  const { app, root } = await setup(t);
  fs.writeFileSync(Buffer.concat([Buffer.from(root + '/bad-'), Buffer.from([0xff, 0xfe])]), 'x');
  const r = await app.get(`/api/list?${app.q({ project: 'app', path: '' })}`);
  const bad = r.body.entries.find((e) => e.name.startsWith('bad-'));
  assert.equal(bad.unsupported, true);
});

test('read: text comes with sha256 of exactly the bytes read', async (t) => {
  const { read, root } = await setup(t);
  const r = await read('notes.txt');
  assert.equal(r.status, 200);
  assert.equal(r.body.kind, 'text');
  assert.equal(r.body.content, 'alpha\nbeta needle\ngamma\n');
  assert.equal(r.body.hash, sha(readDisk(root, 'notes.txt')));
  assert.equal(r.body.readOnly, false);
  assert.equal(r.body.truncated, false);
});

test('read: NUL bytes and invalid UTF-8 are binary, with no content', async (t) => {
  const { read } = await setup(t);
  for (const f of ['bin.dat', 'latin1.txt']) {
    const r = await read(f);
    assert.equal(r.body.kind, 'binary', f);
    assert.equal(r.body.content, undefined);
    assert.ok(r.body.size > 0);
  }
});

test('read: a file over MAX_EDIT_BYTES is a truncated read-only prefix with the limit named', async (t) => {
  const { read } = await setup(t, { limits: { MAX_EDIT_BYTES: 8 } });
  const r = await read('notes.txt');
  assert.equal(r.body.truncated, true);
  assert.equal(r.body.readOnly, true);
  assert.equal(r.body.limitBytes, 8);
  assert.equal(r.body.size, 24);
  assert.equal(r.body.content, 'alpha\nbe');
  assert.equal(r.body.hash, undefined, 'a truncated read cannot be saved, so it has no hash');
});

test('read: a prefix cut inside a multi-byte character backs off to the boundary instead of turning binary', async (t) => {
  const { read, root } = await setup(t, { limits: { MAX_EDIT_BYTES: 5 } });
  fs.writeFileSync(path.join(root, 'u.txt'), 'abc€€'); // a(1)b(1)c(1)€(3): the cap lands inside the first €
  const r = await read('u.txt');
  assert.equal(r.body.kind, 'text');
  assert.equal(r.body.content, 'abc');
});

test('read: a directory is NOT_A_FILE, a missing file NOT_FOUND', async (t) => {
  const { read } = await setup(t);
  assert.equal((await read('src')).body.code, 'NOT_A_FILE');
  assert.equal((await read('missing.txt')).body.code, 'NOT_FOUND');
});

test('write: success updates the file and returns the hash of the bytes sent', async (t) => {
  const { read, save, root } = await setup(t);
  const { body: loaded } = await read('notes.txt');
  const r = await save('notes.txt', 'new ✓ content\n', loaded.hash);
  assert.equal(r.status, 200);
  assert.equal(readDisk(root, 'notes.txt').toString(), 'new ✓ content\n');
  assert.equal(r.body.hash, sha(readDisk(root, 'notes.txt')));
  assert.equal(r.body.size, Buffer.byteLength('new ✓ content\n'));
  assert.equal((await read('notes.txt')).body.hash, r.body.hash);
});

test('write: CRLF and BOM files round-trip byte for byte', async (t) => {
  const { read, save, root } = await setup(t);
  for (const f of ['crlf.txt', 'bom.txt']) {
    const before = readDisk(root, f);
    const { body } = await read(f);
    assert.equal((await save(f, body.content, body.hash)).status, 200);
    assert.ok(readDisk(root, f).equals(before), f);
  }
});

test('write: a change on disk since the load is a 409 SAVE_CONFLICT with the current hash, and the file is untouched', async (t) => {
  const { read, save, root } = await setup(t);
  const { body: loaded } = await read('notes.txt');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'worker edit\n');
  const r = await save('notes.txt', 'my edit\n', loaded.hash);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'SAVE_CONFLICT');
  assert.equal(r.body.currentHash, sha(Buffer.from('worker edit\n')));
  assert.equal(readDisk(root, 'notes.txt').toString(), 'worker edit\n');
  // The conflict's currentHash is exactly what Overwrite sends.
  assert.equal((await save('notes.txt', 'my edit\n', r.body.currentHash)).status, 200);
  assert.equal(readDisk(root, 'notes.txt').toString(), 'my edit\n');
});

test('write: a file deleted since the load conflicts with currentHash null; expectedHash null recreates it', async (t) => {
  const { read, save, root } = await setup(t);
  const { body: loaded } = await read('notes.txt');
  fs.rmSync(path.join(root, 'notes.txt'));
  const r = await save('notes.txt', 'again\n', loaded.hash);
  assert.equal(r.status, 409);
  assert.equal(r.body.currentHash, null);
  assert.equal((await save('notes.txt', 'again\n', null)).status, 200);
  assert.equal(readDisk(root, 'notes.txt').toString(), 'again\n');
});

test('write: expectedHash null means "must not exist": an existing file conflicts, a new one is created', async (t) => {
  const { save, root } = await setup(t);
  const a = await save('notes.txt', 'x', null);
  assert.equal(a.status, 409);
  assert.equal(a.body.currentHash, sha(readDisk(root, 'notes.txt')));
  const b = await save('src/new.ts', 'export {};\n', null);
  assert.equal(b.status, 200);
  assert.equal(readDisk(root, 'src/new.ts').toString(), 'export {};\n');
});

test('write: the file mode survives the atomic replace', async (t) => {
  const { read, save, root } = await setup(t);
  fs.chmodSync(path.join(root, 'notes.txt'), 0o755);
  const { body } = await read('notes.txt');
  await save('notes.txt', 'x\n', body.hash);
  assert.equal(fs.statSync(path.join(root, 'notes.txt')).mode & 0o777, 0o755);
});

test('write: a new file gets the umask default mode, not the temp file mode', async (t) => {
  const { save, root } = await setup(t);
  await save('fresh.txt', 'x\n', null);
  assert.notEqual(fs.statSync(path.join(root, 'fresh.txt')).mode & 0o044, 0, 'group/other readable by umask');
});

test('write: a read-only file is PERMISSION_DENIED', { skip: isRoot && 'root ignores file modes' }, async (t) => {
  const { read, save, root } = await setup(t);
  const { body } = await read('notes.txt');
  fs.chmodSync(path.join(root, 'notes.txt'), 0o444);
  const r = await save('notes.txt', 'x\n', body.hash);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'PERMISSION_DENIED');
  assert.equal(readDisk(root, 'notes.txt').toString(), 'alpha\nbeta needle\ngamma\n');
});

test('write: through an in-root symlink the link stays a link and its target changes', async (t) => {
  const { read, save, root } = await setup(t, {}, { symlinks: true });
  const { body } = await read('readme-link');
  assert.equal((await save('readme-link', 'via link\n', body.hash)).status, 200);
  assert.ok(fs.lstatSync(path.join(root, 'readme-link')).isSymbolicLink());
  assert.equal(readDisk(root, 'README.md').toString(), 'via link\n');
});

test('write: no .code-editor-* temp file is left behind, after success or a conflict', async (t) => {
  const { read, save, root } = await setup(t);
  const { body } = await read('notes.txt');
  await save('notes.txt', 'a\n', body.hash);
  await save('notes.txt', 'b\n', body.hash); // stale: conflict
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith('.code-editor-')), []);
});

test('write: content over MAX_EDIT_BYTES is refused 413 TOO_LARGE before reaching cc', async (t) => {
  const { app, save } = await setup(t, { limits: { MAX_EDIT_BYTES: 16 } });
  const before = app.fake.state.execCalls.length;
  const r = await save('notes.txt', 'x'.repeat(17), null);
  assert.equal(r.status, 413);
  assert.equal(r.body.code, 'TOO_LARGE');
  assert.equal(app.fake.state.execCalls.length, before);
});

test('write: lone surrogates and a malformed expectedHash are INVALID_ARGUMENT', async (t) => {
  const { save } = await setup(t);
  assert.equal((await save('notes.txt', 'a\ud800', null)).body.code, 'INVALID_ARGUMENT');
  assert.equal((await save('notes.txt', 'a', 'nothex')).body.code, 'INVALID_ARGUMENT');
});

test('create: a file and a folder; an existing name of either kind is ALREADY_EXISTS and unchanged', async (t) => {
  const { create, root } = await setup(t);
  assert.equal((await create('src/a.ts', 'file')).status, 201);
  assert.equal(fs.statSync(path.join(root, 'src/a.ts')).size, 0);
  assert.equal((await create('src/newdir', 'dir')).status, 201);
  assert.ok(fs.statSync(path.join(root, 'src/newdir')).isDirectory());
  for (const [p, type] of [['notes.txt', 'file'], ['src', 'file'], ['notes.txt', 'dir'], ['src', 'dir']]) {
    const r = await create(p, type);
    assert.equal(r.status, 409, `${type} ${p}`);
    assert.equal(r.body.code, 'ALREADY_EXISTS');
  }
  assert.equal(readDisk(root, 'notes.txt').toString(), 'alpha\nbeta needle\ngamma\n');
});

test('create: a missing parent is NOT_FOUND; a file as parent is NOT_A_DIRECTORY', async (t) => {
  const { create } = await setup(t);
  assert.equal((await create('nope/a.txt', 'file')).body.code, 'NOT_FOUND');
  assert.equal((await create('notes.txt/a.txt', 'file')).body.code, 'NOT_A_DIRECTORY');
});

test('rename: a file and a folder move; the old path is gone', async (t) => {
  const { rename, root } = await setup(t);
  assert.equal((await rename('notes.txt', 'renamed.txt')).status, 200);
  assert.ok(fs.existsSync(path.join(root, 'renamed.txt')));
  assert.ok(!fs.existsSync(path.join(root, 'notes.txt')));
  assert.equal((await rename('src', 'source')).status, 200);
  assert.ok(fs.existsSync(path.join(root, 'source/lib/util.ts')));
});

test('rename onto an existing name is ALREADY_EXISTS and neither side changes', async (t) => {
  const { rename, root } = await setup(t);
  const r = await rename('notes.txt', 'README.md');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'ALREADY_EXISTS');
  assert.equal(readDisk(root, 'notes.txt').toString(), 'alpha\nbeta needle\ngamma\n');
  assert.equal(readDisk(root, 'README.md').toString(), '# App\nhello world\n');
});

test('rename of a folder into itself is INVALID_ARGUMENT before reaching cc', async (t) => {
  const { app, rename } = await setup(t);
  const before = app.fake.state.execCalls.length;
  const r = await rename('src', 'src/lib/src');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'INVALID_ARGUMENT');
  assert.equal(app.fake.state.execCalls.length, before);
});

test('rename of a missing source is NOT_FOUND', async (t) => {
  const { rename } = await setup(t);
  assert.equal((await rename('ghost', 'x')).body.code, 'NOT_FOUND');
});

test('delete: a file and a non-empty folder; a missing path is NOT_FOUND', async (t) => {
  const { del, root } = await setup(t);
  assert.equal((await del('notes.txt')).status, 200);
  assert.ok(!fs.existsSync(path.join(root, 'notes.txt')));
  assert.equal((await del('src')).status, 200);
  assert.ok(!fs.existsSync(path.join(root, 'src')));
  assert.equal((await del('src')).body.code, 'NOT_FOUND');
});

test('names with spaces, newlines and a leading dash are handled without shell quoting', async (t) => {
  const { create, save, read, rename, root } = await setup(t);
  for (const name of ['-rf', 'a b', 'line\nbreak', '--help', "it's \"quoted\" $(x) `y`"]) {
    assert.equal((await create(name, 'file')).status, 201, name);
    const { body } = await read(name);
    assert.equal((await save(name, 'hi', body.hash)).status, 200, name);
    assert.equal((await rename(name, `${name}.bak`)).status, 200, name);
    assert.ok(fs.existsSync(path.join(root, `${name}.bak`)), name);
  }
});

test('a project in a worktree addresses the worktree tree; the main checkout omits `worktree`', async (t) => {
  const main = makeTree(t);
  const wt = makeTree(t, { git: false });
  fs.writeFileSync(path.join(wt.root, 'only-in-wt.txt'), 'wt');
  const app = await startApp(t, { projects: { app: { dir: main.root, worktrees: { w1: wt.root } } } });
  const a = await app.get(`/api/list?${app.q({ project: 'app', worktree: 'w1', path: '' })}`);
  assert.ok(a.body.entries.some((e) => e.name === 'only-in-wt.txt'));
  const b = await app.get(`/api/list?${app.q({ project: 'app', path: '' })}`);
  assert.ok(!b.body.entries.some((e) => e.name === 'only-in-wt.txt'));
  const calls = app.fake.state.execCalls;
  assert.equal(calls[0].worktree, 'w1');
  assert.ok(!('worktree' in calls[1]));
  assert.deepEqual(app.fake.state.violations, []);
  const c = await app.get(`/api/list?${app.q({ project: 'app', worktree: 'nope', path: '' })}`);
  assert.equal(c.body.code, 'WORKTREE_UNKNOWN');
  assert.equal((await app.get(`/api/list?${app.q({ project: 'zzz', path: '' })}`)).body.code, 'PROJECT_UNKNOWN');
});

test('input validation: missing project, bad type, missing expectedHash are INVALID_ARGUMENT', async (t) => {
  const { app } = await setup(t);
  assert.equal((await app.get('/api/list?path=')).body.code, 'INVALID_ARGUMENT');
  assert.equal((await app.get(`/api/file?${app.q({ project: 'app' })}`)).body.code, 'INVALID_ARGUMENT');
  assert.equal((await app.post('/api/entries', { project: 'app', path: 'x', type: 'symlink' })).body.code, 'INVALID_ARGUMENT');
  assert.equal((await app.put('/api/file', { project: 'app', path: 'x', content: '' })).body.code, 'INVALID_ARGUMENT');
});
