// Small per-story JSON behind the long-press preview (src/scripts/peek.ts), the cloud voice (api/tts.js) and the
// story's video (src/scripts/video.ts: `video`, by index into the spoken lines).
import type { APIRoute } from 'astro';
import { faNum, getPosts, picture, videoPlan, type Post } from '../../../lib/posts';

export function getStaticPaths() {
  return getPosts().map((post) => ({ params: { id: String(post.id) }, props: { post } }));
}

export const GET: APIRoute = ({ props }) => {
  const p = props.post as Post;
  const a = p.article;
  const plan = videoPlan(p);
  const card = {
    id: p.id,
    kind: p.kind,
    title: a.title,
    href: p.href,
    date: p.date,
    minutes: p.minutes,
    tag: a.tags[0] ?? null,
    site: p.source?.domain ?? p.preview?.site ?? null,
    cover: p.cover ? picture(p.cover.src || p.cover.poster, 'medium').src : null,
    coverAlt: p.cover ? (picture(p.cover.src || p.cover.poster, 'medium').alt ?? null) : null, // fallback addresses, space-separated
    thumb: p.cover ? picture(p.cover.src || p.cover.poster, 'small').src : '',
    body: p.kind === 'digest' ? p.digestItems.map((i) => `${faNum(i.n)} — ${i.text}`) : a.body,
    why: a.why ?? null,
    video: {
      title: plan.title,
      // Each picture's addresses, best first (src, then the fallbacks).
      chapters: plan.chapters.map((c) => ({ ...c, pics: c.pics.map((s) => picture(s, 'large')).map((x) => [x.src, ...(x.alt?.split(' ') ?? [])]) })),
    },
  };
  return new Response(JSON.stringify(card), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
