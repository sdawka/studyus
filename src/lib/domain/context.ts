// Shared dependency contract for domain modules.  It deliberately contains no
// HTTP, Durable Object, or UI types, so the same engines can run from an API
// route, a Durable Object, or a future channel adapter.
import type { Db } from '../../db/client';

export type DomainContext = {
  db: Db;
  userId: string;
  now?: number;
  channel?: string;
};

export function at(ctx: DomainContext): number {
  return ctx.now ?? Date.now();
}
