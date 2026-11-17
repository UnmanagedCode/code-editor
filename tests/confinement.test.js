import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { startApp } from './_app.js';
import { makeTree } from './_fixtures.js';

// Both layers: the backend refuses malformed paths before cc; ops.sh refuses symlink escapes on the target itself.

async function setup(t) {
  const tree = makeTree(t, { symlinks: true });
  const app = await startApp(t, { projects: { app: { dir: tree.root } } });
  const call = {
    list: (p) => app.get(`/api/list?${app.q({ project: 'app', path: p })}`),
    read: (p) => app.get(`/api/file?${app.q({ project: 'app', path: p })}`),
    save: (p, content, expectedHash = null) => app.put('/api/file', { project: 'app', path: p, content, expectedHash }),
    create: (p, type = 'file') => app.post('/api/entries', { project: 'app', path: p, type }),
    rename: (from, to) => app.post('/api/rename', { project: 'app', from, to }),
    del: (p) => app.post('/api/delete', { project: 'app', path: p }),
  };
  const outsideSnapshot = () => ({
    names: fs.readdirSync(tree.outside.dir).sort(),
    secret: fs.readFileSync(path.join(tree.outside.dir, 'secret.txt'), 'utf8'),
    file: fs.readFileSync(tree.outside.file, 'utf8'),
  });
  return { ...tree, app, ...call, outsideSnapshot };
}

const refusedWith = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.code, code);
};

test('list classifies links: outside, broken, in-root dir; .git never appears', async (t) => {
  const { list } = await setup(t);
  const by = Object.fromEntries((await list('')).body.entries.map((e) => [e.name, e]));
  assert.equal(by.out.target, 'outside');
  assert.equal(by.outfile.target, 'outside');
  assert.equal(by.gitlink.target, 'outside', 'a link into .git is never offered');
  assert.equal(by.broken.target, 'broken');
  assert.equal(by.inner.target, 'dir');
  assert.equal(by['readme-link'].target, 'file');
  assert.equal(by.loop.target, 'dir');
  assert.ok(!('.git' in by));
});

test('an in-root link to a directory lists and reads through; a loop link is harmless', async (t) => {
  const { list, read } = await setup(t);
  assert.deepEqual((await list('inner')).body.entries.map((e) => e.name), ['lib', 'main.ts']);
  assert.equal((await read('inner/main.ts')).status, 200);
  assert.equal((await read('loop/notes.txt')).status, 200);
  assert.equal((await list('loop')).status, 200);
});

test('list, read, write, create and mkdir through a link to an outside dir or file are PATH_OUTSIDE_ROOT; nothing outside changes', async (t) => {
  const { list, read, save, create, outsideSnapshot } = await setup(t);
  const before = outsideSnapshot();
  refusedWith(await list('out'), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await read('out/secret.txt'), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await read('outfile'), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await save('out/secret.txt', 'pwned', 'a'.repeat(64)), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await save('out/new.txt', 'pwned', null), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await save('outfile', 'pwned', 'a'.repeat(64)), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await create('out/new.txt', 'file'), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await create('out/newdir', 'dir'), 403, 'PATH_OUTSIDE_ROOT');
  assert.deepEqual(outsideSnapshot(), before);
});

test('a link to .git is PATH_REFUSED for read and write, and nothing under .git changes', async (t) => {
  const { read, save, list, root } = await setup(t);
  const head = fs.readFileSync(path.join(root, '.git/HEAD'), 'utf8');
  const config = fs.readFileSync(path.join(root, '.git/config'), 'utf8');
  refusedWith(await read('gitlink/HEAD'), 403, 'PATH_REFUSED');
  refusedWith(await list('gitlink'), 403, 'PATH_REFUSED');
  refusedWith(await save('gitlink/config', 'evil', 'a'.repeat(64)), 403, 'PATH_REFUSED');
  refusedWith(await save('gitlink/new', 'evil', null), 403, 'PATH_REFUSED');
  assert.equal(fs.readFileSync(path.join(root, '.git/HEAD'), 'utf8'), head);
  assert.equal(fs.readFileSync(path.join(root, '.git/config'), 'utf8'), config);
  assert.ok(!fs.existsSync(path.join(root, '.git/new')));
});

test('deleting a link removes only the link; the outside directory and its contents survive', async (t) => {
  const { del, root, outside, outsideSnapshot } = await setup(t);
  const before = outsideSnapshot();
  assert.equal((await del('out')).status, 200);
  assert.ok(!fs.existsSync(path.join(root, 'out')) && !fs.lstatSync(root).isSymbolicLink());
  assert.throws(() => fs.lstatSync(path.join(root, 'out')));
  assert.deepEqual(outsideSnapshot(), before);
  assert.ok(fs.existsSync(outside.dir));
  assert.equal((await del('outfile')).status, 200);
  assert.equal(fs.readFileSync(outside.file, 'utf8'), 'outside file\n');
});

test('renaming a link moves the link only', async (t) => {
  const { rename, root, outsideSnapshot } = await setup(t);
  const before = outsideSnapshot();
  assert.equal((await rename('out', 'out2')).status, 200);
  assert.ok(fs.lstatSync(path.join(root, 'out2')).isSymbolicLink());
  assert.throws(() => fs.lstatSync(path.join(root, 'out')));
  assert.deepEqual(outsideSnapshot(), before);
});

test('delete and rename through a link parent are refused, and the outside file stays', async (t) => {
  const { del, rename, outsideSnapshot, root } = await setup(t);
  fs.writeFileSync(path.join(root, 'src/a'), 'a');
  const before = outsideSnapshot();
  refusedWith(await del('out/secret.txt'), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await rename('out/secret.txt', 'stolen.txt'), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await rename('src/a', 'out/a'), 403, 'PATH_OUTSIDE_ROOT');
  refusedWith(await rename('src/a', 'gitlink/a'), 403, 'PATH_REFUSED');
  assert.ok(fs.existsSync(path.join(root, 'src/a')));
  assert.ok(!fs.existsSync(path.join(root, 'stolen.txt')));
  assert.deepEqual(outsideSnapshot(), before);
  assert.ok(!fs.existsSync(path.join(root, '.git/a')));
});

test('a broken link reads as NOT_FOUND and cannot be written through', async (t) => {
  const { read, save, root } = await setup(t);
  refusedWith(await read('broken'), 404, 'NOT_FOUND');
  refusedWith(await save('broken', 'x', null), 404, 'NOT_FOUND');
  assert.ok(!fs.existsSync(path.join(root, 'nope')));
});

test('the root, .git, "..", absolute and doubled-slash paths are refused 400 before any exec call', async (t) => {
  const { del, rename, read, list, save, create, app } = await setup(t);
  const before = app.fake.state.execCalls.length;
  for (const r of [
    await del(''), await del('.git'), await del('src/.git/x'), await rename('', 'x'), await rename('src', '.git/x'), await rename('.git', 'x'),
    await read('../outside-file.txt'), await read('/etc/passwd'), await read('a//b'), await read('.git/config'),
    await list('..'), await list('/'), await save('../x', 'x', null), await create('a/../../x'),
  ]) {
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, 'INVALID_ARGUMENT');
  }
  assert.equal(app.fake.state.execCalls.length, before, 'refused input never reaches cc');
});
