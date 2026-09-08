import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import clerk from '@clerk/astro';
import { loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// TEMPORARY — docs annotation overlay (docs/product/annotations.md). The
// integration itself decides whether to inject anything; it no-ops for
// `astro build`, so a production build never pulls the overlay into the
// module graph. Remove this import and the array entry to retire the layer.
import { docsOverlayIntegration } from './src/lib/docs-overlay/integration.mjs';

const buildEnv=loadEnv(process.env.CLOUDFLARE_ENV==='staging'?'e2e':'production',process.cwd(),'PUBLIC_');
// Astro does not collect is:inline scripts. Authorize only this fixed,
// repository-owned pre-paint theme initializer, never response-supplied code.
const themeInitializer = readFileSync(new URL('./src/components/shell/ThemeScript.astro', import.meta.url), 'utf8').match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
if (!themeInitializer) throw new Error('Theme initializer missing; review its CSP hash input.');
const themeHash = `sha256-${createHash('sha256').update(themeInitializer).digest('base64')}`;
let clerkOrigin='https://clerk.studyus.app';
try {
  const key=process.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? buildEnv.PUBLIC_CLERK_PUBLISHABLE_KEY;
  const hostname=Buffer.from(key?.replace(/^pk_(test|live)_/,'')??'','base64').toString().replace(/\$$/,'');
  if (/^[a-z0-9.-]+$/i.test(hostname) && hostname.includes('.')) clerkOrigin=`https://${hostname}`;
} catch { /* The auth integration supplies its normal missing-key error. */ }

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
  pathname === '/how-it-works' ||
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
  security: {
    csp: {
      // Clerk and Astro both load parser-inserted modules. strict-dynamic
      // ignores their host allowlist unless a nonce/hash trust chain exists.
      scriptDirective: { resources: ["'self'", clerkOrigin], hashes: [themeHash] },
      // Svelte style directives and Clerk's UI require inline styles.
      styleDirective: {resources:["'self'",{resource:"'unsafe-inline'",kind:'attribute'}]},
      directives: [
        "default-src 'self'",
        "frame-ancestors 'none'",
        `connect-src 'self' ${clerkOrigin} https://*.protect.clerk.com https://clerk-telemetry.com https://us.i.posthog.com https://eu.i.posthog.com`,
        "img-src 'self' data: blob: https://img.clerk.com",
        "font-src 'self' data:",
        `frame-src ${clerkOrigin} https://challenges.cloudflare.com https://*.protect.clerk.com`,
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
      ],
    },
  },
});
