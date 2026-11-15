import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4365';

// Component-only UI harness: it deliberately has no Clerk environment,
// browser auth state, or application-side bypass route. API responses are
// intercepted per test at the Playwright boundary.
export default defineConfig({
  testDir: './tests/browser/first-user',
  testMatch: /first-user\.spec\.mjs/,
  fullyParallel: false,
  reporter: 'line',
  workers: 1,
  use: { baseURL, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npx vite --config tests/browser/first-user/vite.config.mjs --host 127.0.0.1 --port 4365',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
