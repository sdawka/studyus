import { defineConfig } from '@playwright/test';

// This project never starts a server or loads Clerk authentication state. Start
// a local target separately with:
//   npm run dev -- --host 127.0.0.1 --port 4357
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4357';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /public-audit\.spec\.mjs/,
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL,
    // The demo-events endpoint returns accepted: 0 for this header, preventing
    // automated public-page visits from creating analytics rows.
    extraHTTPHeaders: { DNT: '1' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
