// /ads.txt: the ad networks' seller lines, set from /admin/ (server/ads.js), cached like the API.
import { routes } from '../api/router.js';
import { cached } from './_router.js';

export const onRequest = (ctx) => {
  const u = new URL(ctx.request.url);
  return cached(new Request(`${u.origin}/api/ads/?txt=1`), (r) => routes.ads.GET(r), (p) => ctx.waitUntil(p));
};
