// Embedded mode: a stand-in for cc's page that frames the plugin. It serves cc's REAL pluginBridge.js and a /pluginTheme.css
// composed from cc's themeTokens.css, and proxies /plugins/code-editor/* to the backend with Host and Origin forwarded unchanged
// (as cc's proxy does), so relative URLs under a prefix, the Origin↔Host gate through a proxy and live theme sync are exercised.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const checkout = process.env.CC_CHECKOUT || path.join(process.env.CC_PROJECTS_ROOT ?? '', 'code-conductor');
const BRIDGE = path.join(checkout, 'web/src/features/views/pluginBridge.js');
const TOKENS = path.join(checkout, 'web/src/themeTokens.css');

// Like cc, the host remembers the route the plugin reports and reopens the frame there after a reload.
const PAGE = (src, explicit) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>cc host</title>
<link rel="stylesheet" href="/pluginTheme.css"><style>html,body{margin:0;height:100%;background:var(--background)}iframe{border:0;width:100%;height:100%}</style></head>
<body><iframe id="plugin" title="plugin"></iframe>
<script>
  var src = ${JSON.stringify(src)};
  var saved = sessionStorage.getItem('plugin-route');
  document.getElementById('plugin').src = saved && !${explicit} ? '/plugins/code-editor' + saved : src;
  window.addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data && e.data.cc === 1 && e.data.type === 'route') sessionStorage.setItem('plugin-route', e.data.path);
  });
</script></body></html>`;

export async function startHost(backendUrl) {
  for (const f of [BRIDGE, TOKENS]) if (!fs.existsSync(f)) throw new Error(`embedded mode needs ${f} (set CC_CHECKOUT to a code-conductor checkout)`);
  const target = new URL(backendUrl);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/pluginBridge.js') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(BRIDGE)); }
    if (url.pathname === '/pluginTheme.css') { res.setHeader('content-type', 'text/css'); return res.end(`/* cc:tokens */\n${fs.readFileSync(TOKENS, 'utf8')}`); }
    if (url.pathname === '/') {
      const src = url.searchParams.get('plugin') ?? '/plugins/code-editor/';
      res.setHeader('content-type', 'text/html');
      return res.end(PAGE(src, url.searchParams.has('plugin')));
    }
    const prefix = '/plugins/code-editor';
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      const upstream = http.request({
        host: target.hostname, port: target.port, method: req.method, path: (url.pathname.slice(prefix.length) || '/') + url.search,
        headers: { ...req.headers, 'x-forwarded-prefix': prefix }, // Host and Origin exactly as the browser sent them
      }, (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); });
      upstream.on('error', () => { res.statusCode = 502; res.end('bad gateway'); });
      return req.pipe(upstream);
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}
