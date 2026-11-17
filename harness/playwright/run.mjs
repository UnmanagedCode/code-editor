// Runs every scenarios/*.mjs (or the ones named on argv; `--repeat=N` runs each N times), each on a fresh seeded world and
// its own browser context. A scenario FAILS on: a CSP violation, a page error, a JS dialog (the XSS canary), a request to
// another origin, or a response >= 400 it did not declare with ctx.allow(). Screenshots go to out/<scenario>-<step>.png.
// Needs `npm run prepare` first (frontend/dist) and CC_PROJECTS_ROOT exported.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { startHost } from './host.mjs';
import { requireBuilt, seed } from './seed.mjs';

const { launchBrowser } = await import(BROWSER);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
requireBuilt();

const args = process.argv.slice(2);
const repeat = Number((args.find((a) => a.startsWith('--repeat=')) ?? '--repeat=1').split('=')[1]);
const wanted = args.filter((a) => !a.startsWith('--'));
const names = fs.readdirSync(path.join(here, 'scenarios')).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')).filter((n) => !wanted.length || wanted.includes(n)).sort();

// cc's host files, which 404 standalone by design.
const HOST_URLS = /\/pluginBridge\.js$|\/pluginTheme\.css$/;

async function runOnce(name) {
  const scenario = (await import(`./scenarios/${name}.mjs`)).default;
  const meta = (await import(`./scenarios/${name}.mjs`)).options ?? {};
  const world = await seed();
  const host = meta.embedded ? await startHost(world.url) : null;
  const browser = await launchBrowser({ headless: true });
  const problems = [];
  const allowed = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...(meta.context ?? {}) });
    await context.addInitScript(() => {
      window.__violations = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const page = await context.newPage();
    const origin = new URL(host?.url ?? world.url).origin;
    page.on('pageerror', (e) => problems.push(`page error: ${e.stack ?? e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (/pluginBridge|pluginTheme/.test(text) && !host) return;
      if (/^Failed to load resource/.test(text)) return; // judged by the response check below
      problems.push(`console error: ${text}`);
    });
    page.on('dialog', async (d) => { problems.push(`JS dialog fired (${d.type()}): ${d.message()}`); await d.dismiss(); });
    page.on('request', (r) => {
      const u = r.url();
      if (/^(data|blob|about):/.test(u)) return;
      if (new URL(u).origin !== origin) problems.push(`request to another origin: ${u}`);
    });
    page.on('response', (r) => {
      if (r.status() < 400) return;
      const u = r.url();
      if (!host && HOST_URLS.test(new URL(u).pathname)) return;
      if (allowed.some((a) => a.status === r.status() && a.match.test(u))) return;
      problems.push(`HTTP ${r.status()} ${u}`);
    });

    let n = 0;
    const ctx = {
      name, world, page, context, url: host?.url ?? world.url, host,
      app: host ? page.frameLocator('#plugin') : page,
      /** Declares an expected >= 400 response. */
      allow: (status, match) => allowed.push({ status, match }),
      shot: async (step) => {
        const file = path.join(outDir, `${name}-${String(++n).padStart(2, '0')}-${step}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`  screenshot: ${path.relative(process.cwd(), file)}`);
      },
      check: (cond, what) => { if (!cond) throw new Error(`${name}: ${what}`); console.log(`  ok: ${what}`); },
    };
    try {
      await scenario(ctx);
    } catch (e) {
      await page.screenshot({ path: path.join(outDir, `${name}-FAILED.png`) }).catch(() => {});
      throw e;
    }
    for (const frame of page.frames()) {
      const violations = await frame.evaluate(() => window.__violations ?? []).catch(() => []);
      for (const v of violations) problems.push(`CSP violation: ${v}`);
    }
    if (problems.length) throw new Error(`${name}: ${problems.length} problem(s):\n    ${problems.join('\n    ')}`);
  } finally {
    await browser.close();
    await host?.close();
    await world.close();
  }
}

let failed = 0;
for (const name of names) {
  for (let i = 1; i <= repeat; i++) {
    console.log(`▶ ${name}${repeat > 1 ? ` (run ${i}/${repeat})` : ''}`);
    try { await runOnce(name); console.log(`✔ ${name}`); } catch (e) { failed++; console.log(`✖ ${name}: ${e.message}`); }
  }
}
console.log(failed ? `\n${failed} scenario run(s) FAILED` : `\nall ${names.length} scenario(s) passed`);
process.exit(failed ? 1 : 0);
