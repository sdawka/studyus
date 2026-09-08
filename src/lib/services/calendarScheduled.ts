import { createClerkClient } from '@clerk/backend';
import { getDb } from '../../db/client';
import {
  createClerkCalendarTokenBroker,
  createGoogleCalendarProvider,
  createMicrosoftCalendarProvider,
} from '../calendar/providers';
import { reconcileAttachments } from './attachments';
import { processAccountDeletionJobs } from './accountLifecycle';
import { processCalendarOutbox } from './calendarOutboxProcessor';
import { processPlanningJobs } from './planning';
import { reconcileGroupFiles } from './groupFiles';
import { pruneDemoFunnel } from './demoFunnel';

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
    context.waitUntil(Promise.all([
      processCalendarOutbox(db, { providers, tokenBroker }, { limit: 100 }),
      processAccountDeletionJobs(db, env),
      reconcileAttachments(db, env.UPLOADS),
      reconcileGroupFiles(db, env.UPLOADS),
      pruneDemoFunnel(db,Date.now()),
      processPlanningJobs(db),
    ]).then(() => undefined));
  };
}
