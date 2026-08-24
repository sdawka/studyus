import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import clerk from '@clerk/astro';
// TEMPORARY — docs annotation overlay (docs/product/annotations.md). The
// integration itself decides whether to inject anything; it no-ops for
// `astro build`, so a production build never pulls the overlay into the
// module graph. Remove this import and the array entry to retire the layer.
import { docsOverlayIntegration } from './src/lib/docs-overlay/integration.mjs';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [clerk(), svelte(), docsOverlayIntegration()],
  session: false,
});
