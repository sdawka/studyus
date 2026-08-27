/// <reference types="astro/client" />
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
// OPENROUTER_API_KEY is an optional secret (wrangler secret put / .dev.vars),
// not a `vars` entry, so wrangler's generator doesn't know about it. AI paths
// must go through the capability gate before reading it.
declare namespace Cloudflare {
  interface Env {
    OPENROUTER_API_KEY?: string;
    CLERK_SECRET_KEY: string;
  }
}
