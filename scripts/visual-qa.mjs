// visual-qa.mjs — screenshot harness for studyus
// Usage: node scripts/visual-qa.mjs <baseUrl> <outDir>
// Requires: local Playwright, a dev server at baseUrl, and Clerk development
// credentials in .env.e2e.local (see .env.e2e.example).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { authenticateClerkContext, CLERK_AUTH_STATE_PATH } from './lib/clerk-e2e-auth.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4350';
const OUT = process.argv[3] ?? 'vqa-shots';
const COURSE = process.env.VQA_COURSE ?? 'chee-314-fluid-mechanics';
const USE_STORED_AUTH = process.env.E2E_USE_STORED_AUTH === '1';
// This matrix intentionally emits dozens of full-page captures. JPEG keeps
// the artifact set practical on CI and low-disk development machines while
// retaining enough detail for visual QA (text/layout/contrast/state review).
const SCREENSHOT_OPTIONS = { type: 'jpeg', quality: 85 };

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
  // v1.7 absorb experience. The learn page uses the CHEE 314 Navier-Stokes KC
  // (deterministic seed id, stable across reseeds) — flagship because it has
  // mixed-readiness prereqs across 4 depth levels after the verify phase's
  // demo readiness events.
  learn: '/learn/c1eb4cbf-7e99-760d-c1eb-4cbf7e99760d',
  corrections: '/corrections',
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
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  baseURL: BASE,
  ...(USE_STORED_AUTH ? { storageState: CLERK_AUTH_STATE_PATH } : {}),
});
// Hide the docs-overlay dev toggle (FAB) from every shot. The overlay panel is
// already screenshot-safe (starts closed); this flag suppresses only the
// always-on toggle, keeping QA captures free of dev chrome. See DocsOverlay.svelte.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('sb:docs-overlay-chrome', 'hidden');
  } catch {
    /* Safari private mode / storage disabled — nothing to hide anyway. */
  }
});
const page = await ctx.newPage();
const errors = [];
const appOrigin = new URL(BASE).origin;
page.on('console', (m) => {
  // Chromium's generic message omits the failed URL. Network responses below
  // report same-origin failures precisely; ignore generic third-party favicon
  // misses rather than attributing them to the current Studyus page.
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) {
    errors.push(`[console] ${page.url()}: ${m.text()}`);
  }
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()}: ${e.message}`));
page.on('response', (response) => {
  if (response.status() >= 400 && new URL(response.url()).origin === appOrigin) {
    errors.push(`[http] ${response.status()} ${response.url()}`);
  }
});

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
  await page.screenshot({ ...SCREENSHOT_OPTIONS, path: `${OUT}/${name}.jpg`, fullPage: true });
  console.log(`shot ${name}`);
}

// Unauthenticated login page first. When Playwright supplied shared Clerk
// state, use a separate clean context so /login does not redirect to the
// already-authenticated dashboard.
if (USE_STORED_AUTH) {
  const signedOutContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
  const signedOutPage = await signedOutContext.newPage();
  await signedOutPage.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await signedOutPage.screenshot({ ...SCREENSHOT_OPTIONS, path: `${OUT}/login.jpg`, fullPage: true });
  await signedOutContext.close();
  console.log('shot login');
} else {
  await shot('login', '/login');
}

// Sign in through Clerk and bind the identity to the seeded local learner.
if (!USE_STORED_AUTH) await authenticateClerkContext({ context: ctx, page, baseUrl: BASE });

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
  await page.screenshot({ ...SCREENSHOT_OPTIONS, path: `${OUT}/${name}.jpg`, fullPage: false });
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
  await page.screenshot({ ...SCREENSHOT_OPTIONS, path: `${OUT}/planner-event-selected.jpg`, fullPage: false });
  console.log('shot planner-event-selected');
}
await page.goto(BASE + '/planner', { waitUntil: 'networkidle' });
const monthToggle = page.locator('.view-toggle .chip:text-matches("^month$", "i")');
if ((await monthToggle.count()) === 0) {
  console.log('MISSING selector for planner-month-view: .view-toggle .chip:text-matches("month")');
} else {
  await monthToggle.click();
  await page.waitForTimeout(400);
  await page.screenshot({ ...SCREENSHOT_OPTIONS, path: `${OUT}/planner-month-view.jpg`, fullPage: true });
  console.log('shot planner-month-view');
}

// Sidebar collapsed + narrow viewports
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await page.evaluate(() => { document.documentElement.dataset.sidebar = 'collapsed'; });
await page.waitForTimeout(300);
await page.screenshot({ ...SCREENSHOT_OPTIONS, path: `${OUT}/sidebar-collapsed.jpg`, fullPage: false });
console.log('shot sidebar-collapsed');
await page.setViewportSize({ width: 820, height: 900 });
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await page.screenshot({ ...SCREENSHOT_OPTIONS, path: `${OUT}/dashboard-narrow-820.jpg`, fullPage: true });
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
  await page.screenshot({ ...SCREENSHOT_OPTIONS, path: `${OUT}/${name}.jpg`, fullPage: false });
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
