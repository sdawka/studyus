import { handle } from '@astrojs/cloudflare/handler';
import { LearnerAgent } from './lib/runtime/learnerAgent';
import { createCalendarScheduledHandler } from './lib/services/calendarScheduled';

export { LearnerAgent };

const scheduled = createCalendarScheduledHandler();

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  scheduled,
} satisfies ExportedHandler<Cloudflare.Env>;
