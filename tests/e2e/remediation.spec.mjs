import { expect, test } from './authenticated-fixture.mjs';
import { CLERK_AUTH_STATE_PATH } from '../../scripts/lib/clerk-e2e-auth.mjs';

async function waitForClientHydration(page) {
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
}

// This journey intentionally runs only against the isolated local remediation
// server. It creates durable local fixtures and therefore must never be part
// of a production or default browser run.
test.describe('authenticated groups remediation journey', () => {
  test.skip(process.env.STUDYUS_ISOLATED_AUDIT !== '1', 'Set STUDYUS_ISOLATED_AUDIT=1 for the isolated authenticated journey');
  test.use({ storageState: CLERK_AUTH_STATE_PATH });

  test.beforeEach(async ({ baseURL }) => {
    const hostname = baseURL ? new URL(baseURL).hostname : '';
    test.skip(!['127.0.0.1', 'localhost', '[::1]'].includes(hostname), 'Isolated local target required');
  });

  test('creates a group, edits its resource, schedules and RSVPs a session, and verifies owner membership', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const fixtureName = 'Synthetic audit fixture';
    const runId = Date.now().toString();
    await page.goto('/groups', { waitUntil: 'domcontentloaded' });
    await waitForClientHydration(page);
    const groupsResponse = await page.request.get('/api/v1/groups');
    expect(groupsResponse.ok()).toBe(true);
    const groupsBody = await groupsResponse.json();
    const existingFixture = groupsBody.data?.groups?.find((entry) => entry?.group?.name === fixtureName && entry?.role === 'owner' && entry?.group?.state === 'active');

    let groupName = fixtureName;
    let groupId = existingFixture?.group?.id;
    if (!groupId) {
      await page.goto('/groups', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Groups', exact: true })).toBeVisible();
      await waitForClientHydration(page);
      await page.getByRole('textbox', { name: 'Group name' }).fill(groupName);
      await page.getByRole('button', { name: 'Create group' }).click();

      const groupLink = page.getByRole('link', { name: groupName });
      await expect(groupLink).toBeVisible();
      const groupHref = await groupLink.getAttribute('href');
      expect(groupHref).toMatch(/^\/groups\/[^/]+$/);
      groupId = groupHref.split('/').pop();
      expect(groupId).toBeTruthy();
      await groupLink.click();
    } else {
      await page.goto(`/groups/${groupId}`, { waitUntil: 'domcontentloaded' });
    }

    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
    await waitForClientHydration(page);
    await expect(page.getByRole('heading', { name: groupName })).toBeVisible();
    await expect(page.getByText('Owner', { exact: true })).toBeVisible();

    const resourceLabel = `Audit reference ${runId}`;
    const editedResourceLabel = `Edited audit reference ${runId}`;
    await page.getByRole('textbox', { name: 'Resource label' }).fill(resourceLabel);
    await page.getByRole('textbox', { name: 'Resource URL' }).fill('https://example.com/audit-reference');
    await page.getByRole('button', { name: 'Add resource' }).click();
    const resourceItem = page.locator('.resource-list li').filter({ hasText: resourceLabel });
    await expect(resourceItem.getByRole('link', { name: resourceLabel })).toBeVisible();

    await resourceItem.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('textbox', { name: 'Resource label' }).fill(editedResourceLabel);
    await page.getByRole('button', { name: 'Save resource' }).click();
    await expect(page.getByRole('link', { name: editedResourceLabel })).toBeVisible();

    const resourcesResponse = await page.request.get(`/api/v1/groups/${groupId}/resources`);
    expect(resourcesResponse.ok()).toBe(true);
    const resourcesBody = await resourcesResponse.json();
    expect(resourcesBody.data.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: editedResourceLabel, url: 'https://example.com/audit-reference' }),
    ]));

    const groupFileName = `synthetic-group-file-${runId}.txt`;
    await page.locator('input[type="file"]').setInputFiles({
      name: groupFileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('synthetic group file'),
    });
    await expect(page.getByRole('link', { name: groupFileName })).toBeVisible();
    const filesResponse = await page.request.get(`/api/v1/groups/${groupId}/files`);
    expect(filesResponse.ok()).toBe(true);
    const filesBody = await filesResponse.json();
    expect(filesBody.data.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: groupFileName }),
    ]));

    const courseResponse = await page.request.post('/api/v1/courses', {
      data: { code: `AUDIT${runId.slice(-6)}`, title: `Synthetic attachment source ${runId}` },
    });
    expect(courseResponse.ok()).toBe(true);
    const courseBody = await courseResponse.json();
    const courseId = courseBody.data.id;
    expect(courseId).toBeTruthy();
    const attachmentResponse = await page.request.post(`/api/v1/courses/${courseId}/attachments`, {
      headers: { Origin: new URL(baseURL).origin },
      multipart: { file: { name: `private-source-${runId}.txt`, mimeType: 'text/plain', buffer: Buffer.from('private source') } },
    });
    expect(attachmentResponse.ok()).toBe(true);
    const attachmentBody = await attachmentResponse.json();
    const attachmentId = attachmentBody.data.attachment_id;
    expect(attachmentId).toBeTruthy();

    // The private-file picker is intentionally populated after the course is
    // created so the browser exercises the real course and attachment APIs.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForClientHydration(page);
    await expect(page.getByRole('heading', { name: groupName })).toBeVisible();
    const coursePicker = page.getByRole('combobox', { name: 'Private course' });
    await expect(coursePicker).toBeVisible();
    await coursePicker.selectOption(courseId);
    const attachmentPicker = page.getByRole('combobox', { name: 'Private file' });
    await expect(attachmentPicker).toBeVisible();
    await expect(attachmentPicker.getByRole('option', { name: new RegExp(`private-source-${runId}\\.txt`) })).toBeAttached();
    await attachmentPicker.selectOption(attachmentId);
    await expect(attachmentPicker).toHaveValue(attachmentId);
    await page.getByRole('button', { name: 'Copy to group' }).click();
    await expect(page.getByRole('link', { name: new RegExp(`private-source-${runId}\\.txt`) })).toBeVisible();
    const copiedFilesResponse = await page.request.get(`/api/v1/groups/${groupId}/files`);
    expect(copiedFilesResponse.ok()).toBe(true);
    const copiedFilesBody = await copiedFilesResponse.json();
    expect(copiedFilesBody.data.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: `private-source-${runId}.txt` }),
    ]));

    const eventTitle = `Synthetic audit session ${runId}`;
    await page.getByRole('textbox', { name: 'Session title' }).fill(eventTitle);
    await page.getByRole('textbox', { name: 'Starts' }).fill('2030-01-20T15:00');
    await page.getByRole('textbox', { name: 'Ends' }).fill('2030-01-20T16:00');
    await page.getByRole('button', { name: 'Create session' }).click();
    await expect(page.getByText(eventTitle, { exact: true })).toBeVisible();

    const eventsResponse = await page.request.get(`/api/v1/groups/${groupId}/events`);
    expect(eventsResponse.ok()).toBe(true);
    const eventsBody = await eventsResponse.json();
    const event = eventsBody.data.events.find((candidate) => candidate.title === eventTitle);
    expect(event?.id).toBeTruthy();

    const goingButton = page.getByRole('button', { name: `Going for ${eventTitle}` });
    await goingButton.click();
    await expect(goingButton).toHaveAttribute('aria-pressed', 'true');
    // The click above is the only RSVP write. Reload and inspect both the
    // rendered state and the authenticated listing so a second API write
    // cannot mask a broken UI handler.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForClientHydration(page);
    await expect(page.getByRole('heading', { name: groupName })).toBeVisible();
    await expect(page.getByRole('button', { name: `Going for ${eventTitle}` })).toHaveAttribute('aria-pressed', 'true');
    const persistedEventsResponse = await page.request.get(`/api/v1/groups/${groupId}/events`);
    expect(persistedEventsResponse.ok()).toBe(true);
    const persistedEventsBody = await persistedEventsResponse.json();
    expect(persistedEventsBody.data.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: event.id, response: 'going' }),
    ]));

    const membersResponse = await page.request.get(`/api/v1/groups/${groupId}/members`);
    expect(membersResponse.ok()).toBe(true);
    const membersBody = await membersResponse.json();
    expect(membersBody.data.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'owner', label: expect.any(String), member_id: expect.any(String) }),
    ]));
    expect(membersBody.data.members[0]).not.toHaveProperty('user_id');
  });
});
