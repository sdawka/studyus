// layout-check.cjs — fast, assert-based layout regression guard for studyus.
//
// Unlike scripts/visual-qa.mjs (which screenshots pages for human/LLM review),
// this script makes no images — it logs in, walks a viewport x sidebar-state
// matrix, and asserts hard layout invariants (no horizontal overflow, centered
// content column, no element bleeding past the viewport edge, dashboard rail
// side-by-side/stacked at the right width, popovers on-screen). It exits
// non-zero with a readable failure list, so it's meant to be run before/after
// layout-affecting changes, not just eyeballed.
//
// A second pass runs the same page matrix once more at CONFIG.mobileViewportWidths
// (390/430), OUTSIDE the sidebarStates loop — the sidebar is display:none at
// that breakpoint (docs/design/mobile-shell.md), so there's no expanded/
// collapsed axis on mobile. It reuses no-overflow/no-right-edge-overflow/
// rail-layout/centered-gutters and adds mobile-only checks (bottom nav,
// sidebar actually hidden, header doesn't overflow, header popovers as
// sheets, planner/tasks as full tab pages instead of modals). The desktop
// matrix above is untouched by this addition.
//
// Usage:
//   npm run check:layout
//   node scripts/layout-check.cjs [baseUrl]
//
// Requires Playwright, which in this repo is installed globally under Node 20
// (not the Node 24 used for `astro dev`/`npm run`), so invoke via:
//   N20=~/.nvm/versions/node/v20.20.2
//   NODE_PATH=$N20/lib/node_modules $N20/bin/node scripts/layout-check.cjs
// `npm run check:layout` will fail with "Cannot find module 'playwright'"
// unless NODE_PATH is set that way first, or Playwright is installed locally.
//
// Env vars: LAYOUT_CHECK_EMAIL / LAYOUT_CHECK_PASSWORD (seeded user creds —
// the password default below tracks scripts/seed.ts; only set the env
// override if that default ever drifts from the seeded password),
// LAYOUT_CHECK_COURSE (course slug to use for course-page checks).

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const require20 = createRequire(__filename);
const { chromium } = require20('playwright');

