// «پادکست خبر»'s feed for podcast apps (Apple Podcasts, Spotify, Castbox, Pocket Casts, YouTube Music): RSS 2.0 with
// the iTunes tags they read. An episode is listed once its sound is made (scripts/podcast.mjs wrote `audio` into
// data/podcast/<day>.json); the MP3 is served from R2 through the site's own domain (functions/media).
import { podcasts } from '../lib/knowledge';
import { getPosts } from '../lib/posts';
import { SITE } from '../site';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dur = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function GET() {
  const byId = new Map(getPosts().map((p) => [p.id, p]));
  const eps = podcasts().filter((e) => e.audio);
  const page = `${SITE.url}/podcast/`;
  const about = 'خبرهای هوش مصنوعی هر روز، در گفت‌وگوی غلام و پریسا: چه اتفاقی افتاد، یعنی چه، و چرا مهم است. متن از خبرهای کانال مهرزاد صمدی و ترجمه‌ی داش غلام؛ مجری‌ها و صداها با هوش مصنوعی.';
  const items = eps
    .map((e) => {
      const list = e.ids.map((id) => byId.get(id)).filter(Boolean).map((p) => `• ${p!.short || p!.article.title}`);
      const desc = `${e.title}\n${list.join('\n')}\n\nمتن کامل و منبع هر خبر: ${page}`;
      return `<item>
<title>${esc(`${e.title} · ${new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long' }).format(new Date(`${e.day}T12:00:00Z`))}`)}</title>
<description>${esc(desc)}</description>
<itunes:summary>${esc(desc)}</itunes:summary>
<link>${page}</link>
<guid isPermaLink="false">khabar-podcast-${e.day}</guid>
<pubDate>${new Date(e.audio!.at).toUTCString()}</pubDate>
<enclosure url="${SITE.url}/media/podcast/${e.day}.mp3" length="${e.audio!.bytes}" type="audio/mpeg"/>
<itunes:duration>${dur(e.audio!.seconds)}</itunes:duration>
<itunes:episodeType>full</itunes:episodeType>
<itunes:explicit>false</itunes:explicit>
</item>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>پادکست خبر · ${esc(SITE.name)}</title>
<link>${page}</link>
<atom:link href="${SITE.url}/podcast.xml" rel="self" type="application/rss+xml"/>
<language>fa</language>
<description>${esc(about)}</description>
<itunes:summary>${esc(about)}</itunes:summary>
<itunes:author>${esc(SITE.name)}</itunes:author>
<itunes:owner><itunes:name>${esc(SITE.author.nameLatin)}</itunes:name></itunes:owner>
<itunes:image href="${SITE.url}/podcast-cover.png"/>
<image><url>${SITE.url}/podcast-cover.png</url><title>پادکست خبر</title><link>${page}</link></image>
<itunes:category text="News"><itunes:category text="Tech News"/></itunes:category>
<itunes:category text="Technology"/>
<itunes:explicit>false</itunes:explicit>
<itunes:type>episodic</itunes:type>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
