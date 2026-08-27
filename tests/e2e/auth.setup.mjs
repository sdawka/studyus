import { test as setup, expect } from '@playwright/test';
import { authenticateClerkContext } from '../../scripts/lib/clerk-e2e-auth.mjs';

setup('create authenticated Clerk state for the seeded learner', async ({ baseURL, context, page }) => {
  await authenticateClerkContext({ context, page, baseUrl: baseURL });

  const response = await page.goto('/dashboard', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/dashboard$/);
});
