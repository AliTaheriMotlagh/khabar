// An episode's teaser (src/scripts/video.ts, PLAN.md P1-C): the video's Persian headline, three points (the model's,
// pipeline/videos.py --summarize; else Gholam's first paragraphs) over its thumbnail, and «تماشا در یوتیوب». Shaped like a
// story's card.json; the cloud voice reads its lines from here (server/tts.js ?vid=&i=).
import type { APIRoute } from 'astro';
import { picture } from '../../../lib/posts';
import { lexFor } from '../../../lib/knowledge';
import { getVideos, type Video } from '../../../lib/videos';

const points = (v: Video) => (v.ai?.points?.length ? v.ai.points.slice(0, 3) : (v.story?.article.body ?? []).filter((p) => p.length < 260).slice(0, 2));
export function getStaticPaths() {
  return getVideos()
    .filter((v) => points(v).length > 0)
    .map((v) => ({ params: { id: v.id }, props: { v } }));
}
export const GET: APIRoute = ({ props }) => {
  const v = props.v as Video;
  const body = points(v);
  const why = 'ویدیوی کامل را در کانال یوتیوب مهرزاد صمدی ببینید.';
  const thumb = picture(v.thumb, 'large');
  const pics = [[thumb.src, ...(thumb.alt?.split(' ') ?? [])]];
  const card = {
    id: v.post ?? 0,
    vid: v.id,
    kind: 'teaser',
    title: v.headline,
    href: v.href,
    date: v.date ? `${v.date}T12:00:00Z` : new Date().toISOString(),
    tag: v.label || 'ویدیوی مهرزاد',
    body,
    why,
    whyLabel: 'تماشا در یوتیوب',
    link: v.youtube.replace(/^https:\/\/(www\.)?/, ''),
    source: 'youtube.com/@mehrzad.samadi',
    lex: lexFor([v.headline, ...body]),
    share: `${v.label ? `${v.label}: ` : ''}${v.headline}\n#هوش_مصنوعی #مهرزاد_صمدی`,
    video: {
      title: true,
      chapters: [...body.map((_, k) => ({ head: null, say: [k + 1], pics })), { head: 'تماشا در یوتیوب', say: [body.length + 1], pics }],
    },
  };
  return new Response(JSON.stringify(card), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
