// Cloudflare Pages Functions: the same API as Vercel's api/router.js (server/<route>.js, Request → Response).
// Wrangler's env vars and secrets reach the server code through process.env (nodejs_compat, compatibility_date
// ≥ 2025-04-01 populates it). Files starting with `_` in functions/ are not routes.
import { GET } from '../api/router.js';

export const onRequest = ({ request }) => GET(request);
