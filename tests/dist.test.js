import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ASSET_RE } from '../src/http/static.js';

const dist = path.join(import.meta.dirname, '..', 'frontend/dist');
const built = fs.existsSync(path.join(dist, 'index.html'));
const skip = !built && 'frontend/dist is not built (npm run prepare)';
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('index.html: only the two host URLs climb to the host root (never root-absolute), the bridge, theme and module come in that order, nothing inline', { skip }, () => {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(urls.filter((u) => u.startsWith('../') || u.startsWith('/')).sort(), ['../../pluginBridge.js', '../../pluginTheme.css']);
  assert.ok(urls.filter((u) => !u.startsWith('../')).every((u) => u.startsWith('./') || u === 'theme-init.js' || !u.includes(':')), urls.join(' '));
  const at = (needle) => html.indexOf(needle);
  const order = [at('src="../../pluginBridge.js"'), at('href="../../pluginTheme.css"'), at('type="module"')];
  assert.ok(order.every((i) => i >= 0), `all three present: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the bridge, then the theme, then the module entry');
  assert.equal(at('<script'), at('src="../../pluginBridge.js"') - '<script '.length, 'the bridge is the first script in the document');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
  assert.doesNotMatch(html, /<style/, 'no inline style element');
  assert.doesNotMatch(html, /\sstyle=/, 'no style attribute');
});

test('every built asset is servable by the allowlist; the Monaco worker and codicon font are present; no source maps', { skip }, () => {
  const assets = walk(dist).map((f) => `/${path.relative(dist, f).split(path.sep).join('/')}`);
  assert.ok(assets.some((a) => /^\/assets\/editor\.worker-[^/]+\.js$/.test(a)), 'editor worker');
  assert.ok(assets.some((a) => /^\/assets\/codicon-[^/]+\.ttf$/.test(a)), 'codicon font');
  assert.deepEqual(assets.filter((a) => !ASSET_RE.test(a)), []);
  assert.deepEqual(assets.filter((a) => a.endsWith('.map')), []);
});

test('built CSS has no absolute URL, built JS no CDN reference', { skip }, () => {
  for (const f of walk(path.join(dist, 'assets'))) {
    const text = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.css')) assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ''), /https?:\/\/|url\(\/\//, path.basename(f));
    if (f.endsWith('.js')) assert.doesNotMatch(text, /cdn\.jsdelivr|unpkg\.com/, path.basename(f));
  }
});
