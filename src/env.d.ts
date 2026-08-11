/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type User = typeof import('./db/schema').users.$inferSelect;

declare namespace App {
  interface Locals {
    user: User | null;
  }
}

declare module 'cloudflare:workers' {
  interface Env {
    DB: D1Database;
    UPLOADS: R2Bucket;
    OPENROUTER_MODEL: string;
    OPENROUTER_API_KEY: string;
  }
  export const env: Env;
}
