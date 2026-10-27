import type { APIContext } from 'astro';
import { feedResponse, tagFeed } from '../../../lib/feed';
import { getTags } from '../../../lib/posts';

export const getStaticPaths = () => getTags().map(({ tag }) => ({ params: { tag } }));
export const GET = ({ params }: APIContext) => feedResponse(tagFeed(params.tag!));
