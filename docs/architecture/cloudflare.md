# Cloudflare Adapter v14 Reality

This document captures the Cloudflare Workers-specific details and gotchas from @astrojs/cloudflare 14.2, verified against wrangler 4.x and workerd.

## Deployment Target: Workers, Not Pages

**Not Pages.** The older Astro Cloudflare tutorial (Pages with static generation) doesn't apply.

- **Target**: Cloudflare **Workers** with full Node.js-like runtime (via workerd, a V8 isolate).
- **SSR mode**: `output: 'server'` in `astro.config.mjs`.
- **Dev server**: `npm run dev` runs Astro on a real workerd instance (via wrangler 4), not a Node.js process.
- **Bindings**: D1, R2, KV, Durable Objects are injected via `wrangler.jsonc`, not Astro's platform/locals.
- **Canonical origin**: `https://studyus.app`. Requests to the raw
  `studyus.dawka.workers.dev` deployment hostname redirect there before Clerk
  initializes, because the production Clerk Frontend API only accepts the
  configured application origin.

## Configuration

### astro.config.mjs

```javascript
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  integrations: [svelte(), cloudflare()],
  output: 'server',
  adapter: cloudflare({
    // no platformProxy option in v14 — it's gone
  }),
});
```

### wrangler.jsonc

All bindings, database config, and environment variables go here. This is the **real, current file** (`wrangler.jsonc` at the repo root) — a prior draft of this doc showed a fictional shape (a `main`/`type: "service"` block, `env.production`/`env.staging` route blocks, and an `env_secrets` section) that never matched what's actually checked in:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "studyus",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "studyus",
      "database_id": "local-placeholder",
      "migrations_dir": "migrations"
    }
  ],
  "r2_buckets": [
    {
      "binding": "UPLOADS",
      "bucket_name": "studyus-uploads"
    }
  ],
  "vars": {
    "OPENROUTER_MODEL": "openrouter/auto",
    "AI_FEATURES_ENABLED": "true"
  },
  "observability": {
    "traces": {
      "enabled": true
    }
  }
}
```

The checked-in config also has an `env.staging` block with isolated D1, R2,
Durable Object, route, and vars. Production uses the top-level bindings;
staging deploys with `--env staging`. Secrets are never declared through a
fictional `env_secrets` key: each environment receives them through Wrangler's
secret commands.

**Secrets and gate**: Store API keys via `wrangler secret put OPENROUTER_API_KEY` (add `--env staging` for an isolated staging secret). Reference it only server-side via `env.OPENROUTER_API_KEY`. `AI_FEATURES_ENABLED` is the non-secret deployment policy switch. The application enables AI only when the switch is exactly `true` and the secret is non-blank; it exposes the resulting safe status at `GET /api/v1/capabilities`, never the credential.

## Accessing Bindings in Code

### No platformProxy / locals.runtime

Old Astro + Cloudflare code used:
```javascript
const db = Astro.locals.runtime.env.DB; // ❌ WRONG in v14
```

This no longer works. Instead:

### Use native Cloudflare Workers import

```javascript
import { env } from 'cloudflare:workers';

// In a server route or middleware:
const db = env.DB;
const uploadsBucket = env.UPLOADS;
const apiKey = env.OPENROUTER_API_KEY;
```

Or, if you're in a context where `env` is not available (older Astro APIs), use the context object:

```javascript
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ locals, request }) => {
  const env = locals.runtime.env; // ✅ Use Astro's runtime context

  // or in middleware:
  // const env = Astro.locals.runtime.env;
};
```

**Pattern**: For new code, use `import { env } from 'cloudflare:workers'` directly. For Astro pages that need `locals`, Astro automatically populates `Astro.locals.runtime.env` before route handlers run, so you can use either pattern.

### ExecutionContext

If you need the Worker's `ExecutionContext` (for `waitUntil` to extend execution), access it via:

```javascript
import type { APIRoute } from 'astro';

export const POST: APIRoute = async (context) => {
  const cfContext = context.locals.cfContext; // ExecutionContext
  cfContext.waitUntil(expensivePromise); // Keep Worker alive during cleanup
};
```

## Local Development: workerd + .wrangler/state

### Dev Server

```bash
npm run dev
```

This starts Astro on a real workerd instance. Under the hood:
- Astro invokes wrangler's dev mode.
- workerd runs the Cloudflare Worker runtime locally.
- D1 uses a real local SQLite database stored in `.wrangler/state/d1/`.
- R2 is emulated in `.wrangler/state/r2/`.

**Important**: Don't run `wrangler dev` separately. Astro's `npm run dev` orchestrates it.

### D1 Migrations

Migrations are SQL files in `migrations/`. Apply them locally:

```bash
# Apply all pending migrations to local D1
wrangler d1 migrations apply studyus --local

# Apply to remote D1 (production)
wrangler d1 migrations apply studyus --remote
```

Migrations are tracked in the `_cf_migrations` table and are idempotent (Drizzle generates safe migrations).

**Current migration workflow**: the repository now carries a `0000` baseline plus additive numbered migrations. Generate and review an incremental migration; do not delete the existing history. ADR-003 records the older single-baseline workflow as historical context.

### Environment Variables

Create a `.dev.vars` file in the root:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

These are loaded by wrangler during dev and are *not* committed. Use `.dev.vars.example` as a template.

### Batch Atomicity

D1 supports `db.batch()` for atomic multi-statement writes:

```typescript
const results = await env.DB.batch([
  db.insert(events).values({ ... }),
  db.update(kcs).set({ mastery: 75 }).where(...),
  db.delete(sessions).where(...),
]);
// All three execute atomically; if any fails, all roll back.
```

Use this for event writes + mastery recompute, and for assessment grade entry + linked KC events.

## Vitest + @cloudflare/vitest-pool-workers

Unit and integration tests use the real Cloudflare bindings:

```bash
npm run test
```

Uses vitest 4.1 + `@cloudflare/vitest-pool-workers` 0.21 to spin up real D1 and R2 instances per test file (in-memory by default, or persistent in `.wrangler/state`).

## Deployment

```bash
wrangler deploy
```

- Builds the Astro project.
- Uploads dist/server/entry.mjs to Cloudflare.
- Migrates D1 if needed.
- Routes production traffic.

## Common Gotchas

### ❌ "Cannot find module 'cloudflare:workers'"
Make sure `@cloudflare/workers-types` v5 is installed (not v4). Check `package.json`:
```json
"@cloudflare/workers-types": "^5.0.0"
```

### ❌ "DB is undefined"
You're trying to access `env.DB` outside of a Worker context (e.g., in a build script). Build-time code runs in Node.js, not a Worker. Seed scripts should use a separate DB connection or run *after* deployment.

### ❌ "StreamResponse not serializable"
If you pipe a ReadableStream into a Response, make sure you're in a Worker context (not a Node.js build). SSE endpoints must run on Workers, not Node.

### ✅ How to test D1 locally
The `.wrangler/state/v3/d1/` directory contains local SQLite databases (nested under a `miniflare-D1DatabaseObject/` subfolder — the path above was written against an older wrangler layout). You can inspect them with `sqlite3`:
```bash
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite
sqlite> SELECT * FROM events;
```

## TODO

- Durable Objects integration for agentic flows (post-v1).
- KV caching strategy (e.g., for expensive mastery queries).
- Analytics Engine for event tracing.
- Scheduled jobs / cron triggers (e.g., nightly mastery recompute, digest emails).
