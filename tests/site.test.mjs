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

test('stories: the rail and the player carry the same recent stories, newest first, three whole days', { skip }, () => {
  const home = html('index.html');
  const recent = home.match(/data-recent="([^"]*)"/)[1].split(',').map((v) => v.split(':').map(Number));
  assert.ok(recent.length > 0);
  for (const [id, at] of recent) assert.equal(at * 1000, Date.parse(posts[id].date), `${id}: rail time`);
  for (let i = 1; i < recent.length; i++) assert.ok(recent[i][0] < recent[i - 1][0]);
  // Three Tehran calendar days, each one whole: every listed story of a carried day is in.
  const days = new Set(recent.map(([, t]) => tehranDay(t * 1000)));
  if (recent.length > 8) assert.ok(days.size <= 3, `three days at most: ${[...days]}`);
  const carried = new Set(recent.map(([id]) => id));
  const listed = allPages().flatMap((p) => p.rows.filter((r) => r.id && r.kind !== 'digest'));
  const lead = Number(home.match(/<article class="lead-main[^"]*" data-id="(\d+)"/)?.[1]);
  if (lead) listed.push({ id: lead, date: posts[lead].date });
  for (const r of listed) if (days.has(tehranDay(r.date))) assert.ok(carried.has(r.id), `${r.id} (${r.date}) is in its day's stories`);
  const scenes = [...html('today/index.html').matchAll(/<article class="pl-scene" data-i="\d+" data-id="(\d+)"[^>]*data-date="([^"]+)"/g)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(scenes.map((s) => s[0]), recent.map((r) => r[0]));
  for (const [id, date] of scenes) assert.equal(date, posts[id].date);
  // «همه» shows its count; «امروز» is shown only when something was published today (as of the build).
  assert.match(home, new RegExp(`data-rail-set="all" aria-label="همه · ${fa(recent.length)} خبر"`));
  const todayBuilt = recent.filter(([, at]) => tehranDay(at * 1000) === tehranDay(fs.statSync(path.join(dist, 'index.html')).mtimeMs)).length;
  const todayLink = home.match(/<a class="story-today"[^>]*>/)[0];
  assert.equal(todayLink.includes(' hidden'), todayBuilt === 0, todayLink);
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

test('cards: a view counter on every story; Telegram media knows where to get a fresh URL', { skip }, () => {
  const home = html('index.html');
  const items = home.split('<li class="tl-item"').slice(1).filter((s) => s.includes('class="story"'));
  assert.ok(items.length > 5);
  for (const item of items) assert.match(item, /data-views="\d+"[^>]*hidden/, 'hidden until the API has a count');
  let checked = 0;
  // The news (lead and timeline); the channel's avatar is re-read on every crawl.
  const news = home.slice(Math.max(0, home.indexOf('class="lead-main')), home.indexOf('</ol>', home.indexOf('data-tl>')));
  for (const m of news.matchAll(/<(?:img|video)\b[^>]*>/g)) {
    const src = m[0].match(/\ssrc="([^"]+)"/)?.[1] ?? '';
    if (!/telesco\.pe\//.test(src)) {
      assert.doesNotMatch(m[0], /data-fresh=/, `only Telegram URLs expire: ${src}`);
      continue;
    }
    checked++;
    const fresh = m[0].match(/data-fresh="[^"]*\/api\/media\/\?p=(\d+)(?:&(?:amp;)?i=(\d+))?(?:&(?:amp;)?f=(poster|preview))?"/);
    assert.ok(fresh, `no fresh address for ${src}`);
    const [, p, i, f] = fresh;
    const want = f === 'preview' ? posts[p].preview.image : f ? posts[p].media[Number(i)].poster : posts[p].media[Number(i)].src;
    assert.equal(src.replace(/&amp;/g, '&'), want, `#${p}: data-fresh points at the same item`);
  }
  assert.ok(checked > 0, 'the home page has Telegram media');
});