// ---------------------------------------------------------------------------
// CONFIG — re-baseline here. Numbers below are read from the current app
// (src/styles/tokens.css, src/layouts/AppShell.astro, src/pages/dashboard.astro)
// as of the "layout rework" in progress; re-check them once that work lands.
// ---------------------------------------------------------------------------
const CONFIG = {
  baseUrl: process.argv[2] || process.env.LAYOUT_CHECK_BASE_URL || 'http://localhost:4321',
  email: process.env.LAYOUT_CHECK_EMAIL || 'student@example.com',
  password: process.env.LAYOUT_CHECK_PASSWORD || 'studyus',
  course: process.env.LAYOUT_CHECK_COURSE || 'chee-314-fluid-mechanics',
  // v1.7 /learn absorb experience (wave-2 UI track) — "Continuity equation"
  // in the seeded chee-314 course, chosen because it has 3 not-ready
  // prereqs (real seed data, not fixture-only), so the prereq-map stage
  // actually renders the amber/not-ready state this check matrix cares
  // about. Update if that KC's id or readiness ever drifts after a reseed.
  learnKcId: process.env.LAYOUT_CHECK_LEARN_KC || 'cfe52a8d-1867-c4db-cfe5-2a8d1867c4db',

  // src/styles/tokens.css --content-max
  contentMaxPx: 1320,
  // src/layouts/AppShell.astro `main`'s padding is token-driven now
  // (--content-pad-top/-x/-bottom, src/styles/tokens.css :root) rather than
  // a literal `28px 32px 56px` — this is the left/right token's desktop
  // value (--content-pad-x), i.e. the gutter when content is narrower than
  // its container. The mobile-shell token migration kept the desktop
  // numbers byte-identical (only the ≤767px override differs, at 16px,
  // which the desktop-only matrix below never exercises) — re-check this
  // if the token value itself ever drifts.
  mainInlinePaddingPx: 32,
  // src/layouts/AppShell.astro var(--sidebar-w, 240px) / collapsed 60px.
  sidebarWidthPx: { expanded: 240, collapsed: 60 },

  viewportWidths: [1440, 1280, 1024, 820],
  sidebarStates: ['expanded', 'collapsed'],
  viewportHeight: 900,
  // Mobile pass (plan Part 3, docs/design/mobile-shell.md) — see the header
  // comment above. Runs once per width, after the desktop matrix, with no
  // sidebar-state axis.
  mobileViewportWidths: [320, 390, 430],

  // Tolerance for "no horizontal overflow" / "no element past the right
  // edge" — sub-pixel layout rounding shows up as <1px slop across browsers.
  overflowTolerancePx: 1,
  // Tolerance for "gutters are equal" — a couple px of rounding is fine,
  // a lopsided column is not.
  gutterTolerancePx: 2,

  pages: {
    dashboard: '/dashboard',
    feed: '/feed',
    planner: '/planner',
    tasks: '/tasks',
    notes: '/notes',
    profile: '/profile',
    'course-overview': (course) => `/courses/${course}`,
    'course-concepts': (course) => `/courses/${course}/concepts`,
    'course-resources': (course) => `/courses/${course}/resources`,
    // v1.7 additions (wave-2 UI track).
    learn: () => `/learn/${CONFIG.learnKcId}`,
    corrections: '/corrections',
  },

  // Checks that are known to flake right now because another agent is
  // actively reworking layout breakpoints (dashboard rail / feed masonry).
  // Failures here are reported as PENDING, not FAIL, and don't affect the
  // exit code. TODO(layout-rework): once that work lands, re-run without
  // this allowlist, confirm real pass/fail, and delete entries that now
  // pass consistently.
  // Re-baselined 2026-08-12 after the container-query layout rework landed —
  // all previously-pending dashboard/feed checks now run for real. Add entries
  // here ONLY while a known layout rework is in flight, with a TODO naming it.
  pendingRebaseline: [],

  // Selectors to exclude from the "nothing overflows the right edge" scan:
  // Astro's dev toolbar is a fixed-position overlay outside app layout, and
  // <html>/<body> themselves aren't meaningful "elements" for this check.
  overflowWhitelistSelector: 'astro-dev-toolbar, astro-dev-toolbar *, html, body',

  popovers: [
    { name: 'bell', trigger: 'button[title="Notifications"]' },
    { name: 'todo', trigger: 'button[title="To-do"]' },
    { name: 'scratchpad', trigger: 'button[title="Scratchpad"]' },
    { name: 'avatar', trigger: 'button.avatar' },
  ],
  popoverSelector: '.popover.panel',
  // Mobile replacement for the popover check above — same trigger list.
  // bell/avatar render a portaled Sheet at this breakpoint and are real
  // assertions; todo/scratchpad are display:none (HeaderActions.svelte's
  // `.mobile-hide` wrapper) and fall through checkSheet's hidden-trigger
  // skip path, same as a trigger that doesn't exist.
  sheetPanelSelector: '.sheet-panel',
  // Route pages that become full-page tab destinations instead of
  // centered modals at ≤767px (docs/design/mobile-shell.md "Route modals
  // → tab destinations"). layerId matches each .astro file's root overlay
  // div id.
  //
  // /tasks is NOT here: it was converted from an overlay (slot="overlay"
  // modal with #tasks-layer/.scrim/.panel/.close-btn) to a normal page
  // rendered in the default slot. It's already in CONFIG.pages above, so
  // it gets the same page-level checks as /feed, /notes, etc. — desktop
  // matrix (no-overflow, centered-gutters, no-right-edge-overflow) and
  // mobile-pass shell invariants (bottom-nav, sidebar-hidden, header-fits)
  // — with no separate route-page-mobile check needed.
  routePagesMobile: [
    { name: 'planner', path: '/planner', layerId: 'planner-layer' },
  ],
};

// ---------------------------------------------------------------------------

function isPending(pageName, checkName) {
  return CONFIG.pendingRebaseline.some((p) => p.page === pageName && p.check === checkName);
}

function readDashboardStackBreakpoint() {
  const fallback = 1000;
  try {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/pages/dashboard.astro'),
      'utf8',
    );
    const m = src.match(/@container\s*\(max-width:\s*(\d+)px\)/);
    return m ? Number(m[1]) : fallback;
  } catch {
    return fallback;
  }
}

const results = []; // { page, viewport, sidebar, check, status: pass|fail|pending, message }

