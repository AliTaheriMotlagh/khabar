// /llms.txt (https://llmstxt.org): the site in plain Markdown for AI assistants and their crawlers — what it is, where
// the feeds and sections are, and the newest stories with their links, so an assistant can cite the right page.
import { SITE } from '../site';
import { abs, getFeed, getTags } from '../lib/posts';
import { getVideos, VIDEOS_TITLE } from '../lib/videos';
import { getEn } from '../lib/en';

export function GET() {
  const stories = getFeed().filter((p) => p.kind !== 'digest').slice(0, 60);
  const lines = [
    `# ${SITE.name} (${SITE.nameLatin})`,
    '',
    `> ${SITE.description}`,
    '',
    `Persian-language AI and technology news. Each story is a post from the Telegram channel @${SITE.channel} by ${SITE.owner.nameLatin} (${SITE.owner.url}), with a Persian write-up, the original source linked, and the date. Headlines are edited by a small local language model; the text is the channel's own.`,
    '',
    '## Sections',
    `- [Home: newest stories](${abs('')})`,
    `- [Topics](${abs('tags/')})`,
    `- [${VIDEOS_TITLE} (YouTube episodes with Persian summaries)](${abs('videos/')})`,
    `- [Most read this week](${abs('week/')})`,
    `- [Glossary of AI terms in Persian](${abs('glossary/')})`,
    `- [People and companies](${abs('who/')})`,
    `- [News explorer: follow a company, person or model through every story](${abs('investigate/')})`,
    `- [Archive by day](${abs('archive/')})`,
    `- [About](${abs('about/')})`,
    `- [Model tracker: AI models in the news with their benchmark scores](${abs('models/')})`,
    `- [Calendar of upcoming AI events](${abs('calendar/')}) (iCalendar: ${abs('calendar.ics')})`,
    '',
    '## English edition',
    `The same stories in their sources' own words (the tweet, the article, the paper), never a translation; each story at /en/p/<id>/ with its Persian twin linked by hreflang. Stories without English source text have no English page.`,
    `- [Home](${abs('en/')})`,
    `- [Today's stories](${abs('en/today/')})`,
    `- [Topics](${abs('en/topics/')}) (each at /en/topic/<slug>/)`,
    `- [News explorer and search](${abs('en/investigate/')})`,
    `- [Archive by day](${abs('en/archive/')})`,
    `- [People and companies](${abs('en/who/')})`,
    `- [Model tracker](${abs('en/models/')})`,
    `- [Events calendar](${abs('en/calendar/')}) (iCalendar: ${abs('en/calendar.ics')})`,
    `- [Most read this week](${abs('en/week/')})`,
    `- [Mehrzad's videos](${abs('en/videos/')})`,
    `- [About](${abs('en/about/')})`,
    `- [English feeds](${abs('en/feeds/')}): [every story](${abs('en/rss.xml')}), [daily summary](${abs('en/rss/daily.xml')}), [videos](${abs('en/rss/videos.xml')}), and one per topic (/en/topic/<slug>/rss.xml)`,
    '',
    '## Feeds',
    `- [Every post (RSS)](${abs('rss.xml')})`,
    `- [Stories only (RSS)](${abs('rss/news.xml')})`,
    `- [Daily summary (RSS)](${abs('rss/daily.xml')})`,
    `- [Videos (RSS)](${abs('rss/videos.xml')})`,
    `- [English edition (RSS)](${abs('en/rss.xml')})`,
    `- [All feeds](${abs('feeds/')})`,
    '',
    '## Topics',
    ...getTags().slice(0, 30).map(({ tag, count }) => `- [${tag}](${abs(`tag/${encodeURIComponent(tag)}/`)}): ${count} stories`),
    '',
    '## Newest stories',
    ...stories.map((p) => `- [${p.article.title}](${abs(`p/${p.id}/`)}) (${p.date.slice(0, 10)}${p.article.tags[0] ? `, ${p.article.tags[0]}` : ''})`),
    '',
    '## Newest stories in English',
    ...getEn().slice(0, 30).map((e) => `- [${e.title}](${abs(`en/p/${e.id}/`)}) (${e.date.slice(0, 10)})`),
    '',
    '## Newest videos',
    ...getVideos().slice(0, 10).map((v) => `- [${v.headline}](${abs(`videos/${v.id}/`)}) — ${v.title}`),
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
