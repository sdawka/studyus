// annotations-check.cjs — drift guard between docs/product/screens.md and
// src/lib/docs-overlay/annotations.ts (the docs annotation overlay's
// machine-readable registry — see docs/product/annotations.md).
//
// Same assert-collect-and-exit-non-zero style as scripts/layout-check.cjs,
// split into two halves:
//
//   STATIC half (always runs, no browser, no dev server required): parses
//   screens.md's route table as Markdown, parses annotations.ts as PLAIN
//   TEXT (it's TypeScript — this script does not compile or require() it;
//   see parseAnnotationsFile below for why and how), and cross-checks:
//     1. every in-scope route (CONFIG.inScopeRoutes) has a RouteAnnotation
//     2. every component in that route's screens.md Key Components column
//        has a matching Annotation (or is on CONFIG.KNOWN_UNANNOTATED)
//     3. no annotations.ts route is absent from screens.md's table
//   plus a lenient bonus check that every SHELL_ANNOTATIONS name is at
//   least mentioned somewhere in screens.md (see the comment at its call
//   site for why this one is deliberately loose).
//
//   LIVE half (Playwright): visits each annotated route and asserts every
//   `selector` resolves to >=1 DOM node. Skips cleanly — not a failure —
//   if Playwright isn't requirable under the current Node or the dev
//   server isn't reachable, so this script is still useful in a plain
//   `npm run check:annotations` / CI context with no server up.
//
// Usage:
//   npm run check:annotations
//   node scripts/annotations-check.cjs [baseUrl]
//
// The live half uses the local Playwright dependency and Clerk development
// credentials from .env.e2e.local (see .env.e2e.example). With no reachable
// dev server it still skips cleanly after completing all static checks.
//
// Env vars: ANNOTATIONS_CHECK_COURSE (course slug for the /courses/[slug] live
// check), ANNOTATIONS_CHECK_KC (KC id for the /learn/[kcId] live check).

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// CONFIG — re-baseline here.
// ---------------------------------------------------------------------------
const CONFIG = {
  baseUrl: process.argv[2] || process.env.ANNOTATIONS_CHECK_BASE_URL || 'http://localhost:4321',
  // Same seeded course/KC layout-check.cjs uses for its dynamic routes —
  // keep these two in sync if either script's default ever drifts.
  course: process.env.ANNOTATIONS_CHECK_COURSE || 'chee-314-fluid-mechanics',
  kcId: process.env.ANNOTATIONS_CHECK_KC || 'cfe52a8d-1867-c4db-cfe5-2a8d1867c4db',

  screensPath: path.join(__dirname, '../docs/product/screens.md'),
  annotationsPath: path.join(__dirname, '../src/lib/docs-overlay/annotations.ts'),

  // Routes the overlay covers this wave (docs/product/annotations.md "In-scope
  // routes (deliberately partial)"). A screens.md route NOT in this list is
  // allowed zero RouteAnnotation coverage without failing the static check —
  // extend this array (and the doc's prose list) together when a route
  // earns coverage.
  inScopeRoutes: ['/dashboard', '/planner', '/tasks', '/courses/[slug]', '/learn/[kcId]', '/settings'],

  // Dynamic-segment substitutions for the live half, keyed by the route
  // pattern exactly as written in screens.md / annotations.ts.
  routeParams: {
    '/courses/[slug]': (cfg) => `/courses/${cfg.course}`,
    '/learn/[kcId]': (cfg) => `/learn/${cfg.kcId}`,
  },

  // Components screens.md lists in an in-scope route's Key Components
  // column that annotations.ts deliberately doesn't cover yet. Add an entry
  // here instead of leaving the check red or rushing a thin Annotation —
  // same convention as layout-check.cjs's pendingRebaseline. Component names
  // are compared with a trailing `*` (Svelte-island marker) stripped from
  // both sides, so list them without it.
  KNOWN_UNANNOTATED: [
    {
      route: '/courses/[slug]',
      component: 'CourseHome',
      reason: "container for the ten individually-annotated .slot-* cards — badging it would outline the whole page and add no information.",
    },
  ],

  // Live-half selectors that are correctly ABSENT from the page at rest —
  // not a coverage gap, a staged-UI fact. Separate from KNOWN_UNANNOTATED
  // (that allowlist is about screens.md/annotations.ts coverage; this one is
  // about the live DOM). Never counted as pass or fail; always printed as
  // its own "expected-unresolved" line every run, so a selector that starts
  // resolving (the stage's mount condition changed) or a genuinely-broken
  // selector hiding behind this allowlist both stay visible instead of
  // silently disappearing.
  EXPECTED_UNRESOLVED: [
    {
      route: '/learn/[kcId]',
      component: 'VerifyQuiz',
      reason:
        'Stage 2 of the absorb flow — mounts only after "Verify N weak prerequisites" is clicked, so it has no matching node at rest.',
    },
    {
      route: '/learn/[kcId]',
      component: 'InterestRanker',
      reason: 'Stage 3 of the absorb flow — mounts only once the student advances past Stage 1/2, so it has no matching node at rest.',
    },
    {
      route: '/learn/[kcId]',
      component: 'ScaffoldChat',
      reason: 'Mounts only once AbsorbFlow reaches Stage 4 (the actual teaching conversation) — a plain page load sits on Stage 1 instead.',
    },
    {
      route: '/planner',
      component: 'CalendarGrid',
      reason: 'Mounts only in Month view — the view switcher defaults to Week, so a plain page load never shows it.',
    },
    {
      route: '/planner',
      component: 'AgendaList',
      reason:
        'Mounts only in Agenda view. Desktop SSR defaults to Week (never sees this), even though Agenda is the mobile default per docs/design/mobile-shell.md.',
    },
    {
      route: '/planner',
      component: 'EventPopover',
      reason: 'Opens only on clicking an existing calendar item; on mobile it renders as `.event-popover-body` inside a Sheet instead.',
    },
    {
      route: '/planner',
      component: 'CreateSessionPopover',
      reason: 'Opens only on clicking an empty grid slot; on mobile it renders as `.create-popover-body` inside a Sheet instead.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function normalizeName(s) {
  return s.trim().replace(/\*$/, '');
}

// Parses screens.md's "| Route | Purpose | Key Components |" table into
// Map<route, Set<component>> (trailing `*` stripped). Real Markdown table,
// not fixtures — a route cell occasionally holds more than one route
// (`` `/study`, `/study/quiz` ``), so every backtick span in the Route
// column is registered, not just the first.
function parseScreensTable(md) {
  const routes = new Map();
  let inTable = false;
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trim();
    if (/^\|\s*Route\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^\|\s*-{2,}/.test(line)) continue; // header separator row
    if (!line.startsWith('|')) {
      inTable = false; // table ended
      continue;
    }
    const cells = line.split('|').slice(1, -1); // drop the empty strings outside the outer pipes
    if (cells.length < 3) continue;
    const routeMatches = [...cells[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (routeMatches.length === 0) continue; // no code-span route in this cell — not a real route row
    const componentsCell = cells[2].trim();
    const comps =
      componentsCell === '—' || componentsCell === '-' || componentsCell === ''
        ? []
        : componentsCell.split(',').map(normalizeName).filter(Boolean);
    for (const route of routeMatches) {
      const set = routes.get(route) ?? new Set();
      for (const c of comps) set.add(c);
      routes.set(route, set);
    }
  }
  return routes;
}

// Pairs each `name:` string literal in a block with the `selector:` literal
// that immediately follows it. Relies on the Annotation interface's field
// order (name, selector, ...; src/lib/docs-overlay/types.ts) holding in
// practice — a deliberately naive text scan, not a TS parse. Good enough for
// a drift guard whose job is "did someone forget to update the other file",
// not "is this valid TypeScript" (astro check already covers that, and this
// script must never require() a .ts file).
function extractComponents(block) {
  const re = /name:\s*[`'"]([^`'"]+)[`'"][\s\S]*?selector:\s*[`'"]([^`'"]+)[`'"]/g;
  const out = [];
  let m;
  while ((m = re.exec(block))) {
    out.push({ name: m[1], selector: m[2] });
  }
  return out;
}

// Finds every top-level `const NAME = ...` / `export const NAME = ...`
// declaration and slices out its own block (from its `const` keyword to the
// next top-level declaration, or EOF). Route components are commonly pulled
// into their own named array for readability (e.g. `const
// dashboardComponents: Annotation[] = [...]`, referenced from
// ROUTE_ANNOTATIONS as `components: dashboardComponents`) rather than
// inlined directly in the RouteAnnotation object — this indirection has to
// be resolved before extractComponents has anything to find.
function extractTopLevelDeclarations(text) {
  const re = /(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=/g;
  const matches = [...text.matchAll(re)];
  const blocks = new Map();
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    blocks.set(matches[i][1], text.slice(start, end));
  }
  return blocks;
}

// Returns { routes: Map<route, {components}>, shell: [{name, selector}] },
// or null if the file doesn't (yet) export both arrays under those names —
// e.g. Track C's file exists but is still a stub.
function parseAnnotationsFile(text) {
  const declarations = extractTopLevelDeclarations(text);
  // Resolve ROUTE_ANNOTATIONS/SHELL_ANNOTATIONS through the SAME
  // declaration map used for the named-component-array indirection above,
  // rather than a bare text.indexOf. A bare substring search is fooled by a
  // prose mention like a `feedback` string that says "...see Header in
  // SHELL_ANNOTATIONS" appearing BEFORE the real declaration — that
  // happened in practice and silently scrambled the route/shell split, so
  // anchoring on the actual `const NAME =` syntax is load-bearing, not
  // cosmetic.
  const routeSection = declarations.get('ROUTE_ANNOTATIONS');
  const shellSection = declarations.get('SHELL_ANNOTATIONS');
  if (!routeSection || !shellSection) return null;

  // Split routeSection into one block per `route: '...'` occurrence — each
  // block runs from that match to the next route's match (or EOF).
  const routeMatches = [...routeSection.matchAll(/route:\s*[`'"]([^`'"]+)[`'"]/g)];
  const routes = new Map();
  for (let i = 0; i < routeMatches.length; i++) {
    const route = routeMatches[i][1];
    const start = routeMatches[i].index;
    const end = i + 1 < routeMatches.length ? routeMatches[i + 1].index : routeSection.length;
    const block = routeSection.slice(start, end);
    // components: either a reference to a separately-declared array
    // (`components: someIdentifier` — the convention this file actually
    // uses) resolved via `declarations` above, or inlined directly in the
    // block. Try the reference first; fall back to scanning the block
    // itself so an inline components array (should a route ever use one)
    // still works.
    const ref = block.match(/components:\s*(\w+)/);
    const components = ref && declarations.has(ref[1]) ? extractComponents(declarations.get(ref[1])) : extractComponents(block);
    const existing = routes.get(route);
    if (existing) existing.components.push(...components);
    else routes.set(route, { components });
  }

  const shell = extractComponents(shellSection);
  return { routes, shell };
}

function isKnownUnannotated(route, component) {
  return CONFIG.KNOWN_UNANNOTATED.find((e) => e.route === route && e.component === component);
}

function isExpectedUnresolved(route, component) {
  return CONFIG.EXPECTED_UNRESOLVED.find((e) => e.route === route && e.component === component);
}

// ---------------------------------------------------------------------------
// Static half
// ---------------------------------------------------------------------------

function runStaticHalf() {
  const results = []; // { check, route, component, selector?, ok, message }

  let screensText;
  try {
    screensText = fs.readFileSync(CONFIG.screensPath, 'utf8');
  } catch (err) {
    console.error(`Cannot read ${CONFIG.screensPath}: ${err.message}`);
    process.exit(1);
  }
  const screensRoutes = parseScreensTable(screensText);

  let annotationsText;
  try {
    annotationsText = fs.readFileSync(CONFIG.annotationsPath, 'utf8');
  } catch {
    results.push({
      check: 'registry-exists',
      route: '-',
      component: '-',
      ok: false,
      message:
        `${CONFIG.annotationsPath} not found — the annotation registry hasn't landed yet. ` +
        `Nothing else in the static half can run without it; re-run once it exists.`,
    });
    return { results, parsed: null };
  }

  const parsed = parseAnnotationsFile(annotationsText);
  if (!parsed) {
    results.push({
      check: 'registry-shape',
      route: '-',
      component: '-',
      ok: false,
      message:
        `${CONFIG.annotationsPath} exists but doesn't export both ROUTE_ANNOTATIONS and ` +
        `SHELL_ANNOTATIONS yet (this is a text scan, not a TS compile — see parseAnnotationsFile).`,
    });
    return { results, parsed: null };
  }

  // Assertions 1 + 2: every in-scope route has a RouteAnnotation, and every
  // component screens.md lists for it has a matching Annotation (or is
  // allowlisted).
  for (const route of CONFIG.inScopeRoutes) {
    const entry = parsed.routes.get(route);
    if (!entry) {
      results.push({
        check: 'route-annotated',
        route,
        component: '-',
        ok: false,
        message: `in-scope route ${route} has no RouteAnnotation in annotations.ts`,
      });
      continue;
    }
    const haveNames = new Set(entry.components.map((c) => normalizeName(c.name)));
    const screensComponents = screensRoutes.get(route) ?? new Set();
    for (const comp of screensComponents) {
      if (haveNames.has(comp)) continue;
      const allowlisted = isKnownUnannotated(route, comp);
      if (allowlisted) {
        results.push({
          check: 'component-annotated',
          route,
          component: comp,
          ok: true,
          message: `allowlisted: ${allowlisted.reason}`,
        });
        continue;
      }
      results.push({
        check: 'component-annotated',
        route,
        component: comp,
        ok: false,
        message: `screens.md lists "${comp}" for ${route} but annotations.ts has no matching Annotation (and it's not on KNOWN_UNANNOTATED)`,
      });
    }
  }

  // Assertion 3: no annotations.ts route is absent from screens.md.
  for (const route of parsed.routes.keys()) {
    if (!screensRoutes.has(route)) {
      results.push({
        check: 'route-exists-in-screens',
        route,
        component: '-',
        ok: false,
        message: `annotations.ts has a RouteAnnotation for ${route}, which doesn't appear in screens.md's route table`,
      });
    }
  }

  // Bonus, deliberately lenient: every SHELL_ANNOTATIONS name should be
  // mentioned SOMEWHERE in screens.md — not necessarily in the "## Shell
  // components" bullet list specifically. screens.md names `BottomNav.astro`
  // in its "Mobile" prose section instead of the Shell components list, and
  // never spells out "Header.astro" at all (only the bare word "Header") —
  // both are legitimate per that doc's structure, not drift. A strict
  // "must be in the Shell components bullets" check would false-fail on
  // both, so this does a whole-document substring match on the base name
  // instead: loose enough to tolerate screens.md's inconsistent placement,
  // still tight enough to catch an outright rename or typo.
  for (const { name } of parsed.shell) {
    const baseName = name.replace(/\.(astro|svelte)$/, '');
    const ok = screensText.includes(baseName);
    results.push({
      check: 'shell-mentioned',
      route: '(shell)',
      component: name,
      ok,
      message: ok ? '' : `"${baseName}" doesn't appear anywhere in screens.md — renamed or typo'd?`,
    });
  }

  return { results, parsed };
}

// ---------------------------------------------------------------------------
// Live half
// ---------------------------------------------------------------------------

async function isServerReachable(baseUrl) {
  try {
    await fetch(baseUrl, { method: 'GET', signal: AbortSignal.timeout(2000) });
    return true; // any response at all means something is listening
  } catch {
    return false;
  }
}

async function runLiveHalf(parsed) {
  if (!(await isServerReachable(CONFIG.baseUrl))) {
    return { skipped: true, reason: `${CONFIG.baseUrl} not reachable`, results: [] };
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    return {
      skipped: true,
      reason: `local Playwright dependency unavailable (${err.code || err.message})`,
      results: [],
    };
  }

  const results = [];
  const expectedUnresolved = []; // components on CONFIG.EXPECTED_UNRESOLVED — never pass/fail, always reported
  const { authenticateClerkContext, CLERK_AUTH_STATE_PATH } = await import('./lib/clerk-e2e-auth.mjs');
  const useStoredAuth = process.env.E2E_USE_STORED_AUTH === '1';
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: CONFIG.baseUrl,
    ...(useStoredAuth ? { storageState: CLERK_AUTH_STATE_PATH } : {}),
  });
  const page = await context.newPage();

  try {
    if (!useStoredAuth) await authenticateClerkContext({ context, page, baseUrl: CONFIG.baseUrl });
  } catch (error) {
    await browser.close();
    return { skipped: true, reason: `Clerk authentication failed (${error.message})`, results: [], expectedUnresolved: [] };
  }

  async function checkSelectors(routeLabel, components) {
    for (const { name, selector } of components) {
      const expected = isExpectedUnresolved(routeLabel, name);
      try {
        const count = await page.locator(selector).count();
        if (expected) {
          // Always logged, never counted as pass or fail — see CONFIG.EXPECTED_UNRESOLVED's
          // comment for why a count>0 here (or a hidden real break) must still surface.
          expectedUnresolved.push({ route: routeLabel, component: name, selector, count, reason: expected.reason });
          continue;
        }
        results.push({
          route: routeLabel,
          component: name,
          selector,
          ok: count > 0,
          message: count > 0 ? '' : `selector resolved to 0 nodes`,
        });
      } catch (err) {
        if (expected) {
          expectedUnresolved.push({ route: routeLabel, component: name, selector, count: 0, reason: expected.reason, error: err.message });
          continue;
        }
        results.push({ route: routeLabel, component: name, selector, ok: false, message: err.message });
      }
    }
  }

  // Shell: checked once against the dashboard. BottomNav is rendered
  // unconditionally in AppShell.astro (only CSS-hidden above the mobile
  // breakpoint, never removed from the DOM), so a single desktop-viewport
  // visit is enough to find every shell selector — no separate mobile pass
  // needed here.
  await page.goto(CONFIG.baseUrl + '/dashboard', { waitUntil: 'networkidle' });
  await checkSelectors('(shell)', parsed.shell);

  for (const [route, entry] of parsed.routes) {
    if (!CONFIG.inScopeRoutes.includes(route)) continue; // out-of-scope routes aren't live-checked
    const resolve = CONFIG.routeParams[route];
    const urlPath = resolve ? resolve(CONFIG) : route;
    await page.goto(CONFIG.baseUrl + urlPath, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    await checkSelectors(route, entry.components);
  }

  await browser.close();
  return { skipped: false, results, expectedUnresolved };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { results: staticResults, parsed } = runStaticHalf();

  let liveResults = [];
  let expectedUnresolved = [];
  let liveSkipReason = null;
  if (!parsed) {
    liveSkipReason = "static half couldn't parse annotations.ts (see failure above) — nothing to live-check yet";
  } else {
    const live = await runLiveHalf(parsed);
    if (live.skipped) liveSkipReason = live.reason;
    else {
      liveResults = live.results;
      expectedUnresolved = live.expectedUnresolved;
    }
  }

  const allResults = [...staticResults, ...liveResults];
  const fails = allResults.filter((r) => r.ok === false);
  const passes = allResults.filter((r) => r.ok === true);

  console.log(`annotations-check: ${passes.length} passed, ${fails.length} failed`);
  if (liveSkipReason) console.log(`  (live half skipped: ${liveSkipReason})`);
  console.log('');

  // Neither pass nor fail — printed unconditionally so a selector that
  // starts resolving at rest (the staged UI's mount condition changed) or a
  // genuinely-broken selector hiding on this allowlist both stay visible
  // instead of silently disappearing into a green run. See
  // CONFIG.EXPECTED_UNRESOLVED.
  if (expectedUnresolved.length) {
    console.log(`expected-unresolved (${expectedUnresolved.length}):`);
    for (const e of expectedUnresolved) {
      const errTail = e.error ? ` [threw: ${e.error}]` : '';
      console.log(`  ${e.route} → ${e.component} → ${e.selector}: resolved=${e.count}${errTail} (${e.reason})`);
    }
    console.log('');
  }

  if (fails.length) {
    console.log('FAILURES:');
    for (const f of fails) {
      const tail = f.selector ? ` → ${f.selector}` : '';
      console.log(`  [FAIL] (${f.check ?? 'live-selector'}) ${f.route} → ${f.component}${tail}: ${f.message}`);
    }
    console.log('');
    process.exitCode = 1;
  } else {
    console.log('All annotation/doc invariants hold.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
