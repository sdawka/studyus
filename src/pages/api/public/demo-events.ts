import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { count, eq } from 'drizzle-orm';
import { getDb } from '../../../db/client';
import { demoFunnelEvents } from '../../../db/schema';
import { apiOk } from '../../../lib/api';
import { withServiceErrors } from '../../../lib/apiErrors';
import { demoFunnelBatchSchema } from '../../../lib/schemas/onboarding';

export const POST: APIRoute = async ({ request }) =>
  withServiceErrors(async () => {
    const body = demoFunnelBatchSchema.parse(await request.json().catch(() => ({})));
    const now = Date.now();
    const recent = body.events
      .filter((event) => Math.abs(now - event.occurred_at) <= 7 * 24 * 60 * 60 * 1000)
      .map((event) => ({
        id: event.event_id,
        sessionId: event.session_id,
        name: event.name,
        step: event.step,
        scenarioId: event.scenario_id,
        occurredAt: event.occurred_at,
        createdAt: now,
      }));
    const db = getDb(env.DB);
    const sessions = [...new Set(recent.map((event) => event.sessionId))];
    const existingCounts = new Map(
      await Promise.all(
        sessions.map(async (sessionId) => {
          const [row] = await db.select({ total: count() }).from(demoFunnelEvents).where(eq(demoFunnelEvents.sessionId, sessionId));
          return [sessionId, row?.total ?? 0] as const;
        }),
      ),
    );
    const rows = recent.filter((event) => {
      const used = existingCounts.get(event.sessionId) ?? 0;
      if (used >= 100) return false;
      existingCounts.set(event.sessionId, used + 1);
      return true;
    });
    if (rows.length) await db.insert(demoFunnelEvents).values(rows).onConflictDoNothing();
    return apiOk({ accepted: rows.length });
  });
