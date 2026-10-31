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
function timeline(file) {
  const tl = html(file).match(/<ol class="tl" data-tl>([\s\S]*?)<\/ol>\s*(?:<nav|<\/section)/)?.[1] ?? '';
  const rows = [];
  for (const m of tl.matchAll(/<li class="tl-day" data-day="([\d-]+)">[\s\S]*?<\/li>|<li class="tl-item" data-id="(\d+)" data-kind="(\w+)">\s*<span class="tl-dot"[^>]*><\/span>\s*<time class="tl-time" datetime="([^"]+)"[^>]*>([^<]*)<\/time>/g)) {
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
        assert.ok(posts[id].article.tags.includes(tag), `${f}: #${id} is not about ${tag}`);
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
  assert.ok(telegram > 0 && other > 0, 'the timeline has Telegram and X pictures');
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
  for (const f of ['rss.xml', 'rss/news.xml', 'rss/daily.xml', `tag/${encodeURIComponent(topics[0])}/rss.xml`]) assert.ok(page.includes(`data-copy="https://khabar-ai.vercel.app/${f}"`), `/feeds/ lists ${f}`);
});
