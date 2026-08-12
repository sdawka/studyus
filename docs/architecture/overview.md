# studyus Architecture Overview

## Stack (Pinned 2026-08-11)

- **Frontend**: Astro 7.2 + Svelte 5.56 islands (`@astrojs/svelte` 9), `output: 'server'` SSR.
- **Hosting & Database**: Cloudflare Workers (via `@astrojs/cloudflare` 14.2) + D1 SQLite + Drizzle ORM 0.45.2.
- **Storage**: Cloudflare R2 (file uploads).
- **AI**: OpenRouter API (LLM proxy for tutor, via SSE).
- **Auth**: Hand-rolled sessions (SHA-256 token hash, HttpOnly cookie, 30-day sliding expiry, PBKDF2 password hashing now, argon2-WASM post-v1).
- **Validation**: Zod 4 (top-level `z.email()`, `z.strictObject()`).
- **Testing**: Vitest 4.1 + `@cloudflare/vitest-pool-workers` 0.21 (real bindings, per-file isolation).

## Key Principles

### Headless, Tool-Shaped Services
Every capability is a **pure function** over `(db, userId, input)` with Zod-validated input, implemented in `src/lib/services/` — one file per domain: `courses.ts`, `kcs.ts`, `events.ts`, `mastery.ts` (pure fold, no db writes), `assessments.ts`, `grades.ts`, `calendar.ts`, `notes.ts`, `tasks.ts`, `resources.ts`, `sessions.ts`, `attachments.ts`, `profile.ts`, `user.ts`, plus shared ownership/error helpers in `util.ts`.
- Callable from HTTP routes today; from Flue tools or MCP later, with no route-handler logic to duplicate.
- Route handlers under `src/pages/api/v1/**` only: parse the request (Zod), call one service function, wrap the result in `apiOk(toApi(result))` (or `apiError`/`withServiceErrors` on failure). See `docs/api.md` for the full endpoint list and the "Notes for M2+ agents" section for the calling convention from `.astro` pages vs. islands.
- Ownership is enforced *inside* services (`requireOwnedCourse`/`requireOwnedKc` in `util.ts`) — a route never queries a table directly.
- This shapes the code for the **agentic future**: Flue agents will wrap these same services as tools, unchanged.

### Event-Sourced Mastery
Mastery is **never stored directly** — it's computed on-demand from an append-only (but editable) event log:
- Events carry dual-role flags (`is_instructional`, `is_assessment`) not a category enum.
- Editable manual events, delete-only system-generated events (with confirmation).
- Every event write triggers a mastery re-fold for affected KCs.
- **The fold is pure**: given a list of events, compute the score deterministically (recency-weighted first-attempt AE success + exposure prior from IE).
- `assessment_kcs.qmatrix_version` allows KC-to-assessment mappings to evolve without rewriting history.

### Webapp + Frozen API
- **HTTP API** (`/api/v1`) is the single source of truth for client contracts.
- Astro pages call services directly server-side (no self-calls).
- The same API surfaces for native clients (iPad app later).
- API contract is frozen at end of M1; iPad and web apps build against the same specification.

### Design Tokens — 3 Themes × 2 Schemes
The whole app shares one token vocabulary, split across three files under `src/styles/`:
- **`tokens.css`** — theme-agnostic derivations only: `--course`/`--course-ink`/`--course-soft` computed from a per-element `--course-h` (0-360, set inline from `courses.color`) plus theme-owned `--course-l/-c` knobs, so the same hue reads correctly in every theme × scheme combination.
- **`base.css`** — reset + primitives that read tokens only, never define colors: `.card`, `.btn`/`.btn-primary`/`.btn-secondary`, `.pill`/`.pill-ok`/`.pill-warn`/`.pill-danger`, `.chip`, `.bar`, `.kicker`, `.empty`, `.aside-muted`.
- **`themes/{compass,focus,campus}.css`** — the actual OKLCH color/radius/font *values*, one file per theme. Each defines a light block, an `@media (prefers-color-scheme: dark) [data-theme=X]:not([data-scheme=light])` block, and an explicit `[data-scheme=dark]` block — the same token names resolve differently per theme × scheme, never duplicated as separate class names.

Token contract (present in every theme file): `--bg --surface --surface-2 --text --muted --faint --border --hairline --hover`; `--accent --accent-ink --accent-soft`; status triples `--good/-ink/-soft --warn/-ink/-soft --danger/-ink/-soft`; sidebar group `--sidebar-bg/-text/-muted/-border/-active-bg/-active-text` (lets focus keep its pinned-dark rail regardless of scheme); structure `--radius-lg/md/sm --font-display/body/mono --font-size-base --shadow-card --shadow-pop`.

