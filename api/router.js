// The site's one Vercel Function: /api/<route>/ runs server/<route>.js (vercel.json rewrites /api/<route>/ to
// /api/router/?route=<route>; `npm run serve` calls this the same way). One function instead of one per route keeps the
// deployment under the Hobby plan's function limit (12 per deployment — a 13th route fails the deploy) and stores one
// bundle per deployment instead of many. Add a route: write server/<name>.js (exports GET/POST/… taking a Request),
// then list it in `routes` below. Files in server/ starting with `_` are helpers, never routes.
import * as admin from '../server/admin.js';
import * as chat from '../server/chat.js';
import * as comments from '../server/comments.js';
import * as engage from '../server/engage.js';
import * as img from '../server/img.js';
import * as leaders from '../server/leaders.js';
import * as live from '../server/live.js';
import * as media from '../server/media.js';
import * as push from '../server/push.js';
import * as react from '../server/react.js';
import * as stats from '../server/stats.js';
import * as sync from '../server/sync.js';
import * as toprss from '../server/toprss.js';
import * as tts from '../server/tts.js';
import * as watch from '../server/watch.js';

export const routes = { admin, chat, comments, engage, img, leaders, live, media, push, react, stats, sync, toprss, tts, watch };
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const known = (name) => (name && Object.hasOwn(routes, name) ? routes[name] : null);
/** The route a request is for: from its path (/api/<route>/), else from the `route` the rewrite adds (the path the
 *  function sees may be the reader's or the rewritten /api/router/ — either works). */
export function routeOf(request) {
  const url = new URL(request.url);
  return known(url.pathname.match(/\/api\/([\w-]+)\/?$/)?.[1]) ?? known(url.searchParams.get('route'));
}

async function handle(request) {
  const route = routeOf(request);
  if (!route) return new Response('not found', { status: 404 });
  const fn = route[request.method];
  if (fn) return fn(request);
  if (request.method === 'HEAD' && route.GET) {
    const res = await route.GET(new Request(request.url, { headers: request.headers }));
    return new Response(null, { status: res.status, headers: res.headers });
  }
  return new Response('method not allowed', { status: 405, headers: { Allow: METHODS.filter((m) => route[m]).join(', ') } });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
