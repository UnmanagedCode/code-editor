import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { EXIT_REFUSALS, OPS_SCRIPT } from '../src/fs/script.js';
import { makeTree, mkTmp } from './_fixtures.js';

// The helper run directly with `sh -c`, no HTTP: the exit-code contract and shell edge cases.
const run = (cwd, op, args = [], input) => {
  const r = spawnSync('sh', ['-c', OPS_SCRIPT, 'code-editor', op, ...args], { cwd, input, env: { ...process.env, LC_ALL: 'C' } });
  return { code: r.status, out: r.stdout, err: r.stderr.toString() };
};

test('no op, an unknown op, and missing arguments exit 64 (usage)', (t) => {
  const d = mkTmp(t);
  assert.equal(run(d, '').code, 64);
  assert.equal(run(d, 'bogus').code, 64);
  for (const op of ['list', 'read', 'write', 'rename', 'search']) assert.equal(run(d, op, []).code, 64, op);
});

test('a root of / is refused', () => {
  const r = run('/', 'list', ['.', '10']);
  assert.equal(r.code, 71);
});

test('exit codes: not found 65, outside 66, exists 67, conflict 68, not dir 69, not file 70, refused 71', (t) => {
  const { root } = makeTree(t, { symlinks: true });
  assert.equal(run(root, 'read', ['./nope', '10']).code, 65);
  assert.equal(run(root, 'read', ['./out/secret.txt', '10']).code, 66);
  assert.equal(run(root, 'create', ['./notes.txt']).code, 67);
  const w = run(root, 'write', ['./notes.txt', '-'], 'x');
  assert.equal(w.code, 68);
  assert.equal(w.out.length, 64, 'the current hash is printed');
  assert.equal(run(root, 'list', ['./notes.txt', '10']).code, 69);
  assert.equal(run(root, 'read', ['./src', '10']).code, 70);
  assert.equal(run(root, 'delete', ['.']).code, 71);
  assert.equal(run(root, 'delete', ['./.git']).code, 71);
  assert.equal(run(root, 'read', ['./.git/HEAD', '10']).code, 71);
  for (const code of [65, 66, 67, 68, 69, 70, 71]) assert.ok(EXIT_REFUSALS[code], `${code} is mapped`);
});

test('list output: NUL-separated kind/name records, then /truncated and /ignored markers', (t) => {
  const { root } = makeTree(t);
  const r = run(root, 'list', ['.', '100']);
  const parts = r.out.toString('latin1').split('\0');
  assert.equal(parts.at(-1), '');
  const marker = parts.indexOf('/ignored');
  assert.ok(marker > 0);
  const records = parts.slice(0, marker);
  assert.equal(records.length % 2, 0);
  assert.ok(records.some((p, i) => i % 2 === 0 && p === 'd') && records.includes('src'));
  assert.ok(parts.slice(marker + 1).includes('build/'), 'dirs carry a trailing slash in the ignored list');
  const small = run(root, 'list', ['.', '2']);
  assert.ok(small.out.toString('latin1').includes('/truncated\0'));
});

test('names with a newline, a space and a leading dash survive list and ignore parsing', (t) => {
  const d = mkTmp(t);
  for (const n of ['a\nb', 'sp ace', '-dash', '--help']) fs.writeFileSync(path.join(d, n), 'x');
  const parts = run(d, 'list', ['.', '10']).out.toString('utf8').split('\0');
  for (const n of ['a\nb', 'sp ace', '-dash', '--help']) assert.ok(parts.includes(n), JSON.stringify(n));
});

test('list in a directory that is not a git repo has no /ignored section and still succeeds', (t) => {
  const d = mkTmp(t);
  fs.writeFileSync(path.join(d, 'a'), 'x');
  const r = run(d, 'list', ['.', '10']);
  assert.equal(r.code, 0);
  assert.ok(!r.out.toString().includes('/ignored'));
});

test('write refuses a conflict before touching the file and leaves no temp file', (t) => {
  const d = mkTmp(t);
  fs.writeFileSync(path.join(d, 'f'), 'orig');
  assert.equal(run(d, 'write', ['./f', 'e'.repeat(64)], 'new').code, 68);
  assert.equal(fs.readFileSync(path.join(d, 'f'), 'utf8'), 'orig');
  assert.deepEqual(fs.readdirSync(d), ['f']);
});

test('read prints the size line then at most cap bytes', (t) => {
  const d = mkTmp(t);
  fs.writeFileSync(path.join(d, 'f'), '0123456789');
  const r = run(d, 'read', ['./f', '4']);
  assert.equal(r.out.toString(), '10\n0123');
});

test('a search pattern that looks like an option is searched for, not parsed', (t) => {
  const { root } = makeTree(t);
  fs.writeFileSync(path.join(root, 'o.txt'), '--version\n');
  const r = run(root, 'search', ['fixed', 'sensitive', '10', '100', '--version']);
  assert.equal(r.code, 0);
  assert.match(r.out.toString(), /o\.txt/);
});