function record(pageName, viewport, sidebar, check, ok, message) {
  if (!ok && isPending(pageName, check)) {
    results.push({ page: pageName, viewport, sidebar, check, status: 'pending', message });
    return;
  }
  results.push({ page: pageName, viewport, sidebar, check, status: ok ? 'pass' : 'fail', message });
}

async function setSidebar(context, state) {
  await context.addInitScript((s) => {
    try {
      window.localStorage.setItem('sb:sidebar', s);
    } catch {}
  }, state);
}

async function checkNoOverflow(page) {
  return page.evaluate((tolerance) => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    return { ok: overflow <= tolerance, overflow, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  }, CONFIG.overflowTolerancePx);
}

async function checkCenteredGutters(page) {
  return page.evaluate(
    ({ contentMax, tolerance }) => {
      const main = document.querySelector('main');
      if (!main) return { ok: true, skipped: true, reason: 'no <main>' };
      const parent = main.parentElement;
      if (!parent) return { ok: true, skipped: true, reason: 'no main parent' };
      const mainRect = main.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      if (parentRect.width <= contentMax + 4) {
        return { ok: true, skipped: true, reason: 'container narrower than content-max, gutters not expected' };
      }
      const leftGutter = mainRect.left - parentRect.left;
      const rightGutter = parentRect.right - mainRect.right;
      const diff = Math.abs(leftGutter - rightGutter);
      return {
        ok: diff <= tolerance && mainRect.width <= contentMax + tolerance,
        leftGutter,
        rightGutter,
        diff,
        mainWidth: mainRect.width,
      };
    },
    { contentMax: CONFIG.contentMaxPx, tolerance: CONFIG.gutterTolerancePx },
  );
}

async function checkNoRightEdgeOverflow(page) {
  return page.evaluate(
    ({ tolerance, whitelistSelector }) => {
      const whitelisted = new Set(document.querySelectorAll(whitelistSelector));
      const vw = window.innerWidth;
      const violations = [];
      // Elements inside an intentional horizontal scroller (overflow-x auto/
      // scroll ancestor, e.g. the dashboard week strip at narrow widths) may
      // legitimately extend past the viewport — they scroll within their
      // container. Skip them; the page-level scrollWidth check still catches
      // real page overflow.
      // 'hidden' counts too: clipped content (e.g. the collapsed week-view
      // reveal panel, which stays mounted at full width inside an
      // overflow:hidden wrapper) can't cause page scroll either.
      const insideClippingAncestor = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        }
        return false;
      };
      const insideHScroller = insideClippingAncestor;
      for (const el of document.querySelectorAll('*')) {
        if (whitelisted.has(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // not rendered
        if (rect.right > vw + tolerance && !insideHScroller(el)) {
          const cls = typeof el.className === 'string' ? el.className : '';
          violations.push(
            `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls.split(' ').filter(Boolean).join('.') : ''} right=${rect.right.toFixed(1)} (vw=${vw})`,
          );
          if (violations.length >= 10) break;
        }
      }
      return { ok: violations.length === 0, violations };
    },
    { tolerance: CONFIG.overflowTolerancePx, whitelistSelector: CONFIG.overflowWhitelistSelector },
  );
}

async function checkDashboardRail(page, breakpoint) {
  return page.evaluate((bp) => {
    const main = document.querySelector('main');
    // Scope to the content area — the sidebar also has a `.rail` element,
    // and an unscoped querySelector matched that one first (false negative).
    const grid = document.querySelector('main .grid');
    const rail = document.querySelector('main .grid .rail, main .grid > .rail');
    if (!main || !grid || !rail) {
      return { ok: true, skipped: true, reason: 'dashboard rail markup not found (onboarding/empty state?)' };
    }
    // Container queries measure the container's CONTENT box — compare against
    // that, not the border-box (main has 32px inline padding).
    const ms = getComputedStyle(main);
    const mainWidth = main.clientWidth - parseFloat(ms.paddingLeft) - parseFloat(ms.paddingRight);
    const gridRect = grid.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    // Side-by-side: rail sits to the right of the grid's other column, same row.
    // Stacked: rail sits below, full width of the grid.
    const sideBySide = Math.abs(railRect.top - gridRect.top) < 4 && railRect.left > gridRect.left + 100;
    const expectSideBySide = mainWidth > bp;
    return {
      ok: sideBySide === expectSideBySide,
      mainWidth,
      breakpoint: bp,
      expectSideBySide,
      actualSideBySide: sideBySide,
    };
  }, breakpoint);
}

