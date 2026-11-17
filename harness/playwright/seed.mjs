// One deterministic world for the visual harness: temp trees behind the fake cc (which runs the real ops.sh helper through
// argv exec, like cc), and the plugin backend booted against it. Reuses the backend test fixtures. Never touches a real
// cc, a real PROJECTS_ROOT or the live test project.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { HOSTILE_NAME, makePlainTree, makeTree } from '../../tests/_fixtures.js';

const { bootServer } = await import(BROWSER);
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MAIN_TS = `import { readFile } from 'node:fs/promises';

// needle here: the search scenario finds this line
export interface Config {
  name: string;
  retries: number;
}

export async function load(path: string): Promise<Config> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as Config;
}

export const answer = 42;
`;

export async function seed() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const close = async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* best effort */ } } };
  try {
    const app = makeTree(t, { symlinks: true });
    fs.writeFileSync(path.join(app.root, 'src/main.ts'), MAIN_TS);
    fs.writeFileSync(path.join(app.root, 'many.txt'), Array.from({ length: 700 }, (_, i) => `repeat-${i + 1} some filler text`).join('\n') + '\n');
    fs.writeFileSync(path.join(app.root, 'huge.txt'), Array.from({ length: 260_000 }, (_, i) => `line ${i}`).join('\n') + '\n'); // over MAX_EDIT_BYTES
    fs.writeFileSync(path.join(app.root, 'hostile-content.txt'), 'x <img src=x onerror=alert(1)> <script>alert(2)</script>\n');
    const wt = makePlainTree(t, { 'wt-only.txt': 'a file that only exists in the worktree\n', 'src/wt.ts': 'export const wt = true;\n' });
    const box = makeTree(t, {});
    const gone = makePlainTree(t, { 'x.txt': 'x' });

    const fake = await fakeCc({
      projects: {
        app: { dir: app.root, workspace: 'team', worktrees: { wt1: wt.root } },
        box: { dir: box.root, workspace: 'team', system: 'docker', remoteId: 'box' },
        down: { dir: gone.root, system: 'docker', remoteId: 'down-box' },
        gone: { dir: gone.root, system: 'docker', remoteId: 'gone-box', systemUnreachable: 'provider died' },
      },
    });
    cleanups.push(() => fake.close());
    fake.systemDown('down');

    // PROJECTS_ROOT and the plugin data dir are blanked: this backend must never see the real ones.
    const backend = await bootServer({
      cwd: projectRoot, entry: 'server.js', silent: true,
      env: { CONDUCTOR_URL: fake.url, PROJECTS_ROOT: '', CONDUCTOR_PLUGIN_DATA_DIR: '' },
    });
    cleanups.push(() => backend.close());
    return { url: backend.url, backend, fake, trees: { app: app.root, wt: wt.root, box: box.root, outside: app.outside }, hostileName: HOSTILE_NAME, close };
  } catch (e) {
    await close();
    throw e;
  }
}

/** Refuses to run against an unbuilt UI. */
export function requireBuilt() {
  if (!fs.existsSync(path.join(projectRoot, 'frontend', 'dist', 'index.html'))) throw new Error('frontend/dist/index.html is missing: run npm run prepare');
}
