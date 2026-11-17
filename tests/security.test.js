import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CSP } from '../src/http/security.js';
import { startApp } from './_app.js';
import { makePlainTree } from './_fixtures.js';

async function setup(t, opts = {}) {
  const { root } = makePlainTree(t, { 'a.txt': 'x' });
  return startApp(t, { projects: { p: { dir: root } }, ...opts });
}

const hasSecurityHeaders = (r) => {
  assert.equal(r.headers.get('content-security-policy'), CSP);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
};

test('the CSP names exactly the sources the app needs and no remote origin', () => {
  assert.match(CSP, /default-src 'none'/);
  assert.match(CSP, /script-src 'self'(;|$)/);
  assert.match(CSP, /worker-src 'self'/);
  assert.match(CSP, /frame-ancestors 'self'/);
  assert.match(CSP, /connect-src 'self'/);
  assert.doesNotMatch(CSP, /https?:|\*/);
  assert.doesNotMatch(CSP, /script-src[^;]*unsafe/);
});

test('every kind of response carries the CSP: API 200, 404, error, bad JSON, unbuilt 503', async (t) => {
  const app = await setup(t);
  hasSecurityHeaders(await fetch(`${app.base}/api/health`));
  hasSecurityHeaders(await fetch(`${app.base}/api/roots`));
  hasSecurityHeaders(await fetch(`${app.base}/nope`));
  hasSecurityHeaders(await fetch(`${app.base}/api/nope`));
  hasSecurityHeaders(await fetch(`${app.base}/`)); // unbuilt: 503
  hasSecurityHeaders(await fetch(`${app.base}/api/list?path=`)); // 400
  const bad = await fetch(`${app.base}/api/rename`, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.base, 'x-code-editor': '1' }, body: '{bad' });
  assert.equal(bad.status, 400);
  hasSecurityHeaders(bad);
  hasSecurityHeaders(await fetch(`${app.base}/api/rename`, { method: 'POST', body: 'x' })); // 415/403
});

test('a request the HTTP parser rejects still gets the CSP', async (t) => {
  const app = await setup(t);
  const port = new URL(app.base).port;
  const reply = await new Promise((resolve) => {
    const s = net.connect(Number(port), '127.0.0.1', () => s.write('GARBAGE\r\n\r\n'));
    let data = '';
    s.on('data', (d) => { data += d; });
    s.on('close', () => resolve(data));
  });
  assert.match(reply, /^HTTP\/1.1 400/);
  assert.ok(reply.includes(`Content-Security-Policy: ${CSP}`));
});

test('an unbuilt UI answers / with a plain-text 503 and other assets 404; the API stays up', async (t) => {
  const app = await setup(t);
  const root = await app.raw('GET', '/');
  assert.equal(root.status, 503);
  assert.match(root.headers.get('content-type'), /text\/plain/);
  assert.equal((await app.raw('GET', '/assets/x.js')).status, 404);
  assert.equal((await app.get('/api/health')).status, 200);
});

test('state-changing requests need a JSON content type (415) and a matching Origin (403)', async (t) => {
  const app = await setup(t);
  const body = JSON.stringify({ project: 'p', path: 'x', type: 'file' });
  const noType = await app.raw('POST', '/api/entries', { headers: { 'x-code-editor': '1', origin: app.base }, body });
  assert.equal(noType.status, 415);
  assert.equal(noType.body.code, 'UNSUPPORTED_MEDIA_TYPE');
  const form = await app.raw('POST', '/api/entries', { headers: { 'x-code-editor': '1', origin: app.base, 'content-type': 'text/plain' }, body });
  assert.equal(form.status, 415);
  const noOrigin = await app.raw('POST', '/api/entries', { headers: { 'x-code-editor': '1', 'content-type': 'application/json' }, body });
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.body.code, 'REQUEST_REFUSED');
  const foreign = await app.raw('POST', '/api/entries', { headers: { 'x-code-editor': '1', 'content-type': 'application/json', origin: 'https://evil.example' }, body });
  assert.equal(foreign.status, 403);
  const ok = await app.raw('POST', '/api/entries', { headers: { 'x-code-editor': '1', 'content-type': 'application/json; charset=utf-8', origin: app.base }, body });
  assert.equal(ok.status, 201);
});

