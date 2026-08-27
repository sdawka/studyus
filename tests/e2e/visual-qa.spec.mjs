import { test, expect } from '@playwright/test';
import { runHarness } from './run-harness.mjs';

test('capture the visual QA matrix', async ({ baseURL }, testInfo) => {
  test.setTimeout(900_000);
  const output = await runHarness('scripts/visual-qa.mjs', [baseURL, testInfo.outputPath('screenshots')]);
  expect(output).toContain('No JS console/page errors captured.');
});
