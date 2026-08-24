import { handle } from '@astrojs/cloudflare/handler';
import { LearnerAgent } from './lib/runtime/learnerAgent';

export { LearnerAgent };

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
