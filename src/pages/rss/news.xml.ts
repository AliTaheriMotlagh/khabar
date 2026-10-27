import { FEEDS, feedResponse } from '../../lib/feed';

export const GET = () => feedResponse(FEEDS.news);
