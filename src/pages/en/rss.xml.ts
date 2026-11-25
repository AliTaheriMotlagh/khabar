// The English edition's feed: every story's English headline and source text, newest 100 whole.
import { SITE } from '../../site';
import { abs, feedPicture } from '../../lib/posts';
import { EN, getEn } from '../../lib/en';

const x = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
export function GET() {
  const items = getEn().slice(0, 300);
  const body = items
    .map((e, i) => {
      const pic = e.post.cover ? feedPicture(e.post.cover.src || e.post.cover.poster, 'large') : null;
      const text = i < 100 ? e.body.map((p) => `<p>${x(p)}</p>`).join('') : `<p>${x(e.excerpt)}</p>`;
      return `<item><title>${x(e.title)}</title><link>${abs(`en/p/${e.id}/`)}</link><guid isPermaLink="true">${abs(`en/p/${e.id}/`)}</guid><pubDate>${new Date(e.date).toUTCString()}</pubDate>${e.topics.map((t) => `<category>${x(t.en)}</category>`).join('')}<description><![CDATA[${text}<p><a href="${x(e.sourceUrl)}">Source: ${x(e.by || e.publisher)}</a></p>]]></description>${pic ? `<media:thumbnail url="${x(pic.url)}"/>` : ''}</item>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${x(EN.name)}</title><link>${abs('en/')}</link><atom:link href="${abs('en/rss.xml')}" rel="self" type="application/rss+xml"/><description>${x(EN.description)}</description><language>en</language><lastBuildDate>${new Date(items[0]?.date ?? Date.now()).toUTCString()}</lastBuildDate><image><url>${abs('icon-512.png')}</url><title>${x(EN.name)}</title><link>${abs('en/')}</link></image>${body}</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
void SITE;
