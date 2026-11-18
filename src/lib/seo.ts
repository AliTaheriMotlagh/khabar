// Structured data (schema.org JSON-LD) shared by the list pages: the home page, the archive, topics, videos and the
// people/company pages. A list is a CollectionPage holding an ItemList of its stories (Google's "carousel" reads it)
// and a BreadcrumbList, so a topic page shows as «فیوچر فوکوس › موضوع‌ها › اوپن‌ای‌آی» in results.
import { SITE } from '../site';
import { abs, sized, type Post } from './posts';

type Crumb = { name: string; path: string };

export function breadcrumbs(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: SITE.name, path: '' }, ...crumbs].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.path) })),
  };
}

/** A list page: CollectionPage + ItemList of its stories (+ breadcrumbs). `home`: the site's front page. */
export function listLd({ name, path, posts, crumbs = [], home = false }: { name: string; path: string; posts: Post[]; crumbs?: Crumb[]; home?: boolean }) {
  const items = posts.slice(0, 30).map((p, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: abs(`p/${p.id}/`),
    name: p.article.title.slice(0, 110),
    ...(p.cover && { image: sized(p.cover.src || p.cover.poster, 'large') }),
  }));
  const out: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': home ? 'WebPage' : 'CollectionPage',
      '@id': abs(path),
      url: abs(path),
      name,
      inLanguage: 'fa-IR',
      isPartOf: { '@id': `${SITE.url}/#website` },
      publisher: { '@id': `${SITE.url}/#org` },
      ...(posts[0] && { dateModified: posts[0].updated || posts[0].date }),
      mainEntity: { '@type': 'ItemList', itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: items.length, itemListElement: items },
    },
  ];
  if (crumbs.length) out.push(breadcrumbs([...crumbs.slice(0, -1), { ...crumbs.at(-1)!, path }]));
  return out;
}
