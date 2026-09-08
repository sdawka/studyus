import { test as base, expect } from '@playwright/test';
import { authenticateClerkContext, setupClerkTestingContext, setupClerkTestingWorker } from '../../scripts/lib/clerk-e2e-auth.mjs';

// Cloning an expired development session can enter Clerk's handshake loop.
// Sign in each isolated test context with the supported development helper;
// this deliberately does not claim coverage of ordinary session refresh.
export const test = base.extend({
  clerkTestingWorker: [async ({}, use) => {
    await setupClerkTestingWorker();
    await use();
  }, { scope: 'worker', auto: true }],
  clerkTestingContext: [async ({ context, page, baseURL, clerkTestingWorker: _ready }, use) => {
    await setupClerkTestingContext(context);
    await context.clearCookies();
    await authenticateClerkContext({ context, page, baseUrl: baseURL });
    await use();
  }, { auto: true }],
});

export { expect };
