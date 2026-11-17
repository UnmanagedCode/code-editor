import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// File I/O on project paths goes through cc's exec only (local and remote alike): the backend never touches a project
// path with node:fs, and never spawns a process itself.

const SRC = path.join(import.meta.dirname, '..', 'src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sources = walk(SRC).filter((f) => f.endsWith('.js'));
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');
const importsFs = (text) => /from\s+['"](?:node:)?fs(?:\/promises)?['"]|require\(\s*['"](?:node:)?fs/.test(text);

test('only the static server and the helper loader import node:fs', () => {
  const importers = sources.filter((f) => importsFs(fs.readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(importers, ['fs/script.js', 'http/static.js']);
});

test('the helper loader reads exactly one file, relative to its own module URL', () => {
  const text = fs.readFileSync(path.join(SRC, 'fs/script.js'), 'utf8');
  const reads = text.match(/fs\.\w+\(/g) ?? [];
  assert.deepEqual(reads, ['fs.readFileSync(']);
  assert.match(text, /readFileSync\(new URL\('\.\/ops\.sh', import\.meta\.url\)/);
});

test('no module spawns processes', () => {
  for (const f of sources) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /child_process/, rel(f));
});