test('the helper refuses any .git component of a resolved path, however nested or cased (target layer, bypassing the backend)', (t) => {
  const { root } = makeTree(t, { symlinks: true });
  fs.mkdirSync(path.join(root, 'vendor/foo/.GIT'));
  fs.writeFileSync(path.join(root, 'vendor/foo/.GIT/config'), 'x');
  for (const p of ['./vendor/foo/.git/config', './leak/config', './leakdir/.git/config', './vendor/foo/.GIT/config']) {
    assert.equal(run(root, 'read', [p, '10']).code, 71, p);
  }
  assert.equal(run(root, 'list', ['./leak', '10']).code, 71);
  assert.equal(run(root, 'write', ['./leak/config', 'a'.repeat(64)], 'x').code, 71);
  assert.equal(run(root, 'create', ['./leak/x']).code, 71);
  assert.equal(run(root, 'mkdir', ['./leakdir/.git/d']).code, 71);
  assert.equal(run(root, 'rename', ['./notes.txt', './leak/x']).code, 71);
  assert.equal(run(root, 'rename', ['./leak/config', './stolen']).code, 71);
  assert.equal(run(root, 'delete', ['./leak/config']).code, 71);
  assert.equal(run(root, 'create', ['./.Git']).code, 71, 'a .Git leaf');
  assert.equal(run(root, 'delete', ['./.GIT']).code, 71);
});

test('list does not show a .git entry of any case', (t) => {
  const d = mkTmp(t);
  for (const n of ['.git', '.GIT', '.Git', 'keep']) fs.mkdirSync(path.join(d, n));
  const names = run(d, 'list', ['.', '10']).out.toString().split('\0').filter((_, i) => i % 2 === 1);
  assert.deepEqual(names, ['keep']);
});

// S2: the hash check runs against what is on disk at the moment of the rename, after the new content is staged.
// Each test holds stdin open (the helper blocks in its copy), changes the file behind it, then releases stdin.
async function raceWrite(cwd, args, mutate) {
  const child = spawn('sh', ['-c', OPS_SCRIPT, 'code-editor', 'write', ...args], { cwd, env: { ...process.env, LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const out = [];
  child.stdout.on('data', (d) => out.push(d));
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out: Buffer.concat(out).toString() })));
  const deadline = Date.now() + 10_000;
  while (!fs.readdirSync(cwd).some((n) => n.startsWith('.code-editor-'))) {
    if (Date.now() > deadline) throw new Error('the helper never staged a temp file');
    await new Promise((r) => setImmediate(r));
  }
  mutate();
  child.stdin.end('staged content');
  return done;
}

test('write: a file MODIFIED while the new content is being staged is a conflict, and the other writer’s content survives', async (t) => {
  const d = mkTmp(t);
  fs.writeFileSync(path.join(d, 'f'), 'orig');
  const hash = createHash('sha256').update('orig').digest('hex');
  const r = await raceWrite(d, ['./f', hash], () => fs.writeFileSync(path.join(d, 'f'), 'other writer'));
  assert.equal(r.code, 68);
  assert.equal(r.out, createHash('sha256').update('other writer').digest('hex'), 'the current hash is reported');
  assert.equal(fs.readFileSync(path.join(d, 'f'), 'utf8'), 'other writer');
  assert.deepEqual(fs.readdirSync(d), ['f'], 'the temp file is removed');
});

test('write: a file CREATED while the new content is being staged (expected "must not exist") is a conflict, not clobbered', async (t) => {
  const d = mkTmp(t);
  const r = await raceWrite(d, ['./new', '-'], () => fs.writeFileSync(path.join(d, 'new'), 'created concurrently'));
  assert.equal(r.code, 68);
  assert.equal(r.out, createHash('sha256').update('created concurrently').digest('hex'));
  assert.equal(fs.readFileSync(path.join(d, 'new'), 'utf8'), 'created concurrently');
  assert.deepEqual(fs.readdirSync(d), ['new']);
});

test('write: a file DELETED while staging, with a hash expected, is a conflict reporting "-" and nothing is created', async (t) => {
  const d = mkTmp(t);
  fs.writeFileSync(path.join(d, 'f'), 'orig');
  const hash = createHash('sha256').update('orig').digest('hex');
  const r = await raceWrite(d, ['./f', hash], () => fs.rmSync(path.join(d, 'f')));
  assert.equal(r.code, 68);
  assert.equal(r.out, '-');
  assert.deepEqual(fs.readdirSync(d), []);
});

test('write: with no concurrent change the staged content lands (the reordering did not break the happy paths)', async (t) => {
  const d = mkTmp(t);
  fs.writeFileSync(path.join(d, 'f'), 'orig');
  const hash = createHash('sha256').update('orig').digest('hex');
  assert.equal((await raceWrite(d, ['./f', hash], () => {})).code, 0);
  assert.equal(fs.readFileSync(path.join(d, 'f'), 'utf8'), 'staged content');
  assert.equal((await raceWrite(d, ['./g', '-'], () => {})).code, 0);
  assert.equal(fs.readFileSync(path.join(d, 'g'), 'utf8'), 'staged content');
});
