import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  cacheDir: path.join(here, '.vite-cache'),
  resolve: {
    alias: {
      // Only src/editor/monaco.ts imports Monaco; UI tests inject a fake EditorHost, so a stray import must fail loudly.
      'monaco-editor': path.join(here, 'src/test/monacoStub.ts'),
      '@': path.join(here, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 15_000,
  },
});
