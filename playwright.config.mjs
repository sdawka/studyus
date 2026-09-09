import { defineConfig } from '@playwright/test';
import { loadClerkE2EEnv } from './scripts/lib/clerk-e2e-auth.mjs';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4321';
const baseHostname = new URL(baseURL).hostname;
const shouldStartLocalServer = baseHostname === '127.0.0.1' || baseHostname === 'localhost';
loadClerkE2EEnv();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // These projects share one reserved development learner and mutate its
  // preferences and fixtures. Serialize files as well as tests within a file.
  workers: 1,
  reporter: 'line',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    {
      // Explicit isolated run: consumes a real one-use Agent Task and verifies
      // its delegated session against the protected Worker application.
      name: 'agent-tasks',
      testMatch: /agent-remediation\.spec\.mjs/,
    },
    {
      name: 'clerk-ui',
      testMatch: /clerk-ui\.spec\.mjs/,
    },
    {
      name: 'setup',
      testMatch: /auth\.setup\.mjs/,
    },
    {
      name: 'authenticated',
      testMatch: /(?:^|\/)(?:browser-checks|authenticated-audit|remediation|planning-remediation|accessibility-remediation|planner-overflow)\.spec\.mjs$/,
      dependencies: ['setup'],
    },
    {
      name: 'security-boundaries',
      testMatch: /public-audit\.spec\.mjs/,
      grep: /local HTTP security boundaries/,
    },
    {
      name: 'visual',
      testMatch: /visual-qa\.spec\.mjs/,
      dependencies: ['setup'],
      // The visual harness already writes a screenshot for every state. A
      // Playwright trace duplicates every page snapshot and can consume
      // hundreds of MB before `retain-on-failure` decides whether to keep it,
      // which is disproportionate for this deliberately broad matrix.
      use: { trace: 'off' },
    },
  ],
  webServer: shouldStartLocalServer ? {
    // Astro 7 auto-detects agent environments and otherwise detaches `astro
    // dev` into the background. Playwright must own a foreground process so
    // it can observe startup failures and reliably stop the server afterward.
    command: process.env.E2E_BUILT_APP === '1'
      ? `npm run preview -- --host 127.0.0.1 --port ${new URL(baseURL).port || '4321'}`
      : `npm run dev -- --mode e2e --ignore-lock --host 127.0.0.1 --port ${new URL(baseURL).port || '4321'}`,
    env: { ...process.env, ASTRO_DEV_BACKGROUND: '0', ASTRO_PREVIEW_BACKGROUND: '0' },
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  } : undefined,
});
