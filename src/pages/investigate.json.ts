// Everything the explorer (/investigate/, /en/investigate/) and the day archive (/archive/, /en/archive/) need, in one
// file read by the browser (src/scripts/investigate.ts): each listed story's id, time, headlines in both languages,
// topics, the people/companies/models it names, where it stands, its importance and who published it. Dictionaries
// keep it small (~150 KB compressed for 2,000 stories); no page of its own per story or day (Cloudflare's file budget).
import { getStories } from '../lib/posts';
import { TOPIC_EN, enOf } from '../lib/en';
import { publisherOf } from '../lib/source';

const STATUS = { 'رسمی': 1, 'گزارش': 2, 'شایعه': 3 } as const;
export function GET() {
  const topics: string[] = [];
  const ents: [string, string, string, string][] = [];
  const ti = new Map<string, number>();
  const ei = new Map<string, number>();
  const idx = <K>(map: Map<K, number>, list: unknown[], key: K, make: () => unknown) => {
    let i = map.get(key);
    if (i == null) {
      i = list.length;
      list.push(make());
      map.set(key, i);
    }
    return i;
  };
  const s = getStories().map((p) => {
    const en = enOf(p.id);
    const src = p.source;
    const who = src?.author?.name || publisherOf(src?.url ?? p.preview?.url ?? '') || '';
    return [
      p.id,
      Math.round(Date.parse(p.date) / 60000),
      p.article.title,
      en?.title ?? '',
      p.article.tags.map((t) => idx(ti, topics, t, () => t)),
      p.entities.map((e) => idx(ei, ents, e.slug, () => [e.slug, e.name_en, e.name_fa, e.kind])),
      p.status ? STATUS[p.status] : 0,
      p.importance ?? 0,
      who,
      p.thread?.key ?? 0,
    ];
  });
  return new Response(JSON.stringify({ v: 1, built: new Date().toISOString(), t: topics, te: topics.map((t) => TOPIC_EN[t]?.[0] ?? t), e: ents, s }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
