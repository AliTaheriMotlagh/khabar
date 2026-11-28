// Small per-story JSON behind the long-press preview (src/scripts/peek.ts), the cloud voice (server/tts.js) and the
// story's video (src/scripts/video.ts: `video`, by index into the spoken lines).
import type { APIRoute } from 'astro';
import { faNum, filmPlan, getPosts, picture, videoPlan, whyLabel, type Post } from '../../../lib/posts';
import { lexFor } from '../../../lib/knowledge';

export function getStaticPaths() {
  return getPosts().map((post) => ({ params: { id: String(post.id) }, props: { post } }));
}

export const GET: APIRoute = ({ props }) => {
  const p = props.post as Post;
  const a = p.article;
  const plan = videoPlan(p);
  const film = filmPlan(p);
  // Each picture's addresses, best first (src, then the fallbacks).
  const addrs = (s: string, size: 'small' | 'large' = 'large') => {
    const x = picture(s, size);
    return [x.src, ...(x.alt?.split(' ') ?? [])];
  };
  const body = p.kind === 'digest' ? p.digestItems.map((i) => `${faNum(i.n)} — ${i.text}`) : a.body;
  const lex = lexFor([a.title, ...body, a.why ?? '']);
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
    body,
    why: a.why ?? null,
    whyLabel: whyLabel(a),
    // How the voices say its Latin names (server/_say.js); absent when it has none.
    ...(Object.keys(lex).length && { lex }),
    // The technical terms explained (src/scripts/glossary.ts underlines them on the page) and the AI's extras.
    ...(p.terms.length && { terms: p.terms.map((t) => [t.term, t.def]) }),
    ...(p.short !== a.title && { short: p.short }),
    ...(p.translated && { translated: true }),
    ...(p.share && { share: p.share }),
    ...(p.videoAi && { clip: p.videoAi }),
    ...(p.source?.domain && { source: p.source.domain.replace(/^www\./, '') }),
    video: {
      title: plan.title,
      chapters: plan.chapters.map((c) => ({ ...c, pics: c.pics.map((s) => addrs(s)) })),
    },
    // The short film (src/scripts/film.ts): its shots, what each says and shows; the source post's avatar relayed too.
    ...(film && {
      film: {
        ...(film.src && { src: { ...film.src, avatar: film.src.avatar ? addrs(film.src.avatar, 'small') : null } }),
        shots: film.shots.map((s) => ({ ...s, pics: (s.pics ?? []).map((x) => addrs(x)) })),
      },
    }),
  };
  return new Response(JSON.stringify(card), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
