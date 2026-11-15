import { defineConfig } from '@playwright/test';

// Read-only checks of the public auth entry pages; no sessions or test users.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /legacy-auth-redirect\.spec\.mjs/,
  reporter: 'line',
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4362',
    extraHTTPHeaders: { DNT: '1' },
  },
});
