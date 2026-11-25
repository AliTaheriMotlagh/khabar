// The English edition's feed: every story's English headline and source text, the newest whole (src/lib/en-feed.ts).
import { EN_FEEDS, enFeedResponse } from '../../lib/en-feed';

export const GET = () => enFeedResponse(EN_FEEDS.all);
