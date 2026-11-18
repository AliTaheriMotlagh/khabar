import { getPosts, getStories, dayKey } from '../lib/posts';
import { getVideos } from '../lib/videos';
import { glossary, entities } from '../lib/knowledge';

// This build's content, for /admin/ (src/scripts/admin.ts): the AI's work (pipeline/ai.py) by field and model, posts
// per Tehran day, the newest post, and the recent posts that aren't on the lists (and why).
export function GET() {
  const all = getPosts();
  const stories = getStories().filter((p) => p.kind === 'story');
  const models: Record<string, number> = {};
  const types: Record<string, number> = {};
  let failed = 0;
  const has = { extras: 0, importance: 0, entities: 0, terms: 0, simple: 0, quiz: 0, video: 0, translated: 0, related: 0 };
  for (const p of stories) {
    if (p.ai?.failed) failed++;
    else if (p.ai?.title) models[p.ai.model ?? '?'] = (models[p.ai.model ?? '?'] ?? 0) + 1;
    if (p.type) types[p.type] = (types[p.type] ?? 0) + 1;
    const x = p.ai?.x;
    if (x && !x.failed) {
      has.extras++;
      if (x.importance) has.importance++;
      if (x.entities?.length) has.entities++;
      if (x.terms?.length) has.terms++;
      if (x.simple) has.simple++;
      if (x.quiz) has.quiz++;
      if (x.video) has.video++;
    }
    if (p.translated) has.translated++;
    if (p.relatedIds.length) has.related++;
  }
  const titled = Object.values(models).reduce((a, b) => a + b, 0);

  // Posts per Tehran day, the last 14 days that have any (listed / not).
  const perDay = new Map<string, { listed: number; hidden: number }>();
  for (const p of all) {
    const d = dayKey(p.date);
    const row = perDay.get(d) ?? { listed: 0, hidden: 0 };
    p.listed ? row.listed++ : row.hidden++;
    perDay.set(d, row);
  }
  const days = [...perDay].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14).reverse().map(([day, n]) => ({ day, ...n }));

  const since = Date.parse(all[0]?.date ?? '') - 3 * 864e5;
  const hidden = all
    .filter((p) => !p.listed && Date.parse(p.date) >= since)
    .map((p) => ({ id: p.id, date: p.date, why: p.digest ? 'خلاصه‌ی انگلیسی' : p.gholam ? 'ترجمه‌ی غلام خوانده نشد' : 'بدون ترجمه‌ی غلام', title: p.article.title.slice(0, 90) }));

  const body = {
    stories: stories.length,
    titled,
    failed,
    models,
    types,
    has,
    posts: all.length,
    listed: all.filter((p) => p.listed).length,
    newest: all[0] ? { id: all[0].id, date: all[0].date } : null,
    days,
    hidden,
    videos: getVideos().length,
    videoSummaries: getVideos().filter((v) => v.ai?.summary).length,
    glossary: glossary().length,
    entities: entities().length,
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
