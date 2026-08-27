import { test, expect } from '@playwright/test';
import { runHarness } from './run-harness.mjs';

test.describe.configure({ mode: 'serial' });

test('live documentation annotations resolve', async ({ baseURL }) => {
  test.setTimeout(180_000);
  await runHarness('scripts/annotations-check.cjs', [baseURL]);
});

test('course map editor hydrates and becomes interactive', async ({ page }) => {
  const hydrationErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /astro-island|hydrating|DataCloneError/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => hydrationErrors.push(error.message));

  await page.goto('/courses/chee-314-fluid-mechanics/concepts', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Edit map' }).click();
  await expect(page.getByLabel('Branch name').first()).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test('AI tutor is gated when unavailable, otherwise sessions survive reload', async ({ page }) => {
  const capabilityResponse = await page.request.get('/api/v1/capabilities');
  expect(capabilityResponse.ok()).toBe(true);
  const { data: capabilities } = await capabilityResponse.json();

  await page.goto('/courses/chee-314-fluid-mechanics/play', { waitUntil: 'networkidle' });
  if (!capabilities.ai.features.tutor) {
    const gate = page.locator('[data-ai-feature="tutor"]');
    await expect(gate).toContainText('AI unavailable');
    await expect(page.locator('a.model-link')).toHaveCount(0);

    const kcId = await page.locator('.model-link.disabled').first().getAttribute('data-kc-id');
    expect(kcId).toBeTruthy();
    const blocked = await page.request.post('/api/v1/tutor/conversations', { data: { kc_id: kcId } });
    expect(blocked.status()).toBe(503);
    await expect(blocked.json()).resolves.toMatchObject({ error: { code: 'ai_unavailable' } });
    return;
  }

  const exploration = page.locator('a.model-link').first();
  const startHref = await exploration.getAttribute('href');
  expect(startHref).toMatch(/^\/tutor\/[^?]+$/);

  await page.goto(startHref, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/tutor\/[^?]+\?c=[^&]+$/);
  const conversationUrl = new URL(page.url());
  const conversationId = conversationUrl.searchParams.get('c');
  expect(conversationId).toBeTruthy();

  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByText('Session ended — nice work.')).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Session ended — nice work.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);

  await page.goto('/courses/chee-314-fluid-mechanics/play', { waitUntil: 'networkidle' });
  const historyLink = page.locator(`a[href="${conversationUrl.pathname}?c=${encodeURIComponent(conversationId)}"]`);
  await expect(historyLink).toBeVisible();
  await expect(historyLink.getByText('Completed')).toBeVisible();
});

test('feed loads without missing resources', async ({ page, baseURL }) => {
  const failedResponses = [];
  const appOrigin = new URL(baseURL).origin;
  page.on('response', (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === appOrigin) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const response = await page.goto('/feed', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  expect(failedResponses).toEqual([]);
});

test('application layout invariants hold', async ({ baseURL }) => {
  test.setTimeout(600_000);
  await runHarness('scripts/layout-check.cjs', [baseURL]);
});