test('a GET may omit Origin, but one it carries must match Host', async (t) => {
  const app = await setup(t);
  assert.equal((await app.get('/api/roots')).status, 200);
  assert.equal((await app.raw('GET', '/api/roots', { headers: { 'x-code-editor': '1', origin: app.base } })).status, 200);
  const foreign = await app.raw('GET', '/api/roots', { headers: { 'x-code-editor': '1', origin: 'http://evil.example' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'REQUEST_REFUSED');
  assert.equal((await app.raw('GET', '/api/roots', { headers: { 'x-code-editor': '1', origin: 'null' } })).status, 403);
});

test('a proxied request (Host and Origin naming cc’s origin) passes; a Host naming this backend’s own port by a non-loopback name is refused', async (t) => {
  const app = await setup(t);
  const port = new URL(app.base).port;
  // Raw sockets: fetch forbids setting Host.
  const send = (host, origin) => new Promise((resolve) => {
    const s = net.connect(Number(port), '127.0.0.1', () => s.write(`GET /api/roots HTTP/1.1\r\nHost: ${host}\r\nX-Code-Editor: 1\r\n${origin ? `Origin: ${origin}\r\n` : ''}Connection: close\r\n\r\n`));
    let data = '';
    s.on('data', (d) => { data += d; });
    s.on('close', () => resolve(Number(data.split(' ')[1])));
  });
  assert.equal(await send('cc.example:8787', 'http://cc.example:8787'), 200, 'through cc’s proxy');
  assert.equal(await send(`rebind.example:${port}`, ''), 403, 'DNS rebinding onto this port');
  assert.equal(await send(`localhost:${port}`, `http://localhost:${port}`), 200, 'a direct loopback dial');
  assert.equal(await send('cc.example:8787', 'http://other.example:8787'), 403, 'Origin ≠ Host');
});

test('malformed and over-large JSON bodies never echo internals', async (t) => {
  const app = await setup(t, { limits: { SMALL_BODY_LIMIT: 100 } });
  const big = await app.raw('POST', '/api/delete', { headers: { 'x-code-editor': '1', 'content-type': 'application/json', origin: app.base }, body: JSON.stringify({ project: 'p', path: 'a'.repeat(500) }) });
  assert.equal(big.status, 413);
  assert.equal(big.body.code, 'TOO_LARGE');
  const bad = await app.raw('POST', '/api/delete', { headers: { 'x-code-editor': '1', 'content-type': 'application/json', origin: app.base }, body: '{"a":' });
  assert.equal(bad.status, 400);
  assert.doesNotMatch(JSON.stringify(bad.body), /Unexpected|position|JSON\.parse/);
});

test('a malformed helper answer is a refusal that leaks no server paths', async (t) => {
  const app = await setup(t);
  const origError = console.error;
  console.error = () => {};
  t.after(() => { console.error = origError; });
  app.fake.state.execHook = () => ({ status: 200, body: { exitCode: 0, stdout: Buffer.from('garbage').toString('base64'), stderr: '' } });
  const r = await app.get(`/api/file?${app.q({ project: 'p', path: 'a.txt' })}`);
  assert.equal(r.status, 422);
  assert.doesNotMatch(JSON.stringify(r.body), /\/workspaces|node_modules/);
});

test('static: only allowlisted built files are served; maps, dotfiles, .vite, traversal and the host URLs are not', async (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.mkdirSync(path.join(dist, '.vite'));
  const files = {
    'index.html': '<html></html>', 'theme-init.js': '//', '.hidden.js': '//', '.vite/manifest.json': '{}',
    'assets/index-AbC_1.js': '//', 'assets/index-AbC_1.js.map': '{}', 'assets/editor.worker-AbC_1.js': '//',
    'assets/codicon-x.ttf': 'font', 'assets/style.css': 'a{}', 'secret.txt': 'no', 'assets/INDEX.JS.MAP': '{}',
  };
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dist, f), c);
  const app = await setup(t, { distDir: dist });
  for (const ok of ['/', '/index.html', '/theme-init.js', '/assets/index-AbC_1.js', '/assets/editor.worker-AbC_1.js', '/assets/codicon-x.ttf', '/assets/style.css']) {
    assert.equal((await fetch(app.base + ok)).status, 200, ok);
    hasSecurityHeaders(await fetch(app.base + ok));
  }
  for (const no of ['/assets/index-AbC_1.js.map', '/assets/index-AbC_1%2Ejs%2Emap', '/assets/INDEX.JS.MAP', '/.hidden.js', '/.vite/manifest.json', '/secret.txt',
    '/pluginBridge.js', '/pluginTheme.css', '/%2e%2e/etc/passwd', '/assets/%2e%2e/secret.txt', '/assets/', '/missing.js']) {
    assert.equal((await fetch(app.base + no)).status, 404, no);
  }
});

test('static: a symlink inside dist that leads out of it is not served', async (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-dist-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-out-'));
  t.after(() => { fs.rmSync(dist, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(outside, 'x.js'), 'secret');
  fs.symlinkSync(path.join(outside, 'x.js'), path.join(dist, 'leak.js'));
  const app = await setup(t, { distDir: dist });
  assert.equal((await fetch(`${app.base}/leak.js`)).status, 404);
});

test('every /api request except health must carry the X-Code-Editor header (a cross-site <img> GET cannot), else 403 REQUEST_REFUSED', async (t) => {
  const app = await setup(t);
  assert.equal((await fetch(`${app.base}/api/health`)).status, 200, 'health is exempt');
  for (const url of ['/api/roots', `/api/file?${app.q({ project: 'p', path: 'a.txt' })}`, `/api/list?${app.q({ project: 'p', path: '' })}`]) {
    const bare = await fetch(app.base + url);
    assert.equal(bare.status, 403, url);
    assert.equal((await bare.json()).code, 'REQUEST_REFUSED');
    assert.equal((await fetch(app.base + url, { headers: { 'x-code-editor': '1' } })).status, 200, url);
  }
  const wrong = await fetch(`${app.base}/api/roots`, { headers: { 'x-code-editor': '0' } });
  assert.equal(wrong.status, 403, 'only the exact value passes');
});

test('the custom header is required on state-changing requests too, even with a matching Origin and JSON type', async (t) => {
  const app = await setup(t);
  const body = JSON.stringify({ project: 'p', path: 'x', type: 'file' });
  const r = await fetch(`${app.base}/api/entries`, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.base }, body });
  assert.equal(r.status, 403);
  const ok = await fetch(`${app.base}/api/entries`, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.base, 'x-code-editor': '1' }, body });
  assert.equal(ok.status, 201);
});
