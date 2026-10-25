// Small per-story JSON behind the long-press preview (src/scripts/peek.ts).
import type { APIRoute } from 'astro';
import { faNum, fresh, getPosts, sized, type Post } from '../../../lib/posts';

export function getStaticPaths() {
  return getPosts().map((post) => ({ params: { id: String(post.id) }, props: { post } }));
}

export const GET: APIRoute = ({ props }) => {
  const p = props.post as Post;
  const a = p.article;
  const card = {
    id: p.id,
    kind: p.kind,
    title: a.title,
    href: p.href,
    date: p.date,
    minutes: p.minutes,
    tag: a.tags[0] ?? null,
    site: p.source?.domain ?? p.preview?.site ?? null,
    cover: p.cover ? sized(p.cover.src || p.cover.poster, 'medium') : null,
    thumb: p.cover ? sized(p.cover.src || p.cover.poster, 'small') : '',
    fresh: fresh(p.cover?.src || p.cover?.poster) ?? null,
    body: p.kind === 'digest' ? p.digestItems.map((i) => `${faNum(i.n)} — ${i.text}`) : a.body,
    why: a.why ?? null,
  };
  return new Response(JSON.stringify(card), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
