import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));
// `npm run dev` proxies the API to the backend running standalone (`npm start`).
const backend = process.env.PLUGIN_BACKEND || 'http://127.0.0.1:7710';

export default defineConfig({
  root: here,
  base: './',
  cacheDir: path.join(here, '.vite-cache'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(here, 'src') } },
  // Monaco's workers are ES modules bundled as same-origin assets (CSP worker-src 'self').
  worker: { format: 'es' },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    // No data: fonts: the codicon font is a real file under assets/.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 6000,
  },
  server: { proxy: { '/api': { target: backend, ws: true } } },
});
