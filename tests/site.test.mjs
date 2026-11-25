// The built site's timeline and stories, checked against the crawled data: run after `npm run build` (skipped without dist/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tehranDay } from '../src/lib/time.ts';

const dist = path.resolve('dist');
const built = fs.existsSync(path.join(dist, 'index.html'));
const skip = built ? false : 'run `npm run build` first';
const html = (p) => fs.readFileSync(path.join(dist, p), 'utf8');
const fa = (n) => n.toLocaleString('fa-IR');
const faTime = (iso) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

const posts = Object.fromEntries(
  fs.readdirSync('data/posts').map((f) => {
    const p = JSON.parse(fs.readFileSync(path.join('data/posts', f), 'utf8'));
    return [p.id, p];
  }),
);

/** The timeline of one page: day pills and the items under them, in order. */
// The topics a story is filed under, as src/lib/posts.ts topicsOf picks them: the model's (prompt v2+), else the rules'.
const topicsOf = (p) => (!p.digest && p.ai && !p.ai.failed && (p.ai.v ?? 0) >= 2 && p.ai.topics?.length ? p.ai.topics : p.article.tags);

function timeline(file) {
  const tl = html(file).match(/<ol class="tl" data-tl>([\s\S]*?)<\/ol>\s*(?:<nav|<\/section)/)?.[1] ?? '';
  const rows = [];
  for (const m of tl.matchAll(/<li class="tl-day" data-day="([\d-]+)">[\s\S]*?<\/li>|<li class="tl-item" data-id="(\d+)" data-kind="(\w+)"[^>]*>\s*<span class="tl-dot"[^>]*><\/span>\s*<time class="tl-time" datetime="([^"]+)"[^>]*>([^<]*)<\/time>/g)) {
    if (m[1]) rows.push({ day: m[1], count: m[0].match(/<small data-num>([^<]+) خبر<\/small>/)?.[1] ?? null });
    else rows.push({ id: Number(m[2]), kind: m[3], date: m[4], time: m[5] });
  }
  return rows;
}
function allPages() {
  const files = ['index.html'];
  for (let n = 2; fs.existsSync(path.join(dist, `page/${n}/index.html`)); n++) files.push(`page/${n}/index.html`);
  return files.map((f) => ({ file: f, rows: timeline(f) }));
}

test('timeline: every post once, newest first, across all pages', { skip }, () => {
  const ids = allPages().flatMap((p) => p.rows.filter((r) => r.id).map((r) => r.id));
  assert.ok(ids.length > 20, 'the timeline has posts');
  assert.equal(new Set(ids).size, ids.length, 'no post twice');
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] < ids[i - 1], `${ids[i]} after ${ids[i - 1]}`);
  for (const id of ids) assert.ok(posts[id], `post ${id} exists in data/`);
});

test('timeline: each post sits under its own Tehran day, with its Tehran time', { skip }, () => {
  for (const { file, rows } of allPages()) {
    let day = null;
    assert.ok(rows[0]?.day, `${file} starts with a day`);
    for (const r of rows) {
      if (r.day) {
        day = r.day;
        continue;
      }
      assert.equal(r.date, posts[r.id].date, `${r.id}: the crawled date`);
      assert.equal(tehranDay(r.date), day, `${file}: ${r.id} (${r.date}) under ${day}`);
      assert.equal(r.time, faTime(r.date), `${r.id}: shown time`);
    }
    // A day appears once per page, and days go back in time.
    const days = rows.filter((r) => r.day).map((r) => r.day);
    assert.deepEqual(days, [...new Set(days)].sort().reverse(), `${file}: days in order`);
  }
});

