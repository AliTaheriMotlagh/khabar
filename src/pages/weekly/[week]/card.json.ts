// The week's recap (pipeline/daily.py --weekly) as a card the video sheet makes a film or a video of (/week/'s
// «ویدیوی مرور هفته», src/scripts/video.ts): the recap's own lines — title, intro, each story's line, outro — over the
// stories' pictures. The voices read them from /weekly/<week>.json (server/tts.js ?week=&k=), keyed by `weekKeys`, so
// the text never comes from a request. Not published to the cinema (that's per story): made and shared by the reader.
import type { APIRoute } from 'astro';
import { weeklies, lexFor, type Weekly } from '../../../lib/knowledge';
import { getPosts, picture, roundupFilm, stills, url } from '../../../lib/posts';
import { SITE } from '../../../site';

export function getStaticPaths() {
  return weeklies().slice(0, 4).map((w) => ({ params: { week: w.week }, props: { w } }));
}

export const GET: APIRoute = ({ props }) => {
  const w = props.w as Weekly;
  const addrs = (s: string) => {
    const x = picture(s, 'large');
    return [x.src, ...(x.alt?.split(' ') ?? [])];
  };
  // The lines in the order every video says them (the server's keys alongside): only lines with text, 12 stories at most.
  const items = w.items.map((it, k) => ({ ...it, key: String(k) })).filter((it) => it.line?.trim()).slice(0, 12);
  const intro = w.intro?.trim() || null;
  const outro = w.outro?.trim() || null;
  const film = roundupFilm({ kind: 'مرور هفته', title: w.title, intro, items: items.map((it) => ({ say: it.line, id: it.id })), outro });
  const byId = new Map(getPosts().map((p) => [p.id, p]));
  const pics = items.map((it) => {
    const p = byId.get(it.id);
    return p ? stills(p, 2) : [];
  });
  const cover = pics.find((x) => x.length)?.[0] ?? null;
  const body = [...(intro ? [intro] : []), ...items.map((it) => it.line.trim())];
  const card = {
    id: 0,
    week: w.week,
    weekKeys: ['title', ...(intro ? ['intro'] : []), ...items.map((it) => it.key), ...(outro ? ['outro'] : [])],
    kind: 'week',
    title: w.title,
    href: url(`weekly/${w.week}/`),
    link: `${SITE.url.replace(/^https:\/\//, '')}/week/`,
    date: `${w.to}T12:00:00Z`,
    tag: 'مرور هفته',
    cover: cover ? picture(cover, 'medium').src : null,
    body,
    why: outro,
    whyLabel: 'جمع‌بندی',
    ...(Object.keys(lexFor([w.title, ...body, outro ?? ''])).length && { lex: lexFor([w.title, ...body, outro ?? '']) }),
    video: {
      title: true,
      chapters: [
        ...(intro ? [{ head: null, say: [1], pics: pics.flat().slice(0, 2).map(addrs) }] : []),
        ...items.map((_, k) => ({ head: String(k + 1), say: [k + 1 + (intro ? 1 : 0)], pics: pics[k].map(addrs) })),
        ...(outro ? [{ head: 'جمع‌بندی', say: [body.length + 1], pics: [] }] : []),
      ],
    },
    ...(film && { film: { meta: film.meta, shots: film.shots.map((s) => ({ ...s, pics: (s.pics ?? []).map(addrs) })) } }),
  };
  return new Response(JSON.stringify(card), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
