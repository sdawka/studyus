import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Two projects, because the two kinds of test need incompatible runtimes.
//
// `workers` runs service/API tests inside Miniflare, which is the whole point —
// they exercise real D1 and the real Worker runtime, and there is no DOM there.
// `dom` runs Svelte component tests under happy-dom, which cannot run in the
// Workers pool. Component tests live under tests/components/ and the workers
// project excludes that directory so the two never collide.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'workers',
          setupFiles: ['./tests/setup/apply-migrations.ts'],
          include: ['tests/**/*.test.ts'],
          // Playwright owns browser E2E specs. Loading them in the Workers pool
          // attempts to bundle Playwright's Node runtime into Miniflare.
          exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/components/**'],
        },
        plugins: [
          cloudflareTest(async () => {
            const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
            return {
              // Astro's production entrypoint depends on a virtual build module.
              // Tests call services directly, while this entry keeps the configured
              // LearnerAgent export available to Miniflare's DO bindings.
              main: './tests/worker.ts',
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  // Deliberately fake: runtime tests exercise the gate without
                  // depending on or exposing a real provider credential.
                  OPENROUTER_API_KEY: 'test-openrouter-key',
                },
              },
            };
          }),
        ],
      },
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['tests/components/**/*.test.ts'],
        },
        // Components are authored with <script lang="ts">, so the compiler needs
        // the TS preprocessor Astro's integration normally supplies.
        plugins: [svelte({ preprocess: vitePreprocess() })],
        // Resolve Svelte's browser build; the default (server) condition renders
        // components to strings instead of mounting them to the happy-dom DOM.
        resolve: { conditions: ['browser'] },
      },
    ],
  },
});
