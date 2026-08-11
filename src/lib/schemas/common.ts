// Shared Zod 4 primitives reused across entity schemas.
import { z } from 'zod';

// Table ids are crypto.randomUUID() (real v4 UUIDs) OR deterministic
// UUID-*shaped* hashes from scripts/seed.ts (deterministicId) — the latter
// are stable across reseeds but don't set RFC4122 version/variant nibbles,
// so `z.uuid()` (which validates those bits) would wrongly reject seeded
// ids. Match the 8-4-4-4-12 hex grouping only.
export const idSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');

// Accept a full ISO datetime string; services convert to epoch ms for storage.
export const isoDatetimeSchema = z.iso.datetime({ offset: true }).or(z.iso.datetime());

export function toEpochMs(iso: string | undefined | null, fallback = Date.now()): number {
  if (!iso) return fallback;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? fallback : ms;
}

export function toIso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  return new Date(ms).toISOString();
}

export const paginationSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
});
