import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup/apply-migrations.ts'],
    // Playwright owns browser E2E specs. Loading them in the Workers pool
    // attempts to bundle Playwright's Node runtime into Miniflare.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
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
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      };
    }),
  ],
});
