// The English edition's feeds (listed on /en/feeds/, named in English pages' <head>): every English story
// (en/rss.xml), each topic's (en/topic/<slug>/rss.xml), the channel's English 24-hour summaries (en/rss/daily.xml) and
// Mehrzad's videos (en/rss/videos.xml). As the Persian feeds (src/lib/feed.ts): every item, the newest FULL whole with
// pictures through the site's relay (feedPicture), older ones headline + summary; absolute links; <language>en.
import rss from '@astrojs/rss';
import { SITE } from '../site';
import { abs, feedPicture } from './posts';
import { EN, enDate, enOf, enTopics, englishDigestsEn, getEn, type EnPost } from './en';
import { FULL } from './feed';

const TTL = 20;
const clean = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '');
const esc = (s: string) => clean(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface EnFeedDef {
  path: string;
  title: string;
  description: string;
  /** The page the feed mirrors (absolute). */
  link: string;
  items: () => EnPost[];
}

export const EN_FEEDS = {
  all: { path: 'en/rss.xml', title: `${EN.name} — all stories`, description: `Every story on ${EN.name}, in the words of its original source, newest first.`, link: abs('en/'), items: getEn },
} satisfies Record<string, EnFeedDef>;
export const EN_DAILY = { path: 'en/rss/daily.xml', title: `${EN.name} — daily summary`, description: `Once a day: the channel's own English summary of the last 24 hours of AI news, each item linked to its story.` };
export const EN_VIDEOS = { path: 'en/rss/videos.xml', title: `${EN.name} — ${SITE.owner.nameLatin}'s videos`, description: `Every episode of ${SITE.owner.nameLatin}'s YouTube series on AI (spoken in Persian), with its chapters.` };

export const enTopicFeed = (t: { en: string; slug: string }): EnFeedDef => ({
  path: `en/topic/${t.slug}/rss.xml`,
  title: `${EN.name} — ${t.en}`,
  description: `${t.en} stories on ${EN.name}, each with its original source.`,
  link: abs(`en/topic/${t.slug}/`),
  items: () => getEn().filter((e) => e.topics.some((x) => x.slug === t.slug)),
});
export const enTopicFeeds = () => enTopics().map((t) => ({ ...t, feed: enTopicFeed(t) }));

const channel = (path: string, title: string, link: string, newest?: string) =>
  [
    '<language>en</language>',
    `<atom:link href="${esc(abs(path))}" rel="self" type="application/rss+xml"/>`,
    newest ? `<lastBuildDate>${new Date(newest).toUTCString()}</lastBuildDate>` : '',
    `<ttl>${TTL}</ttl>`,
    `<image><url>${abs('icon-192.png')}</url><title>${esc(title)}</title><link>${esc(link)}</link></image>`,
  ].join('');

/** The story as its English page shows it: pictures, the source's text, the quoted post, the source and the links. */
function content(e: EnPost) {
  const link = abs(`en/p/${e.id}/`);
  const p = e.post;
  const stills = p.gallery.length ? p.gallery.slice(0, 8) : p.cover ? [p.cover] : [];
  const pictures = stills
    .map((m) => {
      const pic = feedPicture(m.type === 'video' ? m.poster : m.src);
      if (!pic) return '';
      const img = `<img src="${esc(pic.url)}" alt="${esc(e.title)}"/>`;
      return m.type === 'video' ? `<p><a href="${esc(link)}">${img}</a><br/><a href="${esc(link)}">▶ Watch the video</a></p>` : `<p>${img}</p>`;
    })
    .join('');
  const text = e.body.map((t) => `<p>${esc(t)}</p>`).join('');
  const quote = e.quote ? `<blockquote><p>${esc(e.quote.text)}</p>${e.quote.author ? `<p>— ${esc(e.quote.author)}</p>` : ''}</blockquote>` : '';
  const source = `<p>Source: <a href="${esc(e.sourceUrl)}">${esc(e.by || e.publisher || new URL(e.sourceUrl).hostname)}</a></p>`;
  const tail = `<p><a href="${esc(link)}">Read on ${esc(EN.name)}</a> · <a href="${esc(abs(`p/${e.id}/`))}" hreflang="fa">Persian</a></p>`;
  return `<div lang="en" dir="ltr">${pictures}${text}${quote}${source}${tail}</div>`;
}

export function enFeedResponse(def: EnFeedDef) {
  const items = def.items();
  return rss({
    title: def.title,
    description: def.description,
    site: def.link,
    xmlns: { atom: 'http://www.w3.org/2005/Atom', dc: 'http://purl.org/dc/elements/1.1/', media: 'http://search.yahoo.com/mrss/' },
    customData: channel(def.path, def.title, def.link, items.length ? new Date(Math.max(...items.map((e) => Date.parse(e.post.updated || e.date)))).toISOString() : undefined),
    items: items.map((e, i) => {
      const cover = feedPicture(e.post.cover?.src || e.post.cover?.poster);
      return {
        title: clean(e.title),
        link: abs(`en/p/${e.id}/`),
        pubDate: new Date(e.date),
        description: clean(e.excerpt || e.title),
        categories: e.topics.map((t) => t.en),
        customData: (e.by ? `<dc:creator>${esc(e.by)}</dc:creator>` : '') + (cover ? `<media:thumbnail url="${esc(cover.url)}"/>` : ''),
        content: i < FULL ? content(e) : undefined,
      };
    }),
  });
}

/** The channel's English 24-hour summaries: each item linked to its English page (else the Persian one). */
export function enDailyResponse() {
  const digests = englishDigestsEn();
  const link = abs('en/');
  return rss({
    title: EN_DAILY.title,
    description: EN_DAILY.description,
    site: link,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: channel(EN_DAILY.path, EN_DAILY.title, link, digests[0]?.date),
    items: digests.map((d) => ({
      title: clean(`${(d.title || 'AI news summary').replace(/[.:]\s*$/, '')} — ${enDate(d.date, { dateStyle: 'medium' })}`),
      link: d.url,
      pubDate: new Date(d.date),
      description: clean(d.items.slice(0, 3).map((i) => i.text).join(' · ')),
      content: `<div lang="en" dir="ltr"><ol>${d.items.map((i) => `<li>${i.href ? `<a href="${esc(i.href)}">${esc(i.text)}</a>` : esc(i.text)}</li>`).join('')}</ol><p><a href="${esc(d.url)}">On Telegram</a></p></div>`,
    })),
  });
}

/** Mehrzad's videos: each to its English page, chapters listed, the thumbnail through the relay. */
export async function enVideoFeedResponse() {
  const { getVideos, channelUrl } = await import('./videos');
  const videos = getVideos();
  const link = abs('en/videos/');
  return rss({
    title: EN_VIDEOS.title,
    description: EN_VIDEOS.description,
    site: link,
    xmlns: { atom: 'http://www.w3.org/2005/Atom', media: 'http://search.yahoo.com/mrss/' },
    customData: channel(EN_VIDEOS.path, EN_VIDEOS.title, link),
    items: videos.map((v) => {
      const thumb = feedPicture(v.thumb);
      const page = abs(`en/videos/${v.id}/`);
      const title = videoTitleEn(v.title);
      const chapters = v.chapters ?? [];
      const story = v.post ? enOf(Number(v.post)) : null;
      return {
        title: clean(title),
        link: page,
        pubDate: v.date ? new Date(`${v.date}T12:00:00Z`) : undefined,
        description: clean(story?.excerpt || (chapters.length ? `${chapters.length} chapters: ${chapters.slice(0, 4).map((c) => c.title).join('; ')}` : title)),
        customData: thumb ? `<media:thumbnail url="${esc(thumb.url)}"/>` : '',
        content: `<div lang="en" dir="ltr">${thumb ? `<p><a href="${esc(page)}"><img src="${esc(thumb.url)}" alt="${esc(title)}"/></a></p>` : ''}${chapters.length ? `<ol>${chapters.map((c) => `<li><a href="${esc(`${v.youtube}&t=${c.t}s`)}">${esc(c.title)}</a></li>`).join('')}</ol>` : ''}<p><a href="${esc(page)}">On ${esc(EN.name)}</a> · <a href="${esc(v.youtube)}">Watch on YouTube</a> · <a href="${esc(channelUrl())}">The channel</a></p></div>`,
      };
    }),
  });
}

/** A video's own title without the «[Persian]» tag the channel adds. */
export const videoTitleEn = (t: string) => t.replace(/\s*\[Persian\]\s*$/i, '').trim();
