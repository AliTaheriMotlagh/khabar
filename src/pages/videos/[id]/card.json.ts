// An episode's teaser (src/scripts/video.ts, PLAN.md P1-C): the video's Persian headline, three points (the model's,
// pipeline/videos.py --summarize; else Gholam's first paragraphs) over its thumbnail, and «تماشا در یوتیوب». Shaped like a
// story's card.json; the cloud voice reads its lines from here (server/tts.js ?vid=&i=).
import type { APIRoute } from 'astro';
import { faNum, picture } from '../../../lib/posts';
import { lexFor } from '../../../lib/knowledge';
import { getVideos, type Video } from '../../../lib/videos';

/** What the teaser says: the model's points, else Gholam's first paragraphs, else — an episode nobody has summarized
 *  yet — what is known for sure: which episode, how long, its chapters' names and its own title. Every video has one. */
function points(v: Video): string[] {
  // The model's teaser script (v2): a hook, then three short points.
  if (v.ai?.teaser?.hook && v.ai.teaser.points.length) return [v.ai.teaser.hook, ...v.ai.teaser.points.slice(0, 3)];
  if (v.ai?.points?.length) return v.ai.points.slice(0, 3);
  const gholam = (v.story?.article.body ?? []).filter((p) => p.length < 260).slice(0, 2);
  if (gholam.length) return gholam;
  const mins = v.duration ? Math.max(1, Math.round(v.duration / 60)) : 0;
  const what = v.live ? 'لایوِ' : 'ویدیوی';
  const intro = `${v.label ? `${v.label}، ` : ''}${what} ${mins ? `${faNum(mins)} دقیقه‌ای ` : ''}کانال یوتیوب مهرزاد صمدی درباره‌ی هوش مصنوعی.`;
  const chapters = (v.ai?.chapters ?? v.chapters ?? []).map((c) => c.title).filter(Boolean).slice(0, 5);
  return [intro, chapters.length ? `در این قسمت: ${chapters.join('، ')}.` : `عنوان این قسمت: ${v.name}.`];
}
export function getStaticPaths() {
  return getVideos().map((v) => ({ params: { id: v.id }, props: { v } }));
}
export const GET: APIRoute = ({ props }) => {
  const v = props.v as Video;
  const body = points(v);
  const why = `${v.ai?.teaser?.why ? `${v.ai.teaser.why} ` : ''}ویدیوی کامل را در کانال یوتیوب مهرزاد صمدی ببینید.`;
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
