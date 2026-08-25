import { createClerkClient } from '@clerk/backend';
import { getDb } from '../../db/client';
import {
  createClerkCalendarTokenBroker,
  createGoogleCalendarProvider,
  createMicrosoftCalendarProvider,
} from '../calendar/providers';
import { processCalendarOutbox } from './calendarOutboxProcessor';

export function createCalendarScheduledHandler() {
  return (_controller: ScheduledController, env: Cloudflare.Env, context: ExecutionContext): void => {
    const providers = {
      google: createGoogleCalendarProvider({ fetch: globalThis.fetch }),
      microsoft: createMicrosoftCalendarProvider({ fetch: globalThis.fetch }),
    };
    const tokenBroker = createClerkCalendarTokenBroker(
      createClerkClient({ secretKey: env.CLERK_SECRET_KEY }),
    );
    const db = getDb(env.DB);
    context.waitUntil(processCalendarOutbox(db, { providers, tokenBroker }, { limit: 100 }));
  };
}
