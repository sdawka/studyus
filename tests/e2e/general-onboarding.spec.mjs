import { createClerkClient } from '@clerk/backend';
import { clerk } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';
import { loadClerkE2EEnv, setupClerkTestingContext, setupClerkTestingWorker } from '../../scripts/lib/clerk-e2e-auth.mjs';

test.describe.configure({ mode: 'serial' });
test.describe('isolated general onboarding journeys', () => {
  test.skip(process.env.STUDYUS_ISOLATED_ONBOARDING_E2E !== '1', 'Set STUDYUS_ISOLATED_ONBOARDING_E2E=1 for fresh-account onboarding journeys');

  let clerkClient;
  let createdUserId;

  test.beforeEach(async ({ baseURL, context, page }) => {
    const hostname = baseURL ? new URL(baseURL).hostname : '';
    test.skip(!['127.0.0.1', 'localhost', '[::1]'].includes(hostname), 'Fresh-account journey requires an isolated local target');

    const env = loadClerkE2EEnv();
    await setupClerkTestingWorker();
    await setupClerkTestingContext(context);
    clerkClient = createClerkClient({ secretKey: env.secretKey });
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `studyus-onboarding-${suffix}+clerk_test@example.com`;
    const user = await clerkClient.users.createUser({
      emailAddress: [email],
      password: env.password,
      firstName: 'Fresh',
      lastName: 'Learner',
      skipLegalChecks: true,
    });
    createdUserId = user.id;

    await page.goto(new URL('/login', baseURL).href, { waitUntil: 'domcontentloaded' });
    await clerk.signIn({ page, emailAddress: email });
  });

  test.afterEach(async () => {
    if (createdUserId) await clerkClient.users.deleteUser(createdUserId);
    createdUserId = undefined;
  });

  test('a new account receives the default course and Skip opens it', async ({ page }) => {
    const profile = await page.request.get('/api/v1/user');
    expect(profile.ok()).toBe(true);
    const courses = await page.request.get('/api/v1/courses');
    expect(courses.ok()).toBe(true);
    const body = await courses.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      title: 'Learning How to Learn',
      source_template_key: 'learning-how-to-learn',
      source_template_version: '1',
      domain_version: 2,
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/onboarding$/);
    const skip = page.getByRole('button', { name: 'Skip to my course' });
    await skip.focus();
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/courses\/learning-how-to-learn$/);
    await expect(page.getByRole('heading', { name: 'Learning How to Learn' })).toBeVisible();
    const modules = page.getByRole('region', { name: 'Course modules' }).getByRole('heading', { level: 3 });
    await expect(modules).toHaveText([
      'How do you know you’ve learned something?',
      'How do you access what you’ve learned?',
      'What does learning feel like?',
      'What helps you learn best?',
      'How can you keep getting better at learning?',
    ]);
  });

  test('mobile keyboard flow creates a non-academic course', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/onboarding', { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    for (const [label, value] of [
      ['Topic', 'Documentary filmmaking'],
      ['Level', 'First project'],
      ['Learning outcome', 'Plan and shoot a coherent short documentary'],
    ]) {
      const field = page.getByLabel(label, { exact: true });
      await field.focus();
      await page.keyboard.type(value);
    }
    const shape = page.getByRole('button', { name: 'Shape course' });
    await shape.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Documentary filmmaking' })).toBeVisible();

    const review = page.getByRole('button', { name: 'Review' });
    await review.focus();
    await page.keyboard.press('Enter');
    const finish = page.getByRole('button', { name: 'Finish and open course' });
    await finish.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/courses\/documentary-filmmaking$/);

    const courses = await page.request.get('/api/v1/courses');
    const body = await courses.json();
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Documentary filmmaking', topic: 'Documentary filmmaking', term: null }),
    ]));
    const user = await (await page.request.get('/api/v1/user')).json();
    expect(user.data).toMatchObject({ institution_name: null, program_name: null, current_term: null });
  });
});
