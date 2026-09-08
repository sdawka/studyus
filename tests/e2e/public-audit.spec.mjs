import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

test('built public response preserves native script hashes and framing protection',async({request})=>{
  const response=await request.get('/try');
  expect(response.status()).toBe(200);
  const policy=response.headers()['content-security-policy'];
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("'sha256-");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
});

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
  // Warm the independent API check before page hydration: a cold Vite module
  // optimization can otherwise reload the page between readiness and click.
  await expectDntDemoEventsToBeDiscarded(page);
  await page.goto('/try', { waitUntil: 'domcontentloaded' });
  await waitForTrialHydration(page);
  await expect(page.getByRole('button', { name: 'Show my next move' })).toBeVisible();

  await page.getByRole('button', { name: 'Show my next move' }).click();
  await expect(page).toHaveURL(/\/try\/app\/today$/);

  await page.getByRole('button', { name: 'Open this 25 minute session', exact: true }).click();
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
  const openSession = page.getByRole('button', { name: 'Open this 25 minute session', exact: true });
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

// Security boundary checks are explicitly restricted to local audit servers.
// Direct Workers handler tests bypass Astro and cannot establish these results.
test.describe('local HTTP security boundaries', () => {
  test.beforeEach(async ({ baseURL }) => {
    test.skip(!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'Isolated local target required');
  });

  test('rejects unauthenticated reads and writes without echoing caller input', async ({ request }) => {
    for (const method of ['GET', 'POST']) {
      const response = await request.fetch('/api/v1/notes?user_id=synthetic-other-learner', {
        method,
        ...(method === 'POST' ? { data: { title: 'synthetic-secret-marker' } } : {}),
      });
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: { code: 'unauthorized', message: 'Authentication required' } });
    }
  });

  test('requires authentication for every declared v1 API method', async ({ request }) => {
    test.setTimeout(90_000);
    // Resolve the route inventory relative to this test, independent of cwd.
    const apiRoot = new URL('../../src/pages/api/v1/', import.meta.url);
    const declarations = readdirSync(apiRoot, { recursive: true }).filter((file) => file.endsWith('.ts'));
    let checked = 0;
    for (const file of declarations) {
      const source = readFileSync(new URL(file, apiRoot), 'utf8');
      const methods = [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE):/g)].map((match) => match[1]);
      expect(methods.length, file).toBeGreaterThan(0);
      const route = '/api/v1/' + file.replace(/\.ts$/, '').replace(/(?:^|\/)index$/, '').replace(/\[.*?\]/g, '00000000-0000-4000-8000-000000000099');
      for (const method of methods) {
        const response = await request.fetch(route, { method, ...(method !== 'GET' ? { data: {} } : {}) });
        expect(response.status(), `${method} ${route}`).toBe(401);
        expect(await response.json()).toEqual({ error: { code: 'unauthorized', message: 'Authentication required' } });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  test('rejects cross-origin form content before public ingestion', async ({ request, baseURL }) => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=audit']) {
      const response = await request.post('/api/public/demo-events', {
        headers: { Origin: 'https://attacker.invalid', 'Content-Type': contentType }, data: '{}',
      });
      expect(response.status()).toBe(403);
      expect(await response.text()).toBe('Cross-site POST form submissions are forbidden');
    }
    // A same-origin request reaches schema validation, proving the denial
    // above is the origin boundary rather than merely a malformed payload.
    const response = await request.post('/api/public/demo-events', {
      headers: { Origin: new URL(baseURL).origin, DNT: '0' }, data: {},
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_input' } });
  });
});
