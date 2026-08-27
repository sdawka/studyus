import { defineConfig } from '@playwright/test';
import { loadClerkE2EEnv, CLERK_AUTH_STATE_PATH } from './scripts/lib/clerk-e2e-auth.mjs';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4321';
loadClerkE2EEnv();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  reporter: 'line',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.mjs/,
    },
    {
      name: 'authenticated',
      testMatch: /browser-checks\.spec\.mjs/,
      dependencies: ['setup'],
      use: { storageState: CLERK_AUTH_STATE_PATH },
    },
    {
      name: 'visual',
      testMatch: /visual-qa\.spec\.mjs/,
      dependencies: ['setup'],
      // The visual harness already writes a screenshot for every state. A
      // Playwright trace duplicates every page snapshot and can consume
      // hundreds of MB before `retain-on-failure` decides whether to keep it,
      // which is disproportionate for this deliberately broad matrix.
      use: { storageState: CLERK_AUTH_STATE_PATH, trace: 'off' },
    },
  ],
  webServer: {
    // Astro 7 auto-detects agent environments and otherwise detaches `astro
    // dev` into the background. Playwright must own a foreground process so
    // it can observe startup failures and reliably stop the server afterward.
    command: 'npm run dev -- --mode e2e --ignore-lock --host 127.0.0.1 --port 4321',
    env: { ...process.env, ASTRO_DEV_BACKGROUND: '0' },
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