`<html data-theme>` (absent = compass) + `data-scheme` (absent = system) select the active theme/scheme; `ThemeScript.astro` stamps both pre-paint from `localStorage` (`sb:theme`/`sb:scheme`), mirrored server-side from `users.settings` on the next full load. Three themes: **compass** (default, cool neutral), **focus** (pinned-dark sidebar, higher-contrast accent), **campus** (warm paper tones). A prior "notebook" theme and its `--panel`/`--ink`/`--paper`/`--rule`/`--serif`-family legacy variable names (plus `.sheet`/`.margin-note`/`.status-good`/`.status-warn` compatibility classes) were retired in P3 — every consumer was converted onto the token vocabulary above (`.card` for card-ish blocks, `.aside-muted` for the old margin-note aside styling), and `notebook.css` was deleted. `rg` for any of those retired names/classes now returns nothing under `src/`.

## Repo Structure

```
astro.config.mjs                          # Astro + Svelte islands config
wrangler.jsonc                            # Bindings: D1 (DB), R2 (UPLOADS), vars
drizzle.config.ts                         # Migration + schema config
.dev.vars.example                         # Template for local secrets

courses/                                  # Seed data + old prototype (frozen)
  courses.json
  [course-readmes]
  [old prototype files]

migrations/                               # D1 migration SQL files
scripts/
  seed.ts                                 # Idempotent course+KC seed

src/
  middleware.ts                           # Session → locals.user, gates pages + /api/v1
  db/
    schema.ts                             # Drizzle schema (all tables)
    client.ts                             # `db` singleton, db.batch pattern
  lib/
    auth/                                 # Token generation, session mgmt, PBKDF2
    schemas/                              # Zod validators (users, courses, events, etc.)
    services/                             # Pure service functions
      courses.ts
      events.ts (and mastery fold logic)
      mastery.ts (KC score computation)
      grades.ts
      calendar.ts
      notes.ts
      tasks.ts
      resources.ts
      sessions.ts (cookie mgmt)
      profile.ts
      tutor/
        openrouter.ts
        prompts.ts
        modelSpec.ts
    flows/                                # Agentic flows
      quick_quiz.ts                       # Pattern flow: pick KCs, generate, grade, append
    api.ts                                # Request/response envelope helpers
  layouts/
    AppShell.astro                        # Two-group sidebar, nav, footer
  components/                             # By feature (admin/, learning/, shared/)
    admin/
      CalendarView.svelte
      GradeTable.svelte
      ...
    learning/
      ScaffoldChat.svelte
      InteractiveModel.svelte
      ...
    shared/
      RecordEventModal.svelte
      ...
  pages/
    /login.astro
    /index.astro
    /onboarding.astro
    /dashboard.astro
    /calendar.astro
    /grades.astro
    /feed.astro
    /courses/index.astro
    /courses/[slug].astro
    /courses/[slug]/kc/[kcId].astro
    /study.astro
    /tutor/[kcId].astro
    /notes/index.astro
    /notes/[id].astro
    /tasks.astro
    /profile.astro
    api/v1/
      auth/
        login.ts
        logout.ts
      user.ts
      courses/
        index.ts
        [id].ts
        [id]/assessments.ts
        [id]/attachments.ts
      kcs/
        [id].ts
        [id]/events.ts
      events/
        index.ts
        [id].ts
      calendar.ts
      grades/
        summary.ts
      tasks/
        index.ts
        [id].ts
      notes/
        index.ts
        [id].ts
      resources/
        index.ts
        [id].ts
      sessions/
        index.ts
        [id]/complete.ts
      tutor/
        conversations/
          index.ts
          [id].ts
          [id]/messages.ts
      flows/
        quick_quiz/
          index.ts
          [id]/answers.ts

tests/
  unit/
    mastery.test.ts (fold determinism, learning curves)
    grades.test.ts (weighted standing, grade math)
    auth.test.ts (token/session lifecycle)
  integration/
    seed.test.ts (idempotency)
    api.test.ts (key endpoints with D1/R2 bindings)

docs/
  README.md (this map)
  product/
    vision.md
    user-journeys.md
    screens.md
  architecture/
    overview.md (this file)
    data-model.md
    events-and-mastery.md (KLI distillation)
    tutor.md
    cloudflare.md
    agentic-channels.md
  api.md (FROZEN v1, M1)
  decisions/
    ADR-001-astro-ssr-on-cloudflare.md
    ADR-002-svelte.md
    ADR-003-d1-drizzle.md
    ADR-004-event-sourced-mastery.md
    ADR-005-hand-rolled-sessions.md
    ADR-006-r2-uploads.md
  todo.md
```

## Local Development

```bash
# Setup
npm install
cp .dev.vars.example .dev.vars          # Add OPENROUTER_KEY
wrangler d1 migrations apply studyus --local
npm run seed                            # Idempotent: courses.json → D1

# Dev server
npm run dev                             # Astro on workerd, hot-reload

# Tests
npm run test                            # Vitest with pool-workers
npm run test:watch

# Deploy
wrangler deploy                         # Push to Cloudflare
```

## TODO

- Repository initialization checklist (TypeScript setup, ESLint, Prettier, git hooks).
- Detailed dev environment setup guide (Node version, wrangler config, local D1).
- CI/CD pipeline definition (GitHub Actions for test, lint, deploy).
- Performance budgets and monitoring strategy.
