import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.join(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'conductor.plugin.json'), 'utf8'));

test('the product name is "Code Editor" in the manifest name, nav label and page title', () => {
  assert.equal(manifest.name, 'Code Editor');
  assert.equal(manifest.frontend.navLabel, 'Code Editor');
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)?.[1], 'Code Editor');
});

test('identity and backend contract: id, pluginApi, start command and the health path the server serves', () => {
  assert.equal(manifest.id, 'code-editor');
  assert.equal(manifest.pluginApi, 1);
  assert.equal(manifest.backend.healthPath, '/api/health');
  assert.equal(manifest.backend.start, 'node server.js');
});

test('frontend keys stay within cc’s allowed set, and the page is kept alive so unsaved buffers survive leaving the view', () => {
  const allowed = new Set(['path', 'navLabel', 'keepAlive', 'icon']);
  assert.deepEqual(Object.keys(manifest.frontend).filter((k) => !allowed.has(k)), []);
  assert.equal(manifest.frontend.keepAlive, true);
  assert.ok(manifest.frontend.path.startsWith('/'));
});

test('menu items: a project and a worktree entry with trimmed labels and a path under the plugin', () => {
  const scopes = manifest.menuItems.map((m) => m.scope).sort();
  assert.deepEqual(scopes, ['project', 'worktree']);
  for (const m of manifest.menuItems) {
    assert.equal(m.label, m.label.trim());
    assert.ok(m.label.length > 0);
    assert.ok(m.path.startsWith('/') && !m.path.startsWith('//'));
  }
});
