import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { startApp } from './_app.js';
import { makePlainTree, makeTree } from './_fixtures.js';

const hasRg = spawnSync('sh', ['-c', 'command -v rg']).status === 0;
const rgSkip = !hasRg && 'ripgrep (rg) is not on PATH here';

async function setup(t, engine, { limits, files } = {}) {
  const tree = makeTree(t);
  for (const [rel, data] of Object.entries(files ?? {})) fs.writeFileSync(path.join(tree.root, rel), data);
  const app = await startApp(t, { projects: { app: { dir: tree.root, ...(engine === 'git' ? { hideTools: ['rg'] } : {}) } }, limits });
  const search = (q, { regex = 0, matchCase = 0 } = {}) => app.get(`/api/search?${app.q({ project: 'app', q, regex, case: matchCase })}`);
  const listFiles = () => app.get(`/api/files?${app.q({ project: 'app' })}`);
  return { ...tree, app, search, listFiles };
}

for (const engine of ['rg', 'git']) {
  const skip = engine === 'rg' ? rgSkip : false;
  const label = (s) => `[${engine}] ${s}`;

  test(label('plain search finds matches grouped by file and names the engine'), { skip }, async (t) => {
    const { search } = await setup(t, engine);
    const r = await search('needle');
    assert.equal(r.status, 200);
    assert.equal(r.body.engine, engine);
    const paths = r.body.files.map((f) => f.path).sort();
    assert.deepEqual(paths, ['notes.txt', 'src/lib/util.ts', 'src/main.ts']);
    const main = r.body.files.find((f) => f.path === 'src/main.ts');
    assert.deepEqual(main.matches, [{ line: 2, text: '// needle here' }]);
    assert.equal(r.body.total, 3);
    assert.equal(r.body.truncated, false);
  });

  test(label('gitignored files and .git are never searched'), { skip }, async (t) => {
    const { search } = await setup(t, engine);
    const paths = (await search('needle')).body.files.map((f) => f.path);
    for (const ignored of ['ignored.txt', 'build/out.js', 'debug.log']) assert.ok(!paths.includes(ignored), ignored);
    const inGit = await search('repositoryformatversion');
    assert.deepEqual(inGit.body.files, []);
  });

  test(label('plain mode treats regex characters literally; regex mode does not'), { skip }, async (t) => {
    const { search } = await setup(t, engine);
    assert.equal((await search('ne+dle')).body.total, 0);
    assert.equal((await search('ne+dle', { regex: 1 })).body.total, 3);
    assert.equal((await search('answer = 4.', { regex: 0 })).body.total, 0);
  });

  test(label('case toggle'), { skip }, async (t) => {
    const { search } = await setup(t, engine);
    assert.equal((await search('NEEDLE')).body.total, 3);
    assert.equal((await search('NEEDLE', { matchCase: 1 })).body.total, 0);
    assert.equal((await search('needle', { matchCase: 1 })).body.total, 3);
  });

  test(label('a pattern starting with a dash is a pattern, not an option'), { skip }, async (t) => {
    const { search } = await setup(t, engine, { files: { 'dash.txt': 'a -needle- b\n', 'opt.txt': '--files\n' } });
    assert.deepEqual((await search('-needle-')).body.files.map((f) => f.path), ['dash.txt']);
    assert.deepEqual((await search('--files')).body.files.map((f) => f.path), ['opt.txt']);
  });

  test(label('a file whose NAME contains a newline is reported under its exact name, and its neighbours are intact'), { skip }, async (t) => {
    const { search } = await setup(t, engine, { files: { 'we\nird.txt': 'needle in a weird name\nsecond needle\n' } });
    const r = await search('needle');
    const weird = r.body.files.find((f) => f.path === 'we\nird.txt');
    assert.deepEqual(weird.matches, [{ line: 1, text: 'needle in a weird name' }, { line: 2, text: 'second needle' }]);
    assert.deepEqual(r.body.files.map((f) => f.path).sort(), ['notes.txt', 'src/lib/util.ts', 'src/main.ts', 'we\nird.txt']);
    assert.equal(r.body.total, 5);
  });

  test(label('results stop at MAX_SEARCH_RESULTS and say truncated'), { skip }, async (t) => {
    const { search } = await setup(t, engine, { limits: { MAX_SEARCH_RESULTS: 2 } });
    const r = await search('needle');
    assert.equal(r.body.total, 2);
    assert.equal(r.body.truncated, true);
    assert.equal(r.body.limit, 2);
  });

  test(label('a very long matching line is cut to MAX_SNIPPET_BYTES, at a character boundary'), { skip }, async (t) => {
    const { search } = await setup(t, engine, { limits: { MAX_SNIPPET_BYTES: 50 }, files: { 'long.txt': `needle ${'€'.repeat(2000)}\n` } });
    const r = await search('needle');
    const m = r.body.files.find((f) => f.path === 'long.txt').matches[0];
    assert.ok(Buffer.byteLength(m.text) <= 50, `${Buffer.byteLength(m.text)} bytes`);
    assert.ok(!m.text.includes('�'));
    assert.ok(m.text.startsWith('needle'));
  });

  test(label('an invalid regex is a 400 SEARCH_INVALID with the engine message'), { skip }, async (t) => {
    const { search } = await setup(t, engine);
    const r = await search('(', { regex: 1 });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'SEARCH_INVALID');
    assert.ok(r.body.error.length > 0);
  });

  test(label('files: ignore rules apply, .git is excluded'), { skip }, async (t) => {
    const { listFiles } = await setup(t, engine);
    const r = await listFiles();
    assert.equal(r.status, 200);
    assert.equal(r.body.engine, engine);
    assert.ok(r.body.files.includes('src/main.ts'));
    assert.ok(r.body.files.includes('.gitignore'));
    assert.ok(!r.body.files.includes('ignored.txt'));
    assert.ok(!r.body.files.includes('build/out.js'));
    assert.ok(!r.body.files.some((f) => f === '.git' || f.startsWith('.git/')));
    assert.ok(r.body.files.every((f) => !f.startsWith('./')));
  });

  test(label('files: truncates at MAX_QUICKOPEN_FILES'), { skip }, async (t) => {
    const { listFiles } = await setup(t, engine, { limits: { MAX_QUICKOPEN_FILES: 3 } });
    const r = await listFiles();
    assert.equal(r.body.files.length, 3);
    assert.equal(r.body.truncated, true);
  });
}

