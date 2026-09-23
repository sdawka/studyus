import { expect, test } from '@playwright/test';

function watchPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  return () => expect(errors).toEqual([]);
}

async function shapeCourse(page) {
  await page.getByLabel('Topic').fill('Documentary filmmaking');
  await page.getByLabel('Level').fill('First project');
  await page.getByLabel('Learning outcome').fill('Shoot a short documentary');
  await page.getByRole('button', { name: 'Shape course' }).click();
}

function relativeLuminance([red, green, blue]) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

async function controlContrast(control) {
  return control.evaluate((field) => {
    // Computed styles retain OKLCH for theme tokens. Let the browser convert
    // them to sRGB instead of interpreting OKLCH coordinates as RGB channels.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const rgb = (value) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const style = getComputedStyle(field);
    return { foreground: rgb(style.color), background: rgb(style.backgroundColor) };
  });
}

test('onboarding keeps authoring local until a linked course import POST', async ({ page }, testInfo) => {
  const assertNoPageErrors = watchPageErrors(page);
  let importedCourse;
  await page.route('**/api/v1/onboarding/import-demo', async (route) => {
    importedCourse = route.request().postDataJSON().course;
    await route.fulfill({ json: { data: { course_slug: null } } });
  });

  await page.goto('/?view=onboarding');
  await expect(page.getByRole('heading', { name: 'Learning How to Learn' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('onboarding-welcome-390.png'), fullPage: true });
  await shapeCourse(page);
  await page.getByText('Ideas and skills', { exact: true }).click();
  await page.getByRole('button', { name: 'Add idea or skill' }).click();
  await page.getByText('Practice', { exact: true }).click();
  await page.getByRole('button', { name: 'Add practice' }).click();
  // A learner must be able to read a normal-length prompt on a phone without
  // horizontally scrolling inside the field.
  const prompt = page.getByLabel('Practice prompt', { exact: true }).first();
  await expect(prompt).toHaveValue('Explain or demonstrate: Shoot a short documentary');
  expect(await prompt.evaluate((field) => field.scrollWidth <= field.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('onboarding-shape-390.png'), fullPage: true });
  await page.getByRole('button', { name: 'Review and finish' }).click();
  await page.getByRole('button', { name: 'Finish and open course' }).click();
  await expect.poll(() => importedCourse).toBeTruthy();

  const module = importedCourse.modules[0];
  expect(module.outcome_ids).toEqual(importedCourse.outcomes.map((outcome) => outcome.id));
  expect(module.kc_ids).toEqual(importedCourse.kcs.map((kc) => kc.id));
  expect(module.experience_ids).toEqual(importedCourse.experiences.map((experience) => experience.id));
  assertNoPageErrors();
});

test('onboarding blocks review when mastery evidence is blank', async ({ page }) => {
  const assertNoPageErrors = watchPageErrors(page);
  let importCalls = 0;
  await page.route('**/api/v1/onboarding/import-demo', async (route) => {
    importCalls += 1;
    await route.fulfill({ json: { data: { course_slug: null } } });
  });

  await page.goto('/?view=onboarding');
  await shapeCourse(page);
  await page.getByText('Ideas and skills', { exact: true }).click();
  await page.getByLabel('Times you must show it').fill('');
  await expect(page.getByLabel('Times you must show it')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Review and finish' }).click();
  await expect(page.getByText('Correct the highlighted mastery fields before reviewing.')).toBeVisible();
  expect(importCalls).toBe(0);
  assertNoPageErrors();
});

test('course modules retain a failed answer, retry it, then focus the next activity', async ({ page }) => {
  const assertNoPageErrors = watchPageErrors(page);
  let attempts = 0;
  await page.route('**/api/v1/experiences/**/respond', async (route) => {
    attempts += 1;
    await route.fulfill(attempts === 1
      ? { status: 422, json: { error: { message: 'Response was not accepted yet.' } } }
      : { status: 201, json: { data: {} } });
  });

  await page.goto('/?view=course');
  const activity = page.locator('article').filter({ has: page.getByRole('button', { name: 'Save response' }) }).first();
  const answer = activity.getByLabel('Your response');
  await answer.fill('Keep this answer');
  await activity.getByRole('button', { name: 'Save response' }).click();
  await expect(activity.getByRole('status')).toContainText('Response was not accepted yet.');
  await expect(answer).toHaveValue('Keep this answer');
  await activity.getByRole('button', { name: 'Save response' }).click();
  await expect(activity.getByRole('button', { name: /^Continue to / })).toBeVisible();
  await activity.getByRole('button', { name: /^Continue to / }).click();
  await expect(page.locator('#experience-scaffold-access')).toBeFocused();
  expect(attempts).toBe(2);
  assertNoPageErrors();
});

test('course modules stay within each viewport across supported themes and schemes', async ({ page }, testInfo) => {
  const assertNoPageErrors = watchPageErrors(page);
  for (const width of [320, 1280]) {
    for (const theme of ['compass', 'focus', 'campus']) {
      for (const scheme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/?view=course');
        await page.locator('html').evaluate((element, values) => {
          element.dataset.theme = values.theme;
          element.dataset.scheme = values.scheme;
        }, { theme, scheme });
        await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
        await page.screenshot({ path: testInfo.outputPath(`course-modules-${width}-${theme}-${scheme}.png`), fullPage: true });
      }
    }
  }
  assertNoPageErrors();
});

test('course editor controls retain readable text across app themes and schemes', async ({ page }, testInfo) => {
  const assertNoPageErrors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['compass', 'focus', 'campus']) {
    for (const scheme of ['light', 'dark']) {
      await page.goto('/?view=editor');
      await page.locator('html').evaluate((element, values) => {
        element.dataset.theme = values.theme;
        element.dataset.scheme = values.scheme;
      }, { theme, scheme });
      const control = page.getByLabel('Learning outcome').first();
      await expect(control).toBeVisible();
      const { foreground, background } = await controlContrast(control);
      expect(contrastRatio(foreground, background), `${theme}/${scheme} editor control contrast`).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: testInfo.outputPath(`course-editor-390-${theme}-${scheme}.png`), fullPage: true });
    }
  }
  assertNoPageErrors();
});

test('next move keeps its activity action label and URL stable', async ({ page }) => {
  const assertNoPageErrors = watchPageErrors(page);
  await page.goto('/?view=next');
  const action = page.getByRole('link', { name: 'Open learning activity →' });
  await expect(action).toHaveAttribute('href', '/courses/learning-how-to-learn#experience-practice-evidence');
  assertNoPageErrors();
});
