import { expect, test } from './authenticated-fixture.mjs';

const auditTitle = `Authenticated audit note ${Date.now()}`;

test('note draft survives a network failure and persists after retry', async ({ page, context, baseURL }) => {
  const hostname = new URL(baseURL).hostname;
  const isolatedAuditEnabled = process.env.STUDYUS_ISOLATED_AUDIT === '1';
  test.skip(
    !isolatedAuditEnabled || !['127.0.0.1', 'localhost'].includes(hostname),
    'Set STUDYUS_ISOLATED_AUDIT=1 and use localhost with a disposable database.',
  );

  await page.goto('/notes', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
  const create = await context.request.post('/api/v1/notes', {
    data: { title: 'Offline recovery fixture', content: '' },
  });
  expect(create.status()).toBe(201);
  const note = (await create.json()).data;

  try {
    await page.goto(`/notes/${note.id}`);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    const title = page.locator('input.title-input');
    const content = page.locator('textarea.markdown-input');
    const save = page.getByRole('button', { name: 'Save', exact: true });

    await title.fill(auditTitle);
    await page.locator('h1').first().click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await content.fill('# Offline draft\nThis text must survive a failed save.');
    await page.route('**/api/v1/notes/**', (route) => route.abort('internetdisconnected'));
    await page.locator('h1').first().click();

    await expect(page.locator('.error-message')).toBeVisible();
    await expect(title).toHaveValue(auditTitle);
    await expect(content).toHaveValue(/This text must survive a failed save/);

    await page.unroute('**/api/v1/notes/**');
    await save.click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.reload();
    await expect(title).toHaveValue(auditTitle);
    await expect(content).toHaveValue('# Offline draft\nThis text must survive a failed save.');
  } finally {
    await page.unroute('**/api/v1/notes/**').catch(() => {});
    const cleanup = await context.request.delete(`/api/v1/notes/${note.id}`, {
      headers: { 'Content-Type': 'application/json', Origin: new URL(baseURL).origin },
    }).catch(() => null);
    expect(cleanup?.status(), cleanup ? await cleanup.text() : 'cleanup request failed').toBe(200);
  }
});
