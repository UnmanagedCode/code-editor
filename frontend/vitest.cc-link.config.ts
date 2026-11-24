// `npm run test:cc-link`: pins the deep-link table (src/test/ccLinkFixtures.ts) against cc's real link parser, imported
// from the code-conductor checkout named by CC_CHECKOUT. Kept out of `npm test` and `tsc -p frontend`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = process.env.CC_CHECKOUT;
if (!checkout) throw new Error('test:cc-link needs CC_CHECKOUT: the path of a code-conductor checkout (its web/src/state/route.ts is the parser pinned)');

export default defineConfig({
  root: here,
  cacheDir: path.join(here, '.vite-cache'),
  resolve: {
    alias: {
      'cc-route': path.join(checkout, 'web/src/state/route.ts'),
      // cc's own aliases, so its route.ts resolves as in its build.
      '@shared': path.join(checkout, 'shared'),
      '@': path.join(checkout, 'web/src'),
    },
  },
  test: {
    environment: 'happy-dom',
    environmentOptions: { happyDOM: { url: 'http://127.0.0.1:8787/' } },
    include: ['src/**/*.cc.test.ts'],
  },
});
