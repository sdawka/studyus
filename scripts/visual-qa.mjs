// visual-qa.mjs — screenshot harness for studyus
// Usage: NODE_PATH=<node20 global modules> node scripts/visual-qa.mjs <baseUrl> <outDir>
// Requires: playwright available via NODE_PATH, dev server running at baseUrl,
// seeded user credentials via VQA_EMAIL/VQA_PASSWORD (defaults below).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4350';
const OUT = process.argv[3] ?? 'vqa-shots';
const EMAIL = process.env.VQA_EMAIL ?? 'student@example.com';
const PASSWORD = process.env.VQA_PASSWORD ?? 'studybuddy';
const COURSE = process.env.VQA_COURSE ?? 'chee-314-fluid-mechanics';

mkdirSync(OUT, { recursive: true });

const THEMES = ['compass', 'focus', 'campus'];
const SCHEMES = ['light', 'dark'];
// Full theme×scheme matrix pages vs single-pass (compass/light) pages.
const MATRIX_PAGES = { dashboard: '/dashboard', course: `/courses/${COURSE}`, planner: '/planner', settings: '/settings' };
const SINGLE_PAGES = {
  courses: '/courses',
  concepts: `/courses/${COURSE}/concepts`,
  'class-notes': `/courses/${COURSE}/notes`,
  resources: `/courses/${COURSE}/resources`,
  practice: `/courses/${COURSE}/practice`,
  play: `/courses/${COURSE}/play`,
  feed: '/feed',
  tasks: '/tasks',
  notes: '/notes',
  profile: '/profile',
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${page.url()}: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()}: ${e.message}`));

async function api(method, path, body) {
  const res = await ctx.request.fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}`);
  return res;
}

async function shot(name, path, { before } = {}) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  if (before) await before();
  await page.waitForTimeout(300); // settle animations
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`shot ${name}`);
}

// Unauthenticated login page first
await shot('login', '/login');

// Log in
await api('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD });

// Theme × scheme matrix
for (const theme of THEMES) {
  for (const scheme of SCHEMES) {
    await api('PATCH', '/api/v1/user', { settings: { theme, scheme } });
    for (const [name, path] of Object.entries(MATRIX_PAGES)) {
      await shot(`${name}--${theme}-${scheme}`, path);
    }
  }
}

// Reset to defaults for single-pass + interaction shots
await api('PATCH', '/api/v1/user', { settings: { theme: 'compass', scheme: 'light' } });
for (const [name, path] of Object.entries(SINGLE_PAGES)) {
  await shot(`${name}--compass-light`, path);
}

// Interaction states (compass light, dashboard)
const clickShot = async (name, selector) => {
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) { console.log(`MISSING selector for ${name}: ${selector}`); return; }
  await el.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`shot ${name}`);
};
await clickShot('popover-bell', '[aria-label*="otification"], button:has(svg):near(:text("")) >> nth=0');
await clickShot('popover-todo', '[aria-label*="odo"], [aria-label*="ask"]');
await clickShot('popover-scratchpad', '[aria-label*="cratch"]');
await clickShot('popover-avatar', '[aria-label*="ccount"], [aria-label*="menu"], [aria-label*="vatar"]');
await clickShot('modal-record-event', 'button:text-matches("record event", "i")');
await clickShot('modal-add-course', '#add-course-btn, button:text-matches("add course", "i")');

// Sidebar collapsed + narrow viewport
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await page.evaluate(() => { document.documentElement.dataset.sidebar = 'collapsed'; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/sidebar-collapsed.png`, fullPage: false });
console.log('shot sidebar-collapsed');
await page.setViewportSize({ width: 820, height: 900 });
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/dashboard-narrow-820.png`, fullPage: true });
console.log('shot dashboard-narrow-820');

// Restore defaults
await api('PATCH', '/api/v1/user', { settings: { theme: 'compass', scheme: 'system' } });
await browser.close();
if (errors.length) {
  console.log('\nJS ERRORS CAPTURED:');
  for (const e of [...new Set(errors)]) console.log('  ' + e);
} else {
  console.log('\nNo JS console/page errors captured.');
}
