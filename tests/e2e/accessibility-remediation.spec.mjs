import { expect, test } from './authenticated-fixture.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DAY_MS = 24 * 60 * 60 * 1000;

async function waitForClientHydration(page) {
  // This selector is intentionally plural: planner pages can have several
  // client islands (including the route controls and planner view).
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
}

async function readSeededCalendarItem(page) {
  // Visit an authenticated app route first so Clerk can refresh the short
  // lived session cookie before the API request below.
  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  await waitForClientHydration(page);
  const from = new Date(Date.now() - 45 * DAY_MS).toISOString();
  const to = new Date(Date.now() + 90 * DAY_MS).toISOString();
  const response = await page.request.get(`/api/v1/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const seededTypes = new Set(['assessment_due', 'task_due', 'study_session', 'class_session', 'event_logged']);
  const item = body.data?.find((candidate) => candidate
    && seededTypes.has(candidate.type)
    && typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.date === 'string'
    && !Number.isNaN(Date.parse(candidate.date)));
  expect(item, 'the authenticated seeded learner should have a calendar item in the audit window').toBeTruthy();
  return item;
}

function itemDateKey(item) {
  return typeof item.details?.date_only === 'string' ? item.details.date_only : item.date.slice(0, 10);
}

function eventTrigger(page, item) {
  return page.locator(`[data-event-id="${item.id}"]`).first();
}

async function openSeededPlannerEvent(page, item) {
  await page.goto(`/planner?event=${encodeURIComponent(item.id)}&date=${encodeURIComponent(itemDateKey(item))}`, { waitUntil: 'domcontentloaded' });
  await waitForClientHydration(page);
  const trigger = eventTrigger(page, item);
  await expect(trigger).toBeVisible();
  const dialog = page.getByRole('dialog', { name: item.title, exact: true });
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}

test.describe('authenticated accessibility remediation journey', () => {
  test.skip(process.env.STUDYUS_ISOLATED_AUDIT !== '1', 'Set STUDYUS_ISOLATED_AUDIT=1 for the isolated authenticated journey');

  test.beforeEach(async ({ baseURL }) => {
    const hostname = baseURL ? new URL(baseURL).hostname : '';
    test.skip(!LOCAL_HOSTS.has(hostname), 'Isolated local target required');
  });

  test('desktop event popover is nonmodal and returns focus after Escape', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const item = await readSeededCalendarItem(page);
    const { trigger, dialog } = await openSeededPlannerEvent(page, item);

    expect(await dialog.getAttribute('aria-modal')).toBeNull();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    await trigger.focus();
    await trigger.click();
    const opened = page.getByRole('dialog', { name: item.title, exact: true });
    await expect(opened).toBeVisible();
    await expect(opened).not.toHaveAttribute('aria-modal', 'true');

    await page.keyboard.press('Escape');
    await expect(opened).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('mobile event sheet traps focus and returns it to the trigger', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const item = await readSeededCalendarItem(page);
    const { trigger, dialog } = await openSeededPlannerEvent(page, item);

    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    await trigger.focus();
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: item.title, exact: true });
    await expect(sheet).toBeVisible();
    const focusables = sheet.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    const focusableCount = await focusables.count();
    expect(focusableCount).toBeGreaterThan(0);
    await expect.poll(() => sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    for (let i = 0; i <= focusableCount; i += 1) {
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('reduced motion keeps planner controls exposed with pressed state semantics', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const item = await readSeededCalendarItem(page);
    const { trigger, dialog } = await openSeededPlannerEvent(page, item);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const transitionDuration = await trigger.evaluate((node) => {
      const value = getComputedStyle(node).transitionDuration;
      return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
    });
    expect(transitionDuration).toBeLessThanOrEqual(0.01);

    const viewGroup = page.getByRole('group', { name: 'View' });
    await expect(viewGroup.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(viewGroup.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(viewGroup.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await viewGroup.getByRole('button', { name: 'Agenda', exact: true }).click();
    await expect(viewGroup.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(viewGroup.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('groups creation and detail forms expose accessible names', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/groups', { waitUntil: 'domcontentloaded' });
    await waitForClientHydration(page);
    await expect(page.getByRole('heading', { name: 'Groups', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Group name' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create group', exact: true })).toBeVisible();

    const groupsResponse = await page.request.get('/api/v1/groups');
    expect(groupsResponse.ok()).toBe(true);
    const groupsBody = await groupsResponse.json();
    const groupId = groupsBody.data?.groups?.find((entry) => entry?.group?.id)?.group.id;
    test.skip(!groupId, 'The seeded learner has no group fixture for the detail-form label audit');

    await page.goto(`/groups/${groupId}`, { waitUntil: 'domcontentloaded' });
    await waitForClientHydration(page);
    // The invitation field is labelled "Owner email" in the current group
    // surface; retain the accepted "Invite email" wording if that copy lands
    // with the final shell while keeping the test tied to the accessible name.
    await expect(page.getByRole('textbox', { name: /^(Invite|Owner) email$/ })).toBeAttached();
    await expect(page.getByRole('textbox', { name: 'Resource label' })).toBeAttached();
    await expect(page.getByRole('textbox', { name: 'Resource URL' })).toBeAttached();
    await expect(page.getByText('Upload file', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Session title' })).toBeAttached();
    await expect(page.getByRole('textbox', { name: 'Starts' })).toBeAttached();
    await expect(page.getByRole('textbox', { name: 'Ends' })).toBeAttached();
  });

  for (const width of [320, 390, 430]) test(`account profile fits a ${width}px viewport`, async ({ page }) => {
    const cspErrors = [];
    page.on('console', message => {
      if (message.type() === 'error' && /Content Security Policy|violates.*directive/i.test(message.text())) cspErrors.push(message.text());
    });
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/account', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Profile details', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => [...window.__astro_clerk_component_props.get('user-profile').values()][0])).toMatchObject({
      path: '/account', routing: 'path',
      additionalOAuthScopes: { microsoft: ['Calendars.ReadWrite'], google: [
        'https://www.googleapis.com/auth/calendar.events.readonly',
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'https://www.googleapis.com/auth/calendar.app.created',
      ] },
    });
    expect(cspErrors).toEqual([]);
    const bounds = await page.locator('.cl-cardBox').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
});
