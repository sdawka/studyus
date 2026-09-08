import { expect, test } from './authenticated-fixture.mjs';
import { CLERK_AUTH_STATE_PATH } from '../../scripts/lib/clerk-e2e-auth.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

test.describe('planner all-day layout', () => {
  test.use({ storageState: CLERK_AUTH_STATE_PATH });

  test.beforeEach(async ({ baseURL }) => {
    test.skip(process.env.STUDYUS_ISOLATED_AUDIT !== '1', 'Set STUDYUS_ISOLATED_AUDIT=1 for the isolated authenticated journey');
    test.skip(!LOCAL_HOSTS.has(new URL(baseURL).hostname), 'Isolated local target required');
  });

  test('keeps long all-day event pills inside their day cells and out of Plan ahead', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/planner', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);

    const rail = page.locator('.planner-side');
    const allDayRow = page.locator('.all-day-row');
    const pills = page.locator('.all-day-pill');
    await expect(rail).toBeVisible();
    await expect(pills).not.toHaveCount(0);

    const bounds = await page.evaluate(() => {
      const row = document.querySelector('.all-day-row')?.getBoundingClientRect();
      const rail = document.querySelector('.planner-side')?.getBoundingClientRect();
      const pills = [...document.querySelectorAll('.all-day-pill')].map((pill) => {
        const pillRect = pill.getBoundingClientRect();
        const cellRect = pill.parentElement?.getBoundingClientRect();
        return {
          pillLeft: pillRect.left,
          pillRight: pillRect.right,
          cellLeft: cellRect?.left ?? 0,
          cellRight: cellRect?.right ?? 0,
        };
      });
      return { rowRight: row?.right ?? 0, railLeft: rail?.left ?? 0, pills };
    });

    expect(bounds.rowRight).toBeLessThanOrEqual(bounds.railLeft);
    for (const pill of bounds.pills) {
      expect(pill.pillLeft).toBeGreaterThanOrEqual(pill.cellLeft);
      expect(pill.pillRight).toBeLessThanOrEqual(pill.cellRight);
      expect(pill.pillRight).toBeLessThanOrEqual(bounds.railLeft);
    }
  });
});
