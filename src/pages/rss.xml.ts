import rss from '@astrojs/rss';
import { SITE } from '../site';
import { abs, feedPicture, getFeed, type Post } from '../lib/posts';

// Characters XML 1.0 forbids: one stray control character in a Telegram text would make the whole feed unreadable.
const clean = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '');
const esc = (s: string) => clean(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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

export function GET() {
  const feed = getFeed().slice(0, 50);
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: abs(''),
    xmlns: { atom: 'http://www.w3.org/2005/Atom', dc: 'http://purl.org/dc/elements/1.1/' },
    customData: [
      `<language>fa-IR</language>`,
      `<atom:link href="${abs('rss.xml')}" rel="self" type="application/rss+xml"/>`,
      feed.length ? `<lastBuildDate>${new Date(Math.max(...feed.map((p) => Date.parse(p.updated || p.date)))).toUTCString()}</lastBuildDate>` : '',
      `<image><url>${abs('icon-192.png')}</url><title>${esc(SITE.name)}</title><link>${abs('')}</link></image>`,
    ].join(''),
    items: feed.map((p) => {
      const cover = feedPicture(p.cover?.src || p.cover?.poster);
      return {
        title: clean(p.article.title),
        link: abs(`p/${p.id}/`),
        pubDate: new Date(p.date),
        description: clean(p.excerpt || p.article.title),
        categories: p.article.tags.map(clean),
        enclosure: cover ? { url: cover.url, type: cover.type, length: 0 } : undefined,
        // A story's Persian is Gholam's; a brief or the 24-hour summary is the channel's own.
        customData: `<dc:creator>${esc(p.kind === 'story' ? SITE.gholam : SITE.owner.name)}</dc:creator>`,
        content: content(p),
      };
    }),
  });
}
