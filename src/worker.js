// BandMate IELTS — Cloudflare Worker entrypoint.
// Routes /ws and /api/* to the global BandMateHub Durable Object;
// everything else is served from static assets (public/).
export { BandMateHub } from './hub.js';

const HUB_NAME = 'bandmate-global';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws' || url.pathname.startsWith('/api/')) {
      const id = env.HUB.idFromName(HUB_NAME);
      const stub = env.HUB.get(id);
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
