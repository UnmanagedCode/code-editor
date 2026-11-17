import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from '../server.js';
import { fakeCc } from './_fakeCc.js';

/**
 * Boots a fake cc and the backend on free loopback ports, both closed after the test.
 * `projects` is the fake's project table. `get/put/post(path, body)` send a JSON content type and a matching Origin;
 * every resolves {status, headers, body}. `raw(method, path, {headers, body})` sends exactly what it is given.
 */
export async function startApp(t, { projects = {}, limits, distDir } = {}) {
  const fake = await fakeCc({ projects });
  const dist = distDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ce-dist-'));
  const server = await start({ port: 0, distDir: dist, limits });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fake.close();
    if (!distDir) fs.rmSync(dist, { recursive: true, force: true });
  });
  const raw = async (method, p, { headers, body } = {}) => {
    const res = await fetch(base + p, { method, headers, body });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, body: parsed };
  };
  const json = (method) => (p, body) => raw(method, p, {
    headers: { 'content-type': 'application/json', origin: base, 'x-code-editor': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const get = (p) => raw('GET', p, { headers: { 'x-code-editor': '1' } });
  const q = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return { base, fake, server, distDir: dist, raw, get, put: json('PUT'), post: json('POST'), q };
}
