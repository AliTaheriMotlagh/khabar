import type { APIContext } from 'astro';
import { enFeedResponse, enTopicFeed } from '../../../../lib/en-feed';
import { enTopics } from '../../../../lib/en';

export const getStaticPaths = () => enTopics().map((t) => ({ params: { slug: t.slug }, props: { t } }));
export const GET = ({ props }: APIContext) => enFeedResponse(enTopicFeed((props as { t: { en: string; slug: string } }).t));
