/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />
/// <reference path="../worker-configuration.d.ts" />

type User = typeof import('./db/schema').users.$inferSelect;

declare namespace App {
  interface Locals {
    user: User | null;
  }
}

// D1Database, R2Bucket, and the `Cloudflare.Env`/`Env` globals used by
// `import { env } from 'cloudflare:workers'` come from worker-configuration.d.ts
// (regenerate with `npx wrangler types` after changing wrangler.jsonc bindings).
// Optional secrets (`wrangler secret put` / .dev.vars) are not `vars` entries,
// so Wrangler's generator does not know about them. Their consumers must pass
// the relevant capability/config gate before reading them.
declare namespace Cloudflare {
  interface Env {
    OPENROUTER_API_KEY?: string;
    POSTHOG_PROJECT_TOKEN?: string;
    ANALYTICS_EXCLUDED_USER_IDS?: string;
    CLERK_SECRET_KEY: string;
  }
}
