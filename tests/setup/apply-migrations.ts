// Runs inside the worker runtime (via the workers vitest pool) before each
// test file: applies migrations/ to the isolated per-file D1 instance so
// every DB-backed test starts from a real, migrated schema.
import { applyD1Migrations, env } from 'cloudflare:test';

const bindings = env as unknown as { DB: D1Database; TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[] };
await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
