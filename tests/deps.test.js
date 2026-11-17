import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = path.join(root, 'node_modules/.package-lock.json');

test('no installed package runs an install script', { skip: !fs.existsSync(lock) && 'node_modules is not installed' }, () => {
  const packages = JSON.parse(fs.readFileSync(lock, 'utf8')).packages;
  const withScripts = Object.entries(packages).filter(([, p]) => p.hasInstallScript).map(([n]) => n);
  assert.deepEqual(withScripts, []);
});

test('monaco is bundled directly: no loader, react wrapper or bundled ripgrep', () => {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const banned of ['@monaco-editor/loader', '@monaco-editor/react', '@vscode/ripgrep']) assert.ok(!(banned in all), banned);
  assert.ok('monaco-editor' in all);
});

test('the backend’s runtime dependencies are express only; the UI is build-time only', () => {
  assert.deepEqual(Object.keys(pkg.dependencies), ['express']);
});
