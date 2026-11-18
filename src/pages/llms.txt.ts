// /llms.txt (https://llmstxt.org): the site in plain Markdown for AI assistants and their crawlers — what it is, where
// the feeds and sections are, and the newest stories with their links, so an assistant can cite the right page.
import { SITE } from '../site';
import { abs, getFeed, getTags } from '../lib/posts';
import { getVideos, VIDEOS_TITLE } from '../lib/videos';

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
    `- [About](${abs('about/')})`,
    '',
    '## Feeds',
    `- [Every post (RSS)](${abs('rss.xml')})`,
    `- [Stories only (RSS)](${abs('rss/news.xml')})`,
    `- [Daily summary (RSS)](${abs('rss/daily.xml')})`,
    `- [Videos (RSS)](${abs('rss/videos.xml')})`,
    `- [All feeds](${abs('feeds/')})`,
    '',
    '## Topics',
    ...getTags().slice(0, 30).map(({ tag, count }) => `- [${tag}](${abs(`tag/${encodeURIComponent(tag)}/`)}): ${count} stories`),
    '',
    '## Newest stories',
    ...stories.map((p) => `- [${p.article.title}](${abs(`p/${p.id}/`)}) (${p.date.slice(0, 10)}${p.article.tags[0] ? `, ${p.article.tags[0]}` : ''})`),
    '',
    '## Newest videos',
    ...getVideos().slice(0, 10).map((v) => `- [${v.headline}](${abs(`videos/${v.id}/`)}) — ${v.title}`),
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
