// /rss/top.xml: the week's most viewed (server/toprss.js), as vercel.json's rewrite does; cached like the API.
import { routes } from '../../api/router.js';
import { cached } from '../_router.js';

export const onRequest = (ctx) => cached(ctx.request, (r) => routes.toprss.GET(r), (p) => ctx.waitUntil(p));
