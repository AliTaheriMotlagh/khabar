import rss from '@astrojs/rss';
import { SITE } from '../site';
import { abs, feedPicture, getFeed, getTags, type Post } from './posts';

// Characters XML 1.0 forbids: one stray control character in a Telegram text would make the whole feed unreadable.
const clean = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '');
const esc = (s: string) => clean(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Posts that carry the whole story; older ones carry headline, summary and thumbnail, so a feed of every post stays
 *  around 1.5 MB (a feed reader keeps the stories it already fetched in full). */
export const FULL = 100;
/** Minutes a reader may wait between fetches: the channel is crawled every 20. */
const TTL = 20;

export interface FeedDef {
  /** Published path, also the feed's address: 'rss.xml', 'rss/daily.xml', 'tag/<tag, URL-encoded>/rss.xml'. */
  path: string;
  title: string;
  description: string;
  /** The site page the feed mirrors. */
  link: string;
  posts: () => Post[];
}

const tagPath = (tag: string) => `tag/${encodeURIComponent(tag)}/`;

/** Every feed the site publishes; the /feeds/ page lists them and pages name theirs in <head>. */
export const FEEDS = {
  all: {
    path: 'rss.xml',
    title: SITE.name,
    description: `همه‌ی خبرها و خلاصه‌های روزانه‌ی ${SITE.name}، از اولین تا تازه‌ترین.`,
    link: abs(''),
    posts: getFeed,
  },
  news: {
    path: 'rss/news.xml',
    title: `${SITE.name} — خبرها`,
    description: `هر خبر ${SITE.name} جدا، با ترجمه‌ی ${SITE.gholam}، بدون خلاصه‌های روزانه.`,
    link: abs(''),
    posts: () => getFeed().filter((p) => p.kind !== 'digest'),
  },
  daily: {
    path: 'rss/daily.xml',
    title: `${SITE.name} — خلاصه‌ی روزانه`,
    description: `روزی یک بار: خلاصه‌ی اخبار ۲۴ ساعت گذشته‌ی ${SITE.name}، هر بند با پیوند به خبر کاملش.`,
    link: abs(''),
    posts: () => getFeed().filter((p) => p.kind === 'digest'),
  },
} satisfies Record<string, FeedDef>;

export const tagFeed = (tag: string): FeedDef => ({
  path: `${tagPath(tag)}rss.xml`,
  title: `${SITE.name} — ${tag}`,
  description: `خبرهای ${tag} در ${SITE.name}.`,
  link: abs(tagPath(tag)),
  posts: () => getFeed().filter((p) => p.article.tags.includes(tag)),
});

export const tagFeeds = () => getTags().map(({ tag, count }) => ({ tag, count, feed: tagFeed(tag) }));

/** «منبع»: the linked tweet (by its author), page or video, else the post's link preview. */
function sourceLink(p: Post) {
  const l = p.source;
  const url = l?.url ?? p.preview?.url;
  if (!url) return '';
  const handle = l?.kind === 'tweet' && l.author?.handle;
  const name = handle ? `@${handle} در X` : (l ? (l.kind !== 'youtube' && l.title) || l.domain : p.preview?.title) || new URL(url).hostname;
  return `<p>منبع: <a href="${esc(url)}">${esc(name)}</a></p>`;
}

/** The story as its page shows it, for readers that show the whole item: pictures, text (a digest's items link to the
 *  stories on the site), «چرا مهمه؟», source and the Telegram post. Right-to-left, Persian. */
function content(p: Post) {
  const link = abs(`p/${p.id}/`);
  const stills = p.gallery.length ? p.gallery.slice(0, 12) : p.cover ? [p.cover] : [];
  const pictures = stills
    .map((m) => {
      const pic = feedPicture(m.type === 'video' ? m.poster : m.src);
      if (!pic) return '';
      const img = `<img src="${esc(pic.url)}" alt="${esc(p.article.title)}"/>`;
      return m.type === 'video' ? `<p><a href="${esc(link)}">${img}</a><br/><a href="${esc(link)}">▶ دیدن ویدیو</a></p>` : `<p>${img}</p>`;
    })
    .join('');
  const text =
    p.kind === 'digest'
      ? `<ol>${p.digestItems.map((i) => `<li><a href="${esc(i.internal ? abs(`p/${i.id}/`) : i.href)}">${esc(i.text)}</a></li>`).join('')}</ol>`
      : p.article.body.map((t) => `<p>${esc(t)}</p>`).join('');
  const why = p.article.why ? `<p><strong>چرا مهمه؟</strong> ${esc(p.article.why)}</p>` : '';
  const source = sourceLink(p);
  const tail = `<p><a href="${esc(link)}">خواندن در ${esc(SITE.name)}</a> · <a href="${esc(p.url)}">در کانال تلگرام</a></p>`;
  return `<div dir="rtl" lang="fa">${pictures}${text}${why}${source}${tail}</div>`;
}

/** An RSS 2.0 feed of `def`'s posts, newest first, every one of them; the newest FULL with the whole story. */
export function feedResponse(def: FeedDef) {
  const posts = def.posts();
  return rss({
    title: def.title,
    description: def.description,
    site: def.link,
    xmlns: { atom: 'http://www.w3.org/2005/Atom', dc: 'http://purl.org/dc/elements/1.1/', media: 'http://search.yahoo.com/mrss/' },
    customData: [
      `<language>fa-IR</language>`,
      `<atom:link href="${esc(abs(def.path))}" rel="self" type="application/rss+xml"/>`,
      posts.length ? `<lastBuildDate>${new Date(Math.max(...posts.map((p) => Date.parse(p.updated || p.date)))).toUTCString()}</lastBuildDate>` : '',
      `<ttl>${TTL}</ttl>`,
      `<image><url>${abs('icon-192.png')}</url><title>${esc(def.title)}</title><link>${esc(def.link)}</link></image>`,
    ].join(''),
    items: posts.map((p, i) => {
      const cover = feedPicture(p.cover?.src || p.cover?.poster);
      return {
        title: clean(p.article.title),
        link: abs(`p/${p.id}/`),
        pubDate: new Date(p.date),
        description: clean(p.excerpt || p.article.title),
        categories: p.article.tags.map(clean),
        // A story's Persian is Gholam's; a brief or the 24-hour summary is the channel's own.
        // The cover as a list thumbnail, not an <enclosure>: readers show an enclosure as an attachment beside the
        // article, so the picture already at the top of the content would appear twice.
        customData:
          `<dc:creator>${esc(p.kind === 'story' ? SITE.gholam : SITE.owner.name)}</dc:creator>` +
          (cover ? `<media:thumbnail url="${esc(cover.url)}"/>` : ''),
        content: i < FULL ? content(p) : undefined,
      };
    }),
  });
}