test('timeline: a day pill counts all of that day\'s news, on every page it appears', { skip }, () => {
  const pages = allPages();
  const items = pages.flatMap((p) => p.rows.filter((r) => r.id));
  // The lead story on top of the home page is the day's news too, though the timeline under it skips it.
  const lead = Number(html('index.html').match(/<article class="lead-main[^"]*" data-id="(\d+)"/)?.[1]);
  if (lead) items.push({ id: lead, kind: 'story', date: posts[lead].date });
  const perDay = new Map();
  for (const r of items) if (r.kind !== 'digest') perDay.set(tehranDay(r.date), (perDay.get(tehranDay(r.date)) ?? 0) + 1);
  for (const { file, rows } of pages) {
    for (const r of rows.filter((r) => r.day)) {
      const n = perDay.get(r.day) ?? 0;
      assert.equal(r.count, n ? `${fa(n)}` : null, `${file}: ${r.day} shows ${n || 'no count'}`);
    }
  }
});

test('stories: one circle of the recent news, newest first, the same on the rail and in the player', { skip }, () => {
  const home = html('index.html');
  const circles = [...home.matchAll(/<a href="[^"]*today\/" data-rail-ids="([^"]*)"/g)];
  assert.equal(circles.length, 1, 'the rail has one circle');
  const items = circles[0][1].split(',').map((v) => v.split(':').map(Number));
  const ids = items.map(([id]) => id);
  for (const [id, at] of items) assert.equal(at * 1000, Date.parse(posts[id].date), `${id}: rail time`);
  assert.ok(ids.length > 0, 'the circle has stories');
  assert.equal(new Set(ids).size, ids.length, 'no story twice');
  for (let i = 1; i < ids.length; i++) assert.ok(Date.parse(posts[ids[i]].date) <= Date.parse(posts[ids[i - 1]].date), `${ids[i]} after ${ids[i - 1]}`);
  // Three Tehran calendar days, each one whole: every listed story of a carried day is in, except the forwarded
  // original a story comments on (a brief stamped the same second as a story).
  const days = new Set(ids.map((id) => tehranDay(posts[id].date)));
  if (ids.length > 8) assert.ok(days.size <= 3, `three days at most: ${[...days]}`);
  const carried = new Set(ids);
  const listed = allPages().flatMap((p) => p.rows.filter((r) => r.id && r.kind !== 'digest'));
  const lead = Number(home.match(/<article class="lead-main[^"]*" data-id="(\d+)"/)?.[1]);
  if (lead) listed.push({ id: lead, kind: 'story', date: posts[lead].date });
  const storyTimes = new Set(listed.filter((r) => r.kind === 'story').map((r) => r.date));
  for (const r of listed) {
    if (!days.has(tehranDay(r.date))) continue;
    const companion = r.kind === 'brief' && storyTimes.has(r.date);
    assert.equal(carried.has(r.id), !companion, `${r.id} (${r.date}) ${companion ? 'is dropped as a companion' : "is in its day's stories"}`);
  }
  // The player carries the same stories, in the same order.
  const page = html('today/index.html');
  const scenes = [...page.matchAll(/<article class="pl-scene" data-i="\d+" data-id="(\d+)"[^>]*data-date="([^"]+)"/g)];
  assert.deepEqual(scenes.map((m) => Number(m[1])), ids);
  for (const m of scenes) assert.equal(m[2], posts[m[1]].date);
});

test('tags: each topic is paged like the archive, every post once, newest first', { skip }, () => {
  const tags = fs.readdirSync(path.join(dist, 'tag'));
  assert.ok(tags.length > 0);
  for (const tag of tags) {
    const files = [`tag/${tag}/index.html`];
    for (let n = 2; fs.existsSync(path.join(dist, `tag/${tag}/${n}/index.html`)); n++) files.push(`tag/${tag}/${n}/index.html`);
    const ids = files.flatMap((f) => timeline(f).filter((r) => r.id).map((r) => r.id));
    const total = html(files[0]).match(/<span data-num>([^<]+)<\/span> خبر/)[1];
    assert.equal(total, fa(ids.length), `${tag}: the count covers all its pages`);
    assert.equal(new Set(ids).size, ids.length, `${tag}: no post twice`);
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i] < ids[i - 1], `${tag}: ${ids[i]} after ${ids[i - 1]}`);
    files.forEach((f, i) => {
      assert.ok(timeline(f).filter((r) => r.id).length <= 20, `${f}: one page at most`);
      assert.equal(html(f).includes('data-load-more'), i < files.length - 1, `${f}: links to the next page`);
    });
  }
});

test('tags: a topic page lists only its own stories, each labelled with that topic', { skip }, () => {
  for (const dir of fs.readdirSync(path.join(dist, 'tag'))) {
    const tag = decodeURIComponent(dir);
    const files = [`tag/${dir}/index.html`];
    for (let n = 2; fs.existsSync(path.join(dist, `tag/${dir}/${n}/index.html`)); n++) files.push(`tag/${dir}/${n}/index.html`);
    for (const f of files) {
      const tl = html(f).match(/<ol class="tl" data-tl>([\s\S]*?)<\/ol>/)[1];
      for (const item of tl.split('<li class="tl-item"').slice(1)) {
        const id = Number(item.match(/data-id="(\d+)"/)[1]);
        assert.ok(topicsOf(posts[id]).includes(tag), `${f}: #${id} is not about ${tag}`);
        const kicker = item.match(/<a class="kicker" href="[^"]*">([^<]+)<\/a>/)?.[1];
        assert.equal(kicker, tag, `${f}: #${id} is labelled ${kicker}`);
      }
    }
  }
});

test('cards: a view counter on every story; pictures come through the site, with fallbacks down to the original', { skip }, () => {
  const home = html('index.html');
  const items = home.split('<li class="tl-item"').slice(1).filter((s) => s.includes('class="story"'));
  assert.ok(items.length > 5);
  for (const item of items) assert.match(item, /data-views="\d+"[^>]*hidden/, 'hidden until the API has a count');
  let telegram = 0;
  let other = 0;
  // The news (the home page's lead, and the timeline on every page); the channel's avatar is re-read on every crawl.
  // Every page, not just the home one: its 20 newest posts can all be tweets, with no Telegram picture among them.
  const news = allPages().map(({ file }) => {
    const page = html(file);
    const lead = page.indexOf('class="lead-main');
    return page.slice(lead >= 0 ? lead : page.indexOf('data-tl>'), page.indexOf('</ol>', page.indexOf('data-tl>')));
  }).join('\n');
  const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]?.replace(/&amp;/g, '&');
  /** Which stored URL an /api/media or /api/img address stands for. */
  const item = (u) => {
    const [, p, i, f] = u.match(/\/api\/(?:media|img)\/\?p=(\d+)(?:&i=(\d+))?(?:&f=(poster|preview))?$/) ?? [];
    return p && (f === 'preview' ? posts[p].preview.image : f ? posts[p].media[Number(i)].poster : posts[p].media[Number(i)].src);
  };
  for (const m of news.matchAll(/<(?:img|video)\b[^>]*>/g)) {
    // data-fresh belongs to the "new stories" pill: a picture carrying it would reload the page when tapped.
    assert.doesNotMatch(m[0], /data-fresh=/, 'media use data-alt');
    if (m[0].startsWith('<video')) {
      const src = attr(m[0], 'src');
      const alt = attr(m[0], 'data-alt');
      if (/telesco\.pe\//.test(src)) assert.equal(item(alt), src, 'a Telegram video falls back to its current URL');
      else assert.equal(alt, undefined, `only Telegram URLs expire: ${src}`);
      continue;
    }
    const src = attr(m[0], 'src');
    if (!src || src.startsWith('data:')) continue;
    const alt = (attr(m[0], 'data-alt') ?? '').split(' ');
    const proxy = alt.map((u) => /^https:\/\/wsrv\.nl\//.test(u) && new URL(u).searchParams.get('url')).find(Boolean);
    if (/\/api\/img\/\?p=/.test(src)) {
      // A Telegram picture: the site relay by post and index first, then the proxy, then the stored URL.
      telegram++;
      const stored = item(src.replace(/&w=\d+$/, ''));
      assert.ok(stored, `${src}: points at a real media item`);
      assert.equal(item(proxy), stored, 'the proxy asks for the same item');
      assert.ok(alt.includes(stored), 'falls back to the stored Telegram URL');
    } else if (/\/api\/img\/\?u=/.test(src)) {
      // From X: the site relay first, then the proxy, then the original.
      other++;
      const original = new URL(src, 'https://site.test').searchParams.get('u');
      assert.match(original, /^https:\/\/(pbs\.twimg\.com|i\.ytimg\.com)\//);
      assert.equal(proxy, original);
      assert.ok(alt.includes(original), `falls back to the original: ${original}`);
    } else {
      // Any other site: the proxy, then the original.
      assert.match(src, /^https:\/\/wsrv\.nl\//, `shown through the image proxy: ${src}`);
      assert.ok(alt.includes(new URL(src).searchParams.get('url')), 'falls back to the original');
    }
  }
  // Which kinds the home page shows depends on the day's posts (a run of link-only stories has no Telegram picture,
  // which failed scheduled builds), so only require pictures at all: each one above is checked by its kind.
  assert.ok(telegram + other > 0, 'the timeline has pictures');
});

/** One feed's checks, for readers in Iran: valid XML, its own self link, items newest first, the newest FULL whole
 *  (pictures through the site, digests linking to its pages), the rest a summary. Returns the items' ids. */
function checkFeed(file, FULL = 100) {
  const xml = html(file);
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const tag = (s, t) => s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1];
  assert.doesNotMatch(xml, /[\x00-\x08\x0B\x0C\x0E-\x1F]/, `${file}: no characters XML forbids`);
  const self = unesc(xml.match(/<atom:link href="(https:\/\/[^"]+)" rel="self" type="application\/rss\+xml"\/>/)?.[1] ?? '');
  assert.equal(decodeURIComponent(new URL(self).pathname), `/${file}`, `${file}: its self link`);
  assert.match(xml, /<language>fa-IR<\/language>/);
  assert.match(xml, /<ttl>\d+<\/ttl>/);
  assert.ok(!Number.isNaN(Date.parse(tag(xml, 'lastBuildDate'))), `${file}: lastBuildDate`);

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const ids = items.map((it) => Number(tag(it, 'link').match(/\/p\/(\d+)\/$/)?.[1]));
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] < ids[i - 1], `${file}: ${ids[i]} after ${ids[i - 1]}`);
  for (const [i, it] of items.entries()) {
    const id = ids[i];
    assert.ok(fs.existsSync(path.join(dist, `p/${id}/index.html`)), `${id}: its page is built`);
    assert.equal(tag(it, 'guid'), tag(it, 'link'));
    assert.equal(new Date(tag(it, 'pubDate')).getTime(), Date.parse(posts[id].date), `${id}: pubDate`);
    assert.ok(tag(it, 'title')?.trim() && tag(it, 'description')?.trim(), `${id}: title and description`);
    // The cover is a thumbnail only: an <enclosure> would show it a second time beside the content's own pictures.
    assert.doesNotMatch(it, /<enclosure/, `${id}: no enclosure`);
    const thumb = it.match(/<media:thumbnail url="([^"]+)"\/>/);
    const body = unesc(tag(it, 'content:encoded') ?? '');
    assert.equal(!!body, i < FULL, `${file}: ${id} whole only among the newest ${FULL}`);
    // Telegram's and X's CDNs are filtered in Iran, and Telegram's URLs expire: pictures go by the site's relay.
    for (const u of [thumb && unesc(thumb[1]), ...[...body.matchAll(/<img src="([^"]+)"/g)].map((m) => unesc(m[1]))].filter(Boolean)) {
      assert.doesNotMatch(new URL(u).hostname, /telesco\.pe$|twimg\.com$|ytimg\.com$/, `${id}: ${u}`);
      if (/\/api\/img\//.test(u)) assert.match(u, /^https:\/\/[^/]+\/api\/img\/\?(p=\d+&(i=\d+|f=\w+)|u=[^&]+)(&f=\w+)?&w=800$/);
    }
    if (!body) continue;
    assert.match(body, /^<div dir="rtl" lang="fa">[\s\S]*<\/div>$/, `${id}: right-to-left content`);
    assert.ok(body.includes(`href="${posts[id].url}"`), `${id}: links its Telegram post`);
    if (posts[id].digest) {
      const links = [...body.matchAll(/<li><a href="([^"]+)">/g)].map((m) => m[1]);
      assert.ok(links.length > 0, `${id}: the summary's items`);
      for (const l of links) if (/\/t\.me\//.test(l)) assert.ok(!posts[Number(l.split('/').pop())], `${id}: ${l} has a page on the site`);
    }
  }
  return { ids, items, xml };
}

test('rss: every post on the timeline, newest first; the news, the daily summaries and each topic in feeds of their own', { skip }, () => {
  const all = checkFeed('rss.xml').ids;
  const timeline = allPages().flatMap((p) => p.rows.filter((r) => r.id).map((r) => r.id));
  // The home page shows its lead story and the 24-hour summary above the timeline instead.
  assert.deepEqual(all.filter((id) => timeline.includes(id)), timeline, 'every timeline post, in order');
  assert.ok(all.filter((id) => !timeline.includes(id)).length <= 2, 'besides the home page\'s lead and summary');

  assert.deepEqual(checkFeed('rss/news.xml').ids, all.filter((id) => !posts[id].digest), 'news: every post but the summaries');
  const daily = checkFeed('rss/daily.xml').ids;
  assert.deepEqual(daily, all.filter((id) => posts[id].digest), 'daily: every summary');
  assert.ok(daily.length > 1);

  const topics = fs.readdirSync(path.join(dist, 'tag')).filter((t) => fs.existsSync(path.join(dist, 'tag', t, 'rss.xml')));
  assert.ok(topics.length > 5, 'a feed per topic');
  for (const t of topics) {
    const { items } = checkFeed(`tag/${t}/rss.xml`);
    assert.ok(items.length && items.every((it) => it.includes(`<category>${t}</category>`)), `${t}: its topic's posts`);
    assert.ok(html(`tag/${t}/index.html`).includes(`<link rel="alternate" type="application/rss+xml" title="${'فیوچر فوکوس'} — ${t}"`), `${t}: its page names its feed first`);
  }
  const head = html('index.html');
  for (const f of ['rss.xml', 'rss/news.xml', 'rss/daily.xml']) assert.ok(head.includes(`type="application/rss+xml"`) && head.includes(`/${f}"`), `home names ${f}`);
  const page = html('feeds/index.html');
  for (const f of ['rss.xml', 'rss/news.xml', 'rss/daily.xml', `tag/${encodeURIComponent(topics[0])}/rss.xml`]) assert.ok(page.includes(`data-copy="https://blog.remixt.app/${f}"`), `/feeds/ lists ${f}`);
});

test('videos: a page per video of data/videos.json, newest first, and a feed whose pictures come through the relay', { skip }, () => {
  const file = path.resolve('data/videos.json');
  if (!fs.existsSync(file)) return;
  const videos = JSON.parse(fs.readFileSync(file, 'utf8')).videos;
  const index = fs.readFileSync(path.join(dist, 'videos/index.html'), 'utf8');
  const ids = (html) => [...html.matchAll(/href="[^"]*\/videos\/([\w-]{11})\/"/g)].map((m) => m[1]);
  // The newest on top, then every episode and then the lives, each newest first (the grids). The category shelves
  // between them (once the model has summarized episodes) hold some of them again, each shelf newest first too.
  const [hero, ...rest] = videos;
  const heroId = ids(index.match(/<a class="vd-hero"[^>]*>/)?.[0] ?? '')[0];
  const grids = [...index.matchAll(/<ul class="vd-grid">([\s\S]*?)<\/ul>/g)].flatMap((m) => ids(m[1]));
  assert.deepEqual([heroId, ...grids], [hero, ...rest.filter((v) => !v.live), ...rest.filter((v) => v.live)].map((v) => v.id), 'every video, newest first');
  const rank = new Map(videos.map((v, i) => [v.id, i]));
  for (const [, shelf] of index.matchAll(/<ul class="vd-row">([\s\S]*?)<\/ul>/g)) {
    const r = ids(shelf).filter((id, i, a) => a.indexOf(id) === i).map((id) => rank.get(id));
    assert.deepEqual(r, [...r].sort((x, y) => x - y), 'a shelf, newest first');
  }
  for (const v of videos) assert.ok(fs.existsSync(path.join(dist, `videos/${v.id}/index.html`)), `${v.id}: its page`);
  const xml = fs.readFileSync(path.join(dist, 'rss/videos.xml'), 'utf8');
  assert.equal((xml.match(/<item>/g) ?? []).length, videos.length);
  for (const [, u] of xml.matchAll(/<media:thumbnail url="([^"]+)"\/>/g)) assert.match(u.replace(/&amp;/g, '&'), /^https:\/\/[^/]+\/api\/img\/\?u=https%3A%2F%2Fi\.ytimg\.com%2F/);
});

test('videos: every episode has a teaser (card.json with lines to say) and its button, summarized or not', { skip }, () => {
  const { videos } = JSON.parse(fs.readFileSync('data/videos.json', 'utf8'));
  for (const v of videos) {
    const card = JSON.parse(html(`videos/${v.id}/card.json`));
    assert.equal(card.vid, v.id);
    assert.ok(card.title && card.body.length >= 1 && card.body.every((l) => l.trim().length > 10), `${v.id}: lines to say`);
    // Every line the plan says exists (server/tts.js reads them by index: title, ...body, why).
    const lines = [card.title, ...card.body, card.why];
    for (const ch of card.video.chapters) for (const i of ch.say) assert.ok(lines[i], `${v.id}: line ${i}`);
    assert.match(html(`videos/${v.id}/index.html`), /data-make-video="[^"]*videos\/[\w-]+\/"/, `${v.id}: the teaser button`);
  }
  assert.equal((html('videos/index.html').match(/class="vd-teaser"/g) ?? []).length >= videos.length, true, 'a teaser button on every card');
});

test('notifications: recent.json gives each story a picture the phone can reach, never a filtered CDN', { skip }, () => {
  const { posts: list } = JSON.parse(html('recent.json'));
  const withImage = list.filter((p) => p.image);
  assert.ok(withImage.length > list.length / 3, 'most stories have a picture');
  for (const p of withImage) {
    assert.match(p.image, /^https:\/\//);
    assert.doesNotMatch(new URL(p.image).hostname, /(^|\.)(twimg\.com|telesco\.pe|ytimg\.com|t\.me)$/, `${p.id}: ${p.image}`);
  }
  // The small copy for the notification's icon goes with the big one.
  for (const p of withImage) assert.match(p.icon ?? '', /^https:\/\//, `${p.id}: icon`);
  // Never a profile picture or a logo: X's link previews only carry the tweet author's avatar (a 200-px square).
  const xPreview = (d) => /FxTwitter|Twitter|^X\b/.test(d?.preview?.site ?? '') && !(d.media ?? []).length && !(d.links ?? []).some((l) => (l.media ?? []).length || (l.quote?.media ?? []).length || l.image || l.article?.image);
  for (const p of list) {
    if (xPreview(posts[p.id])) assert.equal(p.image, undefined, `${p.id}: the X preview's avatar is not the story's picture`);
    if (p.image) assert.doesNotMatch(decodeURIComponent(p.image), /profile_images|arxiv-logo|favicon/, `${p.id}: ${p.image}`);
  }
  // Topics come first (a notification names the first), then who the story is about.
  for (const p of list) {
    const at = p.tags.findIndex((t) => t.startsWith('who:'));
    if (at >= 0) assert.ok(p.tags.slice(at).every((t) => t.startsWith('who:')), `${p.id}: topics before names`);
  }
});

test('who: each page can be followed, and its stories carry its key for the home filter', { skip }, () => {
  const dir = path.join(dist, 'who');
  const slugs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((s) => fs.existsSync(path.join(dir, s, 'index.html'))) : [];
  for (const slug of slugs.slice(0, 20)) {
    const page = html(`who/${slug}/index.html`);
    assert.match(page, new RegExp(`data-follow="who:${slug}"`), slug);
    assert.match(page, new RegExp(`data-tags="[^"]*who:${slug}`), `${slug}: its stories carry who:${slug}`);
  }
});

test('threads: a story of a thread shows the thread in order, itself marked, every link one of its stories', { skip }, () => {
  const threads = JSON.parse(fs.readFileSync('data/related.json', 'utf8')).threads ?? [];
  let checked = 0;
  for (const t of threads) {
    for (const id of t) {
      const file = `p/${id}/index.html`;
      if (!fs.existsSync(path.join(dist, file))) continue;
      const box = html(file).match(/<section class="thread"[\s\S]*?<\/section>/)?.[0];
      if (!box) continue; // fewer than three of its stories are listed
      assert.match(box, /aria-current="true"/, `${file}: marks itself`);
      const lines = [...box.matchAll(/<ol class="thread-line"[^>]*>([\s\S]*?)<\/ol>/g)].map((m) => m[1]).join('');
      const linked = [...lines.matchAll(/href="[^"]*\/p\/(\d+)\/"/g)].map((m) => Number(m[1]));
      for (const l of linked) assert.ok(t.includes(l), `${file}: #${l} isn't in its thread`);
      for (let i = 1; i < linked.length; i++) assert.ok(linked[i] > linked[i - 1], `${file}: oldest first`);
      checked++;
    }
  }
  assert.ok(!threads.length || checked > 0, 'some thread box was checked');
});

test('models and calendar: the pages build, each model once, and the calendar file is valid iCalendar', { skip }, () => {
  const models = html('models/index.html');
  const ids = [...models.matchAll(/<li class="md-card" id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'each model once');
  assert.ok(html('calendar/index.html').includes('calendar.ics'));
  const en = html('en/models/index.html');
  const enIds = [...en.matchAll(/<li class="md-card" id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(enIds).size, enIds.length, 'English: each model once');
  assert.ok(enIds.every((id) => ids.includes(id)), 'English: models of /models/');
});

/** An iCalendar file's checks (RFC 5545): CRLF only, lines ≤75 octets, the calendar's and every event's required
 *  properties, all-day dates, unique UIDs, text escaped. Returns the unfolded events. */
function checkIcs(file) {
  const ics = fs.readFileSync(path.join(dist, file), 'utf8');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), `${file}: one calendar`);
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /[\r\n]/, `${file}: every line ends in CRLF`);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `${file}: folded: ${line.slice(0, 40)}`);
  const lines = ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
  for (const p of ['VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H']) assert.ok(lines.includes(p), `${file}: ${p}`);
  assert.ok(lines.some((l) => /^PRODID:\S/.test(l)) && lines.some((l) => /^X-WR-CALNAME:\S/.test(l)), `${file}: PRODID and X-WR-CALNAME`);
  const events = [];
  let cur = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') cur = {};
    else if (l === 'END:VEVENT') (events.push(cur), (cur = null));
    else if (cur) {
      const [, name, value] = l.match(/^([A-Z-]+(?:;[^:]+)?):(.*)$/) ?? [];
      assert.ok(name, `${file}: a property line: ${l.slice(0, 40)}`);
      cur[name] = value;
    }
  }
  assert.equal(events.length, (ics.match(/BEGIN:VEVENT/g) ?? []).length);
  const uids = new Set();
  for (const e of events) {
    assert.match(e.UID ?? '', /^\S+@\S+$/, `${file}: UID`);
    assert.ok(!uids.has(e.UID), `${file}: ${e.UID} once`);
    uids.add(e.UID);
    assert.match(e.DTSTAMP ?? '', /^\d{8}T\d{6}Z$/, `${file}: DTSTAMP in UTC`);
    assert.match(e['DTSTART;VALUE=DATE'] ?? '', /^\d{8}$/, `${file}: all-day DTSTART`);
    assert.match(e['DTEND;VALUE=DATE'] ?? '', /^\d{8}$/, `${file}: all-day DTEND`);
    assert.ok(e['DTEND;VALUE=DATE'] > e['DTSTART;VALUE=DATE'], `${file}: DTEND the day after`);
    assert.ok(e.SUMMARY?.trim(), `${file}: SUMMARY`);
    for (const k of ['SUMMARY', 'DESCRIPTION']) if (e[k]) assert.doesNotMatch(e[k], /(?<!\\)[;,]|(?<!\\)\n/, `${file}: ${k} escaped`);
    assert.match(e['URL;VALUE=URI'] ?? '', /^https:\/\//, `${file}: the story's address`);
  }
  return events;
}

test('calendar: both calendar files are valid iCalendar, the English one in English and linked to English pages', { skip }, () => {
  const fa = checkIcs('calendar.ics');
  const en = checkIcs('en/calendar.ics');
  assert.ok(en.length <= fa.length, 'the English calendar: the events with an English story');
  for (const e of en) {
    assert.doesNotMatch(e.SUMMARY, /[\u0600-\u06ff]/, `${e.UID}: an English title`);
    const id = e['URL;VALUE=URI'].match(/\/en\/p\/(\d+)\/$/)?.[1];
    assert.ok(id && fs.existsSync(path.join(dist, `en/p/${id}/index.html`)), `${e.UID}: its English story`);
  }
  for (const [page, file, lang] of [['calendar/index.html', 'calendar.ics', 'fa'], ['en/calendar/index.html', 'en/calendar.ics', 'en']]) {
    const h = html(page);
    assert.ok(h.includes(`href="webcal://blog.remixt.app/${file}"`), `${page}: subscribes with webcal://`);
    assert.ok(h.includes(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://blog.remixt.app/${file}`)}`), `${page}: Google Calendar's subscribe link`);
    assert.ok(h.includes(`data-copy="https://blog.remixt.app/${file}"`), `${page}: the address to copy`);
    assert.ok(h.includes(`<link rel="alternate" type="text/calendar"`), `${page}: names its calendar`);
    // Every upcoming event: a Google Calendar template link (Android) and the data the page makes its .ics from (iPhone).
    for (const [, li] of h.matchAll(/<li class="cal-ev"([^>]*)>/g)) {
      assert.match(li, /data-uid="[^"]+" data-date="\d{4}-\d{2}-\d{2}" data-url="https:\/\/[^"]+"/, `${page}: an event's data`);
    }
    for (const [, u] of h.matchAll(/class="cal-add" href="([^"]+)"/g)) {
      const q = new URL(u.replace(/&amp;/g, '&'));
      assert.equal(q.searchParams.get('action'), 'TEMPLATE');
      assert.match(q.searchParams.get('dates') ?? '', /^\d{8}\/\d{8}$/);
      assert.ok(q.searchParams.get('text'), `${page}: the event's title`);
      if (lang === 'en') assert.doesNotMatch(q.searchParams.get('text'), /[\u0600-\u06ff]/);
    }
  }
});

test('calendar: the iCalendar helpers fold by octets without splitting a character, and escape text', async () => {
  const { fold, icsEscape, icsCalendar, googleEventUrl } = await import('../src/lib/ics.ts');
  const long = `SUMMARY:${'رویداد هوش مصنوعی 😀 '.repeat(12)}`;
  const folded = fold(long);
  for (const l of folded.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75);
  assert.equal(folded.replace(/\r\n /g, ''), long, 'unfolds to the same line');
  assert.equal(icsEscape('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  const one = icsCalendar({ name: 'x', lang: 'en', host: 'h', events: [{ uid: '1-2026-01-31', date: '2026-01-31', summary: 'S', url: 'https://h/en/p/1/' }], stamp: new Date('2026-01-01T00:00:00Z') });
  assert.match(one, /DTSTART;VALUE=DATE:20260131\r\nDTEND;VALUE=DATE:20260201\r\n/);
  assert.match(one, /UID:1-2026-01-31@h\r\nDTSTAMP:20260101T000000Z\r\n/);
  assert.match(googleEventUrl({ date: '2026-12-31', summary: 'S' }), /dates=20261231%2F20270101/);
});

test('English edition: each page with a Persian twin names it, and the language switch lands on the twin', { skip }, () => {
  const pairs = [['feeds/', 'en/feeds/'], ['calendar/', 'en/calendar/'], ['models/', 'en/models/'], ['who/', 'en/who/'], ['today/', 'en/today/'], ['week/', 'en/week/'], ['stats/', 'en/stats/'], ['saved/', 'en/saved/'], ['offline/', 'en/offline/']];
  const videos = fs.existsSync(path.join(dist, 'videos')) ? fs.readdirSync(path.join(dist, 'videos')).filter((d) => /^[\w-]{11}$/.test(d)) : [];
  for (const v of videos) pairs.push([`videos/${v}/`, `en/videos/${v}/`]);
  for (const [fa, en] of pairs) {
    const e = html(`${en}index.html`);
    const f = html(`${fa}index.html`);
    assert.match(e, /<html lang="en" dir="ltr"/, `${en}: English, left to right`);
    assert.ok(e.includes(`data-alt-lang="/${fa}"`) && e.includes(`data-lang-switch="fa"`) && e.includes(`class="lang-switch" href="/${fa}"`), `${en}: the switch opens /${fa}`);
    assert.ok(f.includes(`data-alt-lang="/${en}"`) && f.includes(`class="lang-switch" href="/${en}"`), `${fa}: the switch opens /${en}`);
    if (/noindex/.test(e.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? '')) continue;
    assert.ok(e.includes(`<link rel="alternate" hreflang="fa" href="https://blog.remixt.app/${fa}">`), `${en}: hreflang fa`);
    assert.ok(f.includes(`<link rel="alternate" hreflang="en" href="https://blog.remixt.app/${en}">`), `${fa}: hreflang en`);
    assert.ok(e.includes(`<link rel="canonical" href="https://blog.remixt.app/${en}">`), `${en}: canonical`);
    assert.ok(e.includes('<meta property="og:locale" content="en_US">'), `${en}: og:locale`);
    assert.ok(e.includes('<link rel="alternate" type="application/rss+xml" title="Future Focus — all stories" href="/en/rss.xml">'), `${en}: names the English feed`);
    // Each JSON-LD block parses and says its type.
    for (const [, j] of e.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) assert.ok(JSON.parse(j)['@type'], `${en}: JSON-LD`);
  }
  assert.ok(fs.existsSync(path.join(dist, 'en/404.html')), "the English 404 where Cloudflare Pages looks for it");
  assert.match(html('en/search/index.html'), /location\.replace\(/, '/en/search/ forwards to the explorer');
  // The sitemap pairs the twins.
  const map = html('sitemap-0.xml');
  for (const [fa, en] of pairs.filter(([, en]) => !/saved|offline/.test(en))) {
    const entry = map.match(new RegExp(`<url><loc>https://blog\\.remixt\\.app/${en.replace(/[-/]/g, '\\$&')}</loc>[\\s\\S]*?</url>`))?.[0] ?? '';
    assert.ok(entry.includes(`hreflang="fa-IR" href="https://blog.remixt.app/${fa}"`), `sitemap: ${en} ↔ ${fa}`);
  }
});

test('English feeds: English, absolute links, every story its English page, pictures through the site, listed on /en/feeds/', { skip }, () => {
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const tag = (s, t) => s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1];
  const enPages = new Set(fs.readdirSync(path.join(dist, 'en/p')).map(Number));
  const topics = fs.readdirSync(path.join(dist, 'en/topic')).filter((t) => fs.existsSync(path.join(dist, 'en/topic', t, 'rss.xml')));
  assert.ok(topics.length > 5, 'a feed per English topic');
  const files = ['en/rss.xml', 'en/rss/daily.xml', 'en/rss/videos.xml', ...topics.map((t) => `en/topic/${t}/rss.xml`)];
  for (const file of files) {
    const xml = html(file);
    assert.doesNotMatch(xml, /[\x00-\x08\x0B\x0C\x0E-\x1F]/, `${file}: no characters XML forbids`);
    assert.match(xml, /<language>en<\/language>/, `${file}: English`);
    assert.ok(xml.includes(`<atom:link href="https://blog.remixt.app/${file}" rel="self" type="application/rss+xml"/>`), `${file}: its self link`);
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    for (const it of items) {
      assert.match(tag(it, 'link') ?? '', /^https:\/\//, `${file}: absolute link`);
      assert.ok(tag(it, 'title')?.trim(), `${file}: a title`);
      for (const u of [...it.matchAll(/(?:url|src)="([^"]+)"/g)].map((m) => unesc(m[1]))) assert.doesNotMatch(new URL(u).hostname, /telesco\.pe$|twimg\.com$|ytimg\.com$/, `${file}: ${u} through the site`);
      const body = unesc(tag(it, 'content:encoded') ?? '');
      if (body) assert.match(body, /^<div lang="en" dir="ltr">[\s\S]*<\/div>$/, `${file}: left-to-right content`);
    }
    if (file === 'en/rss/daily.xml' || file === 'en/rss/videos.xml') continue;
    const ids = items.map((it) => Number(tag(it, 'link').match(/\/en\/p\/(\d+)\/$/)?.[1]));
    for (const id of ids) assert.ok(enPages.has(id), `${file}: ${id} has an English page`);
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i] < ids[i - 1], `${file}: newest first`);
    if (file === 'en/rss.xml') assert.equal(ids.length, enPages.size, 'every English story');
    else assert.ok(items.length > 0 && html(file.replace('rss.xml', 'index.html')).includes(`href="/${file}"`), `${file}: its topic page names it`);
  }
  const page = html('en/feeds/index.html');
  for (const f of files) assert.ok(page.includes(`data-copy="https://blog.remixt.app/${f}"`), `/en/feeds/ lists ${f}`);
  assert.ok(page.includes('data-copy="https://blog.remixt.app/en/calendar.ics"'), '/en/feeds/ lists the calendar');
  // Google News: the English stories of the last two days beside the Persian ones, each in its language.
  const news = html('news-sitemap.xml');
  for (const [, loc, lang] of news.matchAll(/<url><loc>([^<]+)<\/loc>[\s\S]*?<news:language>(\w+)<\/news:language>/g)) {
    assert.equal(lang, /\/en\/p\//.test(loc) ? 'en' : 'fa', `${loc}: its language`);
    if (lang === 'en') assert.ok(enPages.has(Number(loc.match(/\/(\d+)\/$/)[1])), `${loc}: built`);
  }
});