test('[git] untracked, non-ignored files are searched and listed', async (t) => {
  const { search, listFiles } = await setup(t, 'git', { files: { 'fresh.txt': 'needle fresh\n' } });
  assert.ok((await search('needle')).body.files.some((f) => f.path === 'fresh.txt'));
  assert.ok((await listFiles()).body.files.includes('fresh.txt'));
});

test('empty or over-long q, and bad flags, are 400 INVALID_ARGUMENT', async (t) => {
  const { app, search } = await setup(t, 'git', { limits: { MAX_QUERY_LENGTH: 5 } });
  assert.equal((await search('')).body.code, 'INVALID_ARGUMENT');
  assert.equal((await search('abcdef')).body.code, 'INVALID_ARGUMENT');
  assert.equal((await app.get(`/api/search?${app.q({ project: 'app', q: 'a', regex: 'yes' })}`)).body.code, 'INVALID_ARGUMENT');
  assert.equal((await app.get(`/api/search?${app.q({ project: 'app' })}`)).body.code, 'INVALID_ARGUMENT');
});

test('with neither rg nor a git work tree, search and files are 501 SEARCH_UNAVAILABLE', async (t) => {
  const { root } = makePlainTree(t, { 'a.txt': 'needle\n' });
  const app = await startApp(t, { projects: { plain: { dir: root, hideTools: ['rg'] } } });
  for (const url of [`/api/search?${app.q({ project: 'plain', q: 'needle' })}`, `/api/files?${app.q({ project: 'plain' })}`]) {
    const r = await app.get(url);
    assert.equal(r.status, 501);
    assert.equal(r.body.code, 'SEARCH_UNAVAILABLE');
  }
});

test('a search that cc reports as timed out is 504 TIMEOUT "search timed out"', async (t) => {
  const { app, search } = await setup(t, 'git');
  app.fake.state.execHook = () => ({ status: 504, body: { code: 'EXEC_TIMEOUT', error: 'timed out' } });
  const r = await search('needle');
  assert.equal(r.status, 504);
  assert.equal(r.body.code, 'TIMEOUT');
  assert.match(r.body.error, /search timed out/);
});

test('a search whose client disconnects is aborted toward cc (cancel = disconnect)', async (t) => {
  const { app } = await setup(t, 'git');
  app.fake.state.execHook = () => 'hold';
  const arrived = app.fake.nextExec();
  const gone = app.fake.nextDisconnect();
  const ctl = new AbortController();
  const p = fetch(`${app.base}/api/search?${app.q({ project: 'app', q: 'x' })}`, { signal: ctl.signal, headers: { 'x-code-editor': '1' } }).catch(() => {});
  await arrived;
  ctl.abort();
  await gone;
  await p;
});

test('[git] quick-open excludes tracked files that match an ignore rule, like rg does', async (t) => {
  const { listFiles, root } = await setup(t, 'git');
  fs.writeFileSync(path.join(root, 'build/forced.js'), 'x');
  execFileSync('git', ['add', '-f', 'build/forced.js'], { cwd: root });
  const files = (await listFiles()).body.files;
  assert.ok(!files.includes('tracked.log'), 'tracked.log is tracked but matches *.log');
  assert.ok(!files.includes('build/forced.js'), 'force-added under an ignored directory');
  assert.ok(files.includes('src/main.ts') && files.includes('.gitignore'));
});

test('the git and rg engines list exactly the same files', { skip: rgSkip }, async (t) => {
  const tree = makeTree(t);
  fs.writeFileSync(path.join(tree.root, 'build/forced.js'), 'x');
  execFileSync('git', ['add', '-f', 'build/forced.js'], { cwd: tree.root });
  fs.writeFileSync(path.join(tree.root, 'untracked.txt'), 'u');
  const app = await startApp(t, { projects: { viaRg: { dir: tree.root }, viaGit: { dir: tree.root, hideTools: ['rg'] } } });
  const list = async (project) => (await app.get(`/api/files?${app.q({ project })}`)).body;
  const [rg, git] = [await list('viaRg'), await list('viaGit')];
  assert.equal(rg.engine, 'rg');
  assert.equal(git.engine, 'git');
  assert.deepEqual([...git.files].sort(), [...rg.files].sort());
});

test('[git] a truncated quick-open list still caps at MAX_QUICKOPEN_FILES when ignored-but-tracked files are filtered out', async (t) => {
  const { listFiles } = await setup(t, 'git', { limits: { MAX_QUICKOPEN_FILES: 3 } });
  const r = await listFiles();
  assert.equal(r.body.files.length, 3);
  assert.equal(r.body.truncated, true);
  assert.ok(!r.body.files.includes('tracked.log'));
});
