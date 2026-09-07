import { expect, test } from '@playwright/test';

async function waitForTrialHydration(page) {
  await page.locator('astro-island[ssr]').waitFor({ state: 'detached' });
}

async function expectDntDemoEventsToBeDiscarded(page) {
  const response = await page.request.post('/api/public/demo-events', {
    headers: { DNT: '1' },
    data: {
      events: [{
        session_id: '00000000-0000-4000-8000-000000000001',
        event_id: '00000000-0000-4000-8000-000000000002',
        name: 'demo_entered',
        occurred_at: 1,
      }],
    },
  });
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ data: { accepted: 0 } });
}

test('public trial turns a sample decision into a session outline and signup handoff', async ({ page }) => {
  await page.goto('/try', { waitUntil: 'domcontentloaded' });
  await waitForTrialHydration(page);
  await expect(page.getByRole('button', { name: 'Show my next move' })).toBeVisible();
  await expectDntDemoEventsToBeDiscarded(page);

  await page.getByRole('button', { name: 'Show my next move' }).click();
  await expect(page).toHaveURL(/\/try\/app\/today$/);

  await page.getByRole('button', { name: /Open this 25 min session/ }).click();
  await expect(page.getByText('Here’s the session')).toBeVisible();

  const signup = page.getByRole('link', { name: /Use this with my courses/ });
  await expect(signup).toHaveAttribute('href', '/sign-up?from=demo');
});

test('public trial has no horizontal page overflow at a 390px viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/try', { waitUntil: 'domcontentloaded' });
  await waitForTrialHydration(page);
  await expect(page.getByRole('button', { name: 'Show my next move' })).toBeVisible();

  await page.getByRole('button', { name: 'Show my next move' }).click();
  const openSession = page.getByRole('button', { name: /Open this 25 min session/ });
  await expect(openSession).toBeVisible();
  await openSession.click();
  await expect(page.getByText('Here’s the session')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('public-trial-mobile-session.png'), fullPage: true });

  const ctas = [
    page.getByRole('link', { name: 'Create free account' }),
    page.getByRole('link', { name: /Use this with my courses/ }),
  ];
  for (const cta of ctas) {
    const box = await cta.boundingBox();
    if (!box) throw new Error('Expected a visible mobile CTA.');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});