async function checkPopover(page, trigger, popoverSelector) {
  const triggerEl = page.locator(trigger).first();
  if ((await triggerEl.count()) === 0) {
    return { ok: true, skipped: true, reason: `trigger not found: ${trigger}` };
  }
  await triggerEl.click();
  await page.waitForTimeout(200);
  const panel = page.locator(popoverSelector).first();
  if ((await panel.count()) === 0) {
    return { ok: false, reason: `no ${popoverSelector} appeared after clicking ${trigger}` };
  }
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return { ok: false, reason: 'could not measure popover bounding box' };
  const ok =
    box.x >= -CONFIG.overflowTolerancePx &&
    box.y >= -CONFIG.overflowTolerancePx &&
    box.x + box.width <= viewport.width + CONFIG.overflowTolerancePx &&
    box.y + box.height <= viewport.height + CONFIG.overflowTolerancePx;
  // Close it again so the next popover check starts clean.
  await triggerEl.click();
  await page.waitForTimeout(150);
  return { ok, box, viewport };
}

// ---------------------------------------------------------------------------
// Mobile pass checks (plan Part 3, docs/design/mobile-shell.md). Only run at
// CONFIG.mobileViewportWidths — never part of the desktop matrix above.
// ---------------------------------------------------------------------------

async function checkBottomNav(page) {
  return page.evaluate((tolerance) => {
    const nav = document.querySelector('nav.bottom-nav');
    if (!nav) return { ok: false, reason: 'nav.bottom-nav not found' };
    if (getComputedStyle(nav).display === 'none') {
      return { ok: false, reason: 'nav.bottom-nav is display:none at a mobile viewport width' };
    }
    const rect = nav.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inViewport =
      rect.left >= -tolerance && rect.right <= vw + tolerance && rect.top >= -tolerance && rect.bottom <= vh + tolerance;
    const bottomAnchored = Math.abs(rect.bottom - vh) <= tolerance;
    const tallEnough = rect.height >= 48 - tolerance;
    return {
      ok: inViewport && bottomAnchored && tallEnough,
      reason: `inViewport=${inViewport} bottomAnchored=${bottomAnchored} (bottom=${rect.bottom.toFixed(1)} vh=${vh}) tallEnough=${tallEnough} (height=${rect.height.toFixed(1)})`,
    };
  }, CONFIG.overflowTolerancePx);
}

async function checkSidebarHidden(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector('nav.sidebar');
    if (!sidebar) return { ok: true, skipped: true, reason: 'no nav.sidebar in DOM' };
    // display:none (Sidebar.astro's ≤767px rule) makes offsetParent null —
    // the test the plan specifies. A hidden ancestor would also null this
    // out, which is fine: any reason the sidebar isn't rendered satisfies
    // "sidebar-hidden".
    const hidden = sidebar.offsetParent === null;
    return { ok: hidden, reason: hidden ? '' : 'nav.sidebar still has a non-null offsetParent' };
  });
}

async function checkHeaderFits(page) {
  return page.evaluate((tolerance) => {
    const header = document.querySelector('header.app-header');
    if (!header) return { ok: true, skipped: true, reason: 'no header.app-header in DOM' };
    const ok = header.scrollWidth <= header.clientWidth + tolerance;
    return { ok, reason: ok ? '' : `scrollWidth=${header.scrollWidth} > clientWidth=${header.clientWidth}` };
  }, CONFIG.overflowTolerancePx);
}

