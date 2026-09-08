import { expect, test } from '@playwright/test';

function trackCspViolations(page) {
  const violations = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|violates.*directive/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
}

async function registeredProps(page, category) {
  return page.evaluate((componentCategory) => {
    const entries = window.__astro_clerk_component_props?.get(componentCategory);
    return entries ? [...entries.values()][0] : undefined;
  }, category);
}

test('built Clerk sign-in retains the local signup and reviewed return path', async ({ page, baseURL }) => {
  const violations = trackCspViolations(page);
  await page.goto('/sign-in?from=demo&return=%2Fplanner', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toBeVisible();
  const signup = page.getByRole('link', { name: 'Sign up', exact: true });
  await expect(signup).toBeVisible();

  const destination = new URL(await signup.getAttribute('href'), baseURL);
  expect(destination.origin).toBe(new URL(baseURL).origin);
  expect(destination.pathname).toBe('/sign-up');
  expect(destination.searchParams.get('return')).toBe('/planner');
  expect(destination.searchParams.get('from')).toBe('demo');
  await expect.poll(() => registeredProps(page, 'sign-in')).toMatchObject({
    path: '/sign-in',
    signUpUrl: '/sign-up?return=%2Fplanner&from=demo',
  });
  expect(violations).toEqual([]);
});

test('built Clerk sign-up retains the local signin and reviewed return path', async ({ page, baseURL }) => {
  const violations = trackCspViolations(page);
  await page.goto('/sign-up?from=demo&return=%2Fplanner', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toBeVisible();
  const signin = page.getByRole('link', { name: 'Sign in', exact: true });
  await expect(signin).toBeVisible();

  const destination = new URL(await signin.getAttribute('href'), baseURL);
  expect(destination.origin).toBe(new URL(baseURL).origin);
  expect(destination.pathname).toBe('/sign-in');
  expect(destination.searchParams.get('return')).toBe('/planner');
  expect(destination.searchParams.get('from')).toBe('demo');
  await expect.poll(() => registeredProps(page, 'sign-up')).toMatchObject({
    path: '/sign-up',
    signInUrl: '/sign-in?return=%2Fplanner&from=demo',
  });
  expect(violations).toEqual([]);
});
