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
// Tracks scripts/seed.ts's default — the pre-rename `studybuddy` hash died
// with the 2026-08-13 DB wipe + reseed (see .claude/skills/agent-wave/SKILL.md).
const PASSWORD = process.env.VQA_PASSWORD ?? 'studyus';
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
// Dashboard-with-expanded-week is per-theme×scheme but overkill for the full
// matrix — just the 3 themes in light + compass dark.
const EXPANDED_WEEK_COMBOS = [
  { theme: 'compass', scheme: 'light' },
  { theme: 'focus', scheme: 'light' },
  { theme: 'campus', scheme: 'light' },
  { theme: 'compass', scheme: 'dark' },
];

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

// Dashboard with the WeekView expanded (click its Expand toggle), a subset
// of the theme×scheme matrix — 3 themes light + compass dark.
for (const { theme, scheme } of EXPANDED_WEEK_COMBOS) {
  await api('PATCH', '/api/v1/user', { settings: { theme, scheme } });
  await shot(`dashboard-week-expanded--${theme}-${scheme}`, '/dashboard', {
    before: async () => {
      // Expanded/collapsed state persists in localStorage (sb:weekview) across
      // page loads, so an unconditional click would collapse an already-expanded
      // view on later combos. Only click if not already expanded — and gate on
      // the toggle's aria-expanded, NOT on `.week-grid` existing: the expanded
      // grid stays mounted while collapsed (the cross-fade needs it), so an
      // existence check always short-circuits and captures the collapsed view.
      const el = page.locator('.toggle-btn').first();
      if ((await el.count()) === 0) {
        console.log(`MISSING selector for dashboard-week-expanded--${theme}-${scheme}: .toggle-btn`);
        return;
      }
      if ((await el.getAttribute('aria-expanded')) === 'true') return;
      await el.click();
      await page.waitForTimeout(300);
    },
  });
}

// Reset to defaults for single-pass + interaction shots
await api('PATCH', '/api/v1/user', { settings: { theme: 'compass', scheme: 'light' } });
for (const [name, path] of Object.entries(SINGLE_PAGES)) {
  await shot(`${name}--compass-light`, path);
}

// Feed masonry column reflow at two widths (columns: 5 240px, single-col <600px)
await page.setViewportSize({ width: 1440, height: 900 });
await shot('feed-masonry--1440', '/feed');
await page.setViewportSize({ width: 900, height: 900 });
await shot('feed-masonry--900', '/feed');
await page.setViewportSize({ width: 1440, height: 900 });

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
await clickShot('popover-bell', 'button[title="Notifications"]');
await clickShot('popover-todo', 'button[title="To-do"]');
await clickShot('popover-scratchpad', 'button[title="Scratchpad"]');
await clickShot('popover-avatar', 'button.avatar');
await clickShot('modal-record-event', 'button:text-matches("record event", "i")');
await clickShot('modal-add-course', '#add-course-btn, button:text-matches("add course", "i")');

// Planner: select an event (opens EventPopover) and switch to month view
await page.goto(BASE + '/planner', { waitUntil: 'networkidle' });
const eventBlock = page.locator('[data-event-id]').first();
if ((await eventBlock.count()) === 0) {
  console.log('MISSING selector for planner-event-selected: [data-event-id]');
} else {
  await eventBlock.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/planner-event-selected.png`, fullPage: false });
  console.log('shot planner-event-selected');
}
await page.goto(BASE + '/planner', { waitUntil: 'networkidle' });
const monthToggle = page.locator('.view-toggle .chip:text-matches("^month$", "i")');
if ((await monthToggle.count()) === 0) {
  console.log('MISSING selector for planner-month-view: .view-toggle .chip:text-matches("month")');
} else {
  await monthToggle.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/planner-month-view.png`, fullPage: true });
  console.log('shot planner-month-view');
}

// Sidebar collapsed + narrow viewports
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await page.evaluate(() => { document.documentElement.dataset.sidebar = 'collapsed'; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/sidebar-collapsed.png`, fullPage: false });
console.log('shot sidebar-collapsed');
await page.setViewportSize({ width: 820, height: 900 });
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/dashboard-narrow-820.png`, fullPage: true });
console.log('shot dashboard-narrow-820');

// Mobile pass — 390×844 (the mobile-shell breakpoint is ≤767px; 390 is the
// narrower of layout-check.cjs's two mobile widths), compass/light (already
// the active settings above). Replaces the old ~400px "known overflow
// evidence" shot now that docs/todo.md's app-wide overflow bug is fixed and
// ≤767px is a first-class bespoke layout (bottom nav + sheets + full-page
// planner/tasks), not just a narrower desktop — see docs/design/mobile-shell.md.
// Shoots every matrix + single page (all already reset to compass/light by
// the point this runs), plus the two header sheets that only exist at this
// breakpoint (bell/avatar have no bottom-nav tab; todo/scratchpad are
// display:none here and covered by the avatar sheet instead, so they're not
// shot).
await page.setViewportSize({ width: 390, height: 844 });
const MOBILE_PAGES = { ...MATRIX_PAGES, ...SINGLE_PAGES };
for (const [name, path] of Object.entries(MOBILE_PAGES)) {
  await shot(`mobile-390--${name}`, path);
}
async function mobileSheetShot(name, triggerSelector) {
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
  const el = page.locator(triggerSelector).first();
  if ((await el.count()) === 0 || !(await el.isVisible())) {
    console.log(`MISSING selector for ${name}: ${triggerSelector}`);
    return;
  }
  await el.click();
  await page.waitForTimeout(400); // sheet entrance animation (var(--motion-base))
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`shot ${name}`);
}
await mobileSheetShot('mobile-390--dashboard-bell-sheet', 'button[title="Notifications"]');
await mobileSheetShot('mobile-390--dashboard-avatar-sheet', 'button.avatar');

// Mobile theme×scheme matrix — the tab bar, sheets, and full-page
// planner/tasks only exist ≤767px, so contrast on those surfaces needs its
// own pass per theme/scheme (the compass/light combo is already covered by
// the mobile-390-- shots above).
for (const theme of THEMES) {
  for (const scheme of SCHEMES) {
    if (theme === 'compass' && scheme === 'light') continue;
    await api('PATCH', '/api/v1/user', { settings: { theme, scheme } });
    for (const [name, path] of Object.entries(MATRIX_PAGES)) {
      await shot(`mobile-390--${name}--${theme}-${scheme}`, path);
    }
  }
}
await api('PATCH', '/api/v1/user', { settings: { theme: 'compass', scheme: 'light' } });

// Landscape phone (844×390): width ≥768 means the DESKTOP shell at a very
// short viewport height — the risk band is vertical (sticky header + short
// content window), which the assert-based layout-check doesn't cover.
await page.setViewportSize({ width: 844, height: 390 });
for (const [name, path] of Object.entries({ dashboard: '/dashboard', planner: '/planner', tasks: '/tasks', course: MATRIX_PAGES.course })) {
  await shot(`landscape-844--${name}`, path);
}
await page.setViewportSize({ width: 1440, height: 900 });

// Restore defaults (light is now the default scheme, not system)
await api('PATCH', '/api/v1/user', { settings: { theme: 'compass', scheme: 'light' } });
await browser.close();
if (errors.length) {
  console.log('\nJS ERRORS CAPTURED:');
  for (const e of [...new Set(errors)]) console.log('  ' + e);
} else {
  console.log('\nNo JS console/page errors captured.');
}
