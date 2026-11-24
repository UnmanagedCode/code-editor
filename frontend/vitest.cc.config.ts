// `CC_CHECKOUT=<code-conductor checkout> npm run test:cc`: runs the gated `*.cc.test.ts` files against cc's real code from
// that checkout (its link parser, skill-part splitter and manifest validator). Kept out of `npm test` and `tsc -p frontend`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = process.env.CC_CHECKOUT;
if (!checkout) throw new Error('test:cc needs CC_CHECKOUT: the path of a code-conductor checkout whose code the gated tests run');

export default defineConfig({
  root: here,
  cacheDir: path.join(here, '.vite-cache'),
  resolve: {
    alias: {
      'cc-route': path.join(checkout, 'web/src/state/route.ts'),
      'cc-skill-part': path.join(checkout, 'shared/skillPart.ts'),
      'cc-manifest': path.join(checkout, 'src/plugins/manifest.ts'),
      // cc's own aliases, so its web modules resolve as in its build.
      '@shared': path.join(checkout, 'shared'),
      '@': path.join(checkout, 'web/src'),
    },
  },
  test: {
    dir: path.join(here, '..'),
    environment: 'happy-dom',
    environmentOptions: { happyDOM: { url: 'http://127.0.0.1:8787/' } },
    include: ['frontend/src/**/*.cc.test.ts', 'tests/**/*.cc.test.ts'],
  },
});