// Mobile replacement for checkPopover: same trigger, but the panel is a
// portaled Sheet (`.sheet-panel`) and dismissal is a scrim tap (Sheet's
// actual contract, docs/design/mobile-shell.md "Sheet contract") rather
// than re-clicking the trigger.
async function checkSheet(page, trigger, panelSelector) {
  const triggerEl = page.locator(trigger).first();
  if ((await triggerEl.count()) === 0) {
    return { ok: true, skipped: true, reason: `trigger not found: ${trigger}` };
  }
  if (!(await triggerEl.isVisible())) {
    // todo/scratchpad: display:none at this breakpoint — same skip path as
    // a missing trigger, per plan Part 3.
    return { ok: true, skipped: true, reason: `trigger hidden at this breakpoint: ${trigger}` };
  }
  await triggerEl.click();
  await page.waitForTimeout(250); // Sheet's entrance animation (var(--motion-base))
  const panel = page.locator(panelSelector).first();
  if ((await panel.count()) === 0) {
    return { ok: false, reason: `no ${panelSelector} appeared after clicking ${trigger}` };
  }
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return { ok: false, reason: 'could not measure sheet panel bounding box' };
  const inViewport =
    box.x >= -CONFIG.overflowTolerancePx &&
    box.y >= -CONFIG.overflowTolerancePx &&
    box.x + box.width <= viewport.width + CONFIG.overflowTolerancePx &&
    box.y + box.height <= viewport.height + CONFIG.overflowTolerancePx;
  const scrim = page.locator('.sheet-scrim').first();
  let dismissedOk = false;
  if ((await scrim.count()) > 0) {
    await scrim.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(200);
    dismissedOk = (await page.locator(panelSelector).count()) === 0;
  }
  return {
    ok: inViewport && dismissedOk,
    reason: inViewport && dismissedOk ? '' : `inViewport=${inViewport} box=${JSON.stringify(box)} vs viewport=${JSON.stringify(viewport)}; dismissedOk=${dismissedOk}`,
  };
}

// Verifies the planner/tasks route layer's mobile presentation: a full tab
// page between the header and tab bar, not a centered modal-with-scrim (see
// docs/design/mobile-shell.md "Route modals → tab destinations").
async function checkRoutePageMobile(page, layerId) {
  return page.evaluate((id) => {
    const layer = document.getElementById(id);
    if (!layer) return { ok: false, reason: `#${id} not found` };
    const scrim = layer.querySelector('.scrim');
    const scrimVisible = !!scrim && getComputedStyle(scrim).display !== 'none';
    const panel = layer.querySelector('.panel');
    if (!panel) return { ok: false, reason: `.panel not found inside #${id}` };
    const panelRect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const panelWidthOk = Math.abs(panelRect.width - vw) <= 2;
    const closeBtn = layer.querySelector('.close-btn');
    const closeBtnHidden = !closeBtn || getComputedStyle(closeBtn).display === 'none';

    // elementsFromPoint (not elementFromPoint) so a fixed overlay stacked
    // on top of the tab bar can't win by z-order alone — walk the full
    // stack for the first hit that isn't Astro's dev toolbar (same overlay
    // the desktop overflowWhitelistSelector excludes) or a document root.
    const nav = document.querySelector('nav.bottom-nav');
    let hitOk = false;
    let hitTag = null;
    if (nav) {
      const navRect = nav.getBoundingClientRect();
      const cx = navRect.left + navRect.width / 2;
      const cy = navRect.top + navRect.height / 2;
      const stack = document.elementsFromPoint(cx, cy);
      const hit = stack.find(
        (el) => !el.closest('astro-dev-toolbar') && el !== document.documentElement && el !== document.body,
      );
      hitTag = hit
        ? `${hit.tagName.toLowerCase()}${hit.className ? '.' + hit.className.toString().split(' ').filter(Boolean).join('.') : ''}`
        : null;
      hitOk = !!(hit && hit.closest('nav.bottom-nav'));
    }

    const ok = !scrimVisible && panelWidthOk && closeBtnHidden && hitOk;
    return {
      ok,
      reason: ok
        ? ''
        : `scrimVisible=${scrimVisible} panelWidth=${panelRect.width.toFixed(1)} vw=${vw} closeBtnHidden=${closeBtnHidden} hitOk=${hitOk} hitTag=${hitTag}`,
    };
  }, layerId);
}

