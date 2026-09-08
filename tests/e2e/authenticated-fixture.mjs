import { test as base, expect } from '@playwright/test';
import { setupClerkTestingContext, setupClerkTestingWorker } from '../../scripts/lib/clerk-e2e-auth.mjs';

// A saved Clerk storage state contains a short-lived session token. Every new
// Playwright context must also install Clerk's supported testing-token route so
// the frontend API can refresh that session during longer serial suites.
export const test = base.extend({
  clerkTestingWorker: [async ({}, use) => {
    await setupClerkTestingWorker();
    await use();
  }, { scope: 'worker', auto: true }],
  clerkTestingContext: [async ({ context, clerkTestingWorker: _ready }, use) => {
    await setupClerkTestingContext(context);
    await use();
  }, { auto: true }],
});

export { expect };
