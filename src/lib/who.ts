// The people, companies, models and products the stories are about (pipeline/ai_more.py, data/entities.json): which
// stories name each, for /who/ and /who/<slug>/. A name with fewer than MIN stories has no page of its own (a thin
// page helps no one, search engines included); /who/ links it to its story instead.
import { getFeed, type Post } from './posts';
import { entities, type Entity, type EntityKind } from './knowledge';

export const MIN = 2;
export const KIND_FA: Record<EntityKind, string> = { person: 'آدم‌ها', company: 'شرکت‌ها و نهادها', model: 'مدل‌ها', product: 'محصول‌ها و ابزارها' };
export const KIND_ONE: Record<EntityKind, string> = { person: 'شخص', company: 'شرکت', model: 'مدل هوش مصنوعی', product: 'محصول' };

let cache: { e: Entity; posts: Post[] }[] | null = null;
/** Every entity with its listed stories, most stories first. */
export function whoList() {
  if (cache) return cache;
  const by = new Map<string, Post[]>();
  for (const p of getFeed()) for (const e of p.entities) by.set(e.slug, [...(by.get(e.slug) ?? []), p]);
  const known = new Map(entities().map((e) => [e.slug, e]));
  // A name the model gave that isn't in data/entities.json yet (it's added on the next AI run): from the story itself.
  for (const p of getFeed()) for (const e of p.entities) if (!known.has(e.slug)) known.set(e.slug, { ...e });
  cache = [...by]
    .map(([slug, posts]) => ({ e: known.get(slug)!, posts }))
    .filter((x) => x.e)
    .sort((a, b) => b.posts.length - a.posts.length || a.e.name_fa.localeCompare(b.e.name_fa, 'fa'));
  return cache;
}
export const whoHref = (slug: string) => `who/${slug}/`;

let withPage: Set<string> | null = null;
/** Whether /who/<slug>/ exists (MIN stories or more). Story pages link a name only then: a link to a page that
 *  was never built is a 404 for readers and for search engines (Search Console: "Not found (404)"). */
export function hasWhoPage(slug: string) {
  withPage ??= new Set(whoList().filter((x) => x.posts.length >= MIN).map((x) => x.e.slug));
  return withPage.has(slug);
}
