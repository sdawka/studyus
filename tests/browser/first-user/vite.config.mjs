import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '../../..');

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: resolve(workspace, 'node_modules/.vite-first-user'),
  plugins: [svelte({ preprocess: vitePreprocess() })],
  server: {
    host: '127.0.0.1',
    port: 4365,
    strictPort: true,
    fs: { allow: [workspace] },
  },
});