async function main() {
  const dashboardStackBreakpoint = readDashboardStackBreakpoint();
  console.log(`layout-check: base=${CONFIG.baseUrl} dashboard rail breakpoint=${dashboardStackBreakpoint}px\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: CONFIG.baseUrl });
  const page = await context.newPage();

  // Log in via the API, same as visual-qa.mjs.
  const loginRes = await context.request.fetch(CONFIG.baseUrl + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: CONFIG.baseUrl },
    data: JSON.stringify({ email: CONFIG.email, password: CONFIG.password }),
  });
  if (!loginRes.ok()) {
    console.error(`Login failed: ${loginRes.status()} ${await loginRes.text()}`);
    process.exit(1);
  }

  const resolvedPages = Object.entries(CONFIG.pages).map(([name, p]) => [
    name,
    typeof p === 'function' ? p(CONFIG.course) : p,
  ]);

  for (const sidebar of CONFIG.sidebarStates) {
    await setSidebar(context, sidebar);
    for (const width of CONFIG.viewportWidths) {
      await page.setViewportSize({ width, height: CONFIG.viewportHeight });
      for (const [pageName, pagePath] of resolvedPages) {
        await page.goto(CONFIG.baseUrl + pagePath, { waitUntil: 'networkidle' });
        await page.waitForTimeout(150);

        const overflow = await checkNoOverflow(page);
        record(
          pageName,
          width,
          sidebar,
          'no-overflow',
          overflow.ok,
          overflow.ok ? '' : `scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
        );

        const gutters = await checkCenteredGutters(page);
        if (!gutters.skipped) {
          record(
            pageName,
            width,
            sidebar,
            'centered-gutters',
            gutters.ok,
            gutters.ok
              ? ''
              : `left=${gutters.leftGutter.toFixed(1)} right=${gutters.rightGutter.toFixed(1)} diff=${gutters.diff.toFixed(1)} mainWidth=${gutters.mainWidth.toFixed(1)}`,
          );
        }

        const rightEdge = await checkNoRightEdgeOverflow(page);
        record(
          pageName,
          width,
          sidebar,
          'no-right-edge-overflow',
          rightEdge.ok,
          rightEdge.ok ? '' : rightEdge.violations.join('; '),
        );

        if (pageName === 'dashboard') {
          const rail = await checkDashboardRail(page, dashboardStackBreakpoint);
          if (!rail.skipped) {
            record(
              pageName,
              width,
              sidebar,
              'rail-layout',
              rail.ok,
              rail.ok
                ? ''
                : `mainWidth=${rail.mainWidth.toFixed(1)} breakpoint=${rail.breakpoint} expectSideBySide=${rail.expectSideBySide} actualSideBySide=${rail.actualSideBySide}`,
            );
          }
        }
      }
    }
  }

  // Popovers: one representative viewport/sidebar combo (widest, expanded) —
  // these are viewport-relative overlays, not layout-column checks, so the
  // matrix above would be redundant here.
  await page.setViewportSize({ width: CONFIG.viewportWidths[0], height: CONFIG.viewportHeight });
  await setSidebar(context, 'expanded');
  await page.goto(CONFIG.baseUrl + CONFIG.pages.dashboard, { waitUntil: 'networkidle' });
  for (const { name, trigger } of CONFIG.popovers) {
    const res = await checkPopover(page, trigger, CONFIG.popoverSelector);
    if (res.skipped) {
      console.log(`  (skipped popover "${name}": ${res.reason})`);
      continue;
    }
    record(
      'dashboard',
      CONFIG.viewportWidths[0],
      'expanded',
      `popover-${name}`,
      res.ok,
      res.ok ? '' : res.reason || `box out of viewport: ${JSON.stringify(res.box)} vs ${JSON.stringify(res.viewport)}`,
    );
  }

  // ---- Mobile pass ---------------------------------------------------------
  // Runs once per width, after the desktop matrix above, with no
  // sidebar-state axis (the sidebar is display:none at this breakpoint —
  // see docs/design/mobile-shell.md). Desktop matrix is untouched.
  for (const width of CONFIG.mobileViewportWidths) {
    await page.setViewportSize({ width, height: CONFIG.viewportHeight });
    for (const [pageName, pagePath] of resolvedPages) {
      await page.goto(CONFIG.baseUrl + pagePath, { waitUntil: 'networkidle' });
      await page.waitForTimeout(150);

      const overflow = await checkNoOverflow(page);
      record(
        pageName,
        width,
        'mobile',
        'no-overflow',
        overflow.ok,
        overflow.ok ? '' : `scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
      );

      const gutters = await checkCenteredGutters(page);
      if (!gutters.skipped) {
        record(
          pageName,
          width,
          'mobile',
          'centered-gutters',
          gutters.ok,
          gutters.ok
            ? ''
            : `left=${gutters.leftGutter.toFixed(1)} right=${gutters.rightGutter.toFixed(1)} diff=${gutters.diff.toFixed(1)} mainWidth=${gutters.mainWidth.toFixed(1)}`,
        );
      }

      const rightEdge = await checkNoRightEdgeOverflow(page);
      record(
        pageName,
        width,
        'mobile',
        'no-right-edge-overflow',
        rightEdge.ok,
        rightEdge.ok ? '' : rightEdge.violations.join('; '),
      );

      if (pageName === 'dashboard') {
        const rail = await checkDashboardRail(page, dashboardStackBreakpoint);
        if (!rail.skipped) {
          record(
            pageName,
            width,
            'mobile',
            'rail-layout',
            rail.ok,
            rail.ok
              ? ''
              : `mainWidth=${rail.mainWidth.toFixed(1)} breakpoint=${rail.breakpoint} expectSideBySide=${rail.expectSideBySide} actualSideBySide=${rail.actualSideBySide}`,
          );
        }
      }

      const bottomNav = await checkBottomNav(page);
      record(pageName, width, 'mobile', 'bottom-nav', bottomNav.ok, bottomNav.reason);

      const sidebarHidden = await checkSidebarHidden(page);
      if (!sidebarHidden.skipped) {
        record(pageName, width, 'mobile', 'sidebar-hidden', sidebarHidden.ok, sidebarHidden.reason);
      }

      const headerFits = await checkHeaderFits(page);
      if (!headerFits.skipped) {
        record(pageName, width, 'mobile', 'header-fits', headerFits.ok, headerFits.reason);
      }
    }

    // Sheets: one representative page (dashboard), same as the desktop
    // popover pass above — reuses CONFIG.popovers (bell/avatar are real
    // assertions; todo/scratchpad skip via checkSheet's hidden-trigger path).
    await page.goto(CONFIG.baseUrl + CONFIG.pages.dashboard, { waitUntil: 'networkidle' });
    for (const { name, trigger } of CONFIG.popovers) {
      const res = await checkSheet(page, trigger, CONFIG.sheetPanelSelector);
      if (res.skipped) {
        console.log(`  (skipped sheet "${name}" @${width}: ${res.reason})`);
        continue;
      }
      record(`dashboard-${name}`, width, 'mobile', 'sheet-in-viewport', res.ok, res.reason);
    }

    // Route pages: planner/tasks become full tab pages, not modals, at this
    // breakpoint.
    for (const { name, path, layerId } of CONFIG.routePagesMobile) {
      await page.goto(CONFIG.baseUrl + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(150);
      const res = await checkRoutePageMobile(page, layerId);
      record(name, width, 'mobile', 'route-page-mobile', res.ok, res.reason);
    }
  }

  await browser.close();

  // ---- Report -------------------------------------------------------------
  const fails = results.filter((r) => r.status === 'fail');
  const pending = results.filter((r) => r.status === 'pending');
  const passes = results.filter((r) => r.status === 'pass');

  console.log(`\n${passes.length} passed, ${fails.length} failed, ${pending.length} pending re-baseline\n`);

  // Mobile check breakdown (check x viewport tally) — the mobile pass has
  // no sidebar axis to eyeball counts by, so spell out pass/total per check
  // per width here instead of leaving it to be reconstructed from the flat
  // results array.
  const mobileResults = results.filter((r) => r.sidebar === 'mobile');
  if (mobileResults.length) {
    console.log('MOBILE CHECK BREAKDOWN (check × viewport):');
    const byCheck = new Map();
    for (const r of mobileResults) {
      if (!byCheck.has(r.check)) byCheck.set(r.check, new Map());
      const byWidth = byCheck.get(r.check);
      const tally = byWidth.get(r.viewport) ?? { pass: 0, fail: 0, pending: 0 };
      tally[r.status] += 1;
      byWidth.set(r.viewport, tally);
    }
    for (const [check, byWidth] of byCheck) {
      const parts = [...byWidth.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([w, t]) => `@${w}: ${t.pass}/${t.pass + t.fail + t.pending} pass`)
        .join(', ');
      console.log(`  ${check} — ${parts}`);
    }
    console.log('');
  }

  if (pending.length) {
    console.log('PENDING (known flaky during layout rework — not failing the build):');
    for (const r of pending) {
      console.log(`  [pending] ${r.page} @${r.viewport} sidebar=${r.sidebar} ${r.check}: ${r.message}`);
    }
    console.log('');
  }

  if (fails.length) {
    console.log('FAILURES:');
    for (const r of fails) {
      console.log(`  [FAIL] ${r.page} @${r.viewport} sidebar=${r.sidebar} ${r.check}: ${r.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log('All non-pending layout invariants hold.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
