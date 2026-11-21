// /rss/top.xml: the week's most viewed (server/toprss.js), as vercel.json's rewrite does.
import { routes } from '../../api/router.js';

export const onRequest = ({ request }) => routes.toprss.GET(request);
