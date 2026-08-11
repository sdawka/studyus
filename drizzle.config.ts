import { defineConfig } from 'drizzle-kit';

// We only use drizzle-kit for `generate` (schema -> SQL migrations).
// Migrations are applied via `wrangler d1 migrations apply`, not drizzle-kit,
// so no D1 driver credentials are needed here.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
