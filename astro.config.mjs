import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import clerk from '@clerk/astro';
// TEMPORARY — docs annotation overlay (docs/product/annotations.md). The
// integration itself decides whether to inject anything; it no-ops for
// `astro build`, so a production build never pulls the overlay into the
// module graph. Remove this import and the array entry to retire the layer.
import { docsOverlayIntegration } from './src/lib/docs-overlay/integration.mjs';

// Clerk's Astro integration normally injects its browser bootstrap into every
// page, including routes which intentionally bypass Clerk in middleware. Keep
// the official integration's server config and component support, but defer its
// client import entirely on the auth-independent marketing and trial routes.
function routeAwareClerk() {
  const integration = clerk();
  const setup = integration.hooks?.['astro:config:setup'];

  if (!setup) throw new Error('The Clerk Astro integration is missing its setup hook.');

  return {
    ...integration,
    name: 'studyus:route-aware-clerk',
    hooks: {
      ...integration.hooks,
      'astro:config:setup': async (options) => {
        const injectRouteAwareScript = (stage) => {
          options.injectScript(
            stage,
            `
const pathname = window.location.pathname;
const isAuthIndependent =
  pathname === '/' ||
  pathname === '/compare' ||
  pathname === '/try' ||
  pathname.startsWith('/try/');

if (!isAuthIndependent) {
  const { runInjectionScript } = await import('@clerk/astro/internal');
  await runInjectionScript();
}
`,
          );
        };

        await setup({ ...options, injectScript: injectRouteAwareScript });
      },
    },
  };
}

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [routeAwareClerk(), svelte(), docsOverlayIntegration()],
  session: false,
});
