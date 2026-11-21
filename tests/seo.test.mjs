// Search engines and the owner's numbers: the IndexNow key, the usage events, and — after `npm run build` — the built
// pages' descriptions, structured data, sitemap and llms.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.KHABAR_MEMORY_STORE = '1';
process.env.ADMIN_TOKEN = 'admin-secret';
const { INDEXNOW_KEY, indexNowBody } = await import('../scripts/notify.mjs');
const live = await import('../server/live.js');
const admin = await import('../server/admin.js');

const dist = path.resolve('dist');
const skip = fs.existsSync(path.join(dist, 'index.html')) ? false : 'run `npm run build` first';
const html = (p) => fs.readFileSync(path.join(dist, p), 'utf8');

test('IndexNow: one key in the site, the notify script and the key file', () => {
  const site = fs.readFileSync('src/site.ts', 'utf8').match(/indexNowKey: '([0-9a-f]+)'/)?.[1];
  assert.equal(site, INDEXNOW_KEY);
  assert.equal(fs.readFileSync(`public/${INDEXNOW_KEY}.txt`, 'utf8').trim(), INDEXNOW_KEY);
  const body = indexNowBody('https://blog.remixt.app', [{ href: '/p/7/' }, { href: '/p/7/' }, { href: '/p/8/' }]);
  assert.equal(body.host, 'blog.remixt.app');
  assert.equal(body.keyLocation, `https://blog.remixt.app/${INDEXNOW_KEY}.txt`);
  assert.deepEqual(body.urlList, ['https://blog.remixt.app/p/7/', 'https://blog.remixt.app/p/8/', 'https://blog.remixt.app/', 'https://blog.remixt.app/today/']);
});

test('usage events: only known names, whole counts, capped; the browser and server lists agree', async () => {
  const cmds = live.eventCmds({ listen: 2, share: 1, 'drop table': 3, save: -1, playlist: 1.5, quiz: 'x', 'video-made-v': 900 });
  const names = cmds.filter((c) => c[0] === 'HINCRBY').map((c) => [c[2], c[3]]);
  assert.deepEqual(names, [['listen', '2'], ['share', '1'], ['video-made-v', '50']]);
  assert.deepEqual(live.eventCmds(null), []);
  const browser = fs.readFileSync('src/scripts/core.ts', 'utf8').match(/export const EVENTS = \[([^\]]+)\]/)[1].match(/'([\w-]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual([...live.EVENTS].sort(), browser.sort());

  // Sent with a beat, they show on the owner's page.
  const beat = (ev) => live.POST(new Request('https://site.test/api/live', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest: 'guest-events-0000000001', ev }) }));
  assert.equal((await beat({ listen: 3, share: 1 })).status, 200);
  assert.equal((await beat({ listen: 1 })).status, 200);
  const d = await (await admin.GET(new Request('https://site.test/api/admin', { headers: { authorization: 'Bearer admin-secret' } }))).json();
  assert.equal(d.events.counts.listen, 4);
  assert.equal(d.events.counts.share, 1);
  assert.equal(d.readers.length, 30);
  assert.equal(d.tts.free, 500000);
  assert.ok(d.engagement && Array.isArray(d.engagement.reactions));
});

test('every page: a description search engines show whole, and valid JSON-LD', { skip }, () => {
  const pages = ['index.html', 'page/2/index.html', 'videos/index.html', 'tags/index.html'];
  const posts = fs.readdirSync(path.join(dist, 'p')).filter((d) => /^\d+$/.test(d)).slice(-60);
  pages.push(...posts.map((d) => `p/${d}/index.html`));
  for (const p of pages) {
    const page = html(p);
    const desc = page.match(/<meta name="description" content="([^"]*)"/)?.[1];
    assert.ok(desc && desc.length <= 160, `${p}: description ${desc?.length}`);
    for (const m of page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  }
  const story = html(`p/${posts.at(-1)}/index.html`);
  const ld = [...story.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const article = ld.find((x) => x['@type'] === 'NewsArticle');
  assert.ok(article.speakable && article.wordCount > 0 && article.isAccessibleForFree === true);
  const home = [...html('index.html').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.ok(home.find((x) => x.mainEntity?.['@type'] === 'ItemList').mainEntity.itemListElement.length > 5);
  assert.match(html('page/2/index.html'), /<link rel="prev" href="https:\/\/blog\.remixt\.app\/"/);
});

test('sitemap: every story with its last change; robots and llms.txt', { skip }, () => {
  const xml = fs.readdirSync(dist).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => html(f)).join('');
  const stories = [...xml.matchAll(/<url><loc>[^<]*\/p\/\d+\/<\/loc>(.*?)<\/url>/g)];
  assert.ok(stories.length > 100);
  assert.ok(stories.every((m) => /<lastmod>/.test(m[1])), 'a story without lastmod');
  assert.ok(stories.some((m) => /<image:image>/.test(m[1])), 'no pictures in the sitemap');
  assert.ok(!/\/admin\/</.test(xml));
  assert.match(html('robots.txt'), /Sitemap: https:\/\/blog\.remixt\.app\/sitemap-index\.xml/);
  assert.match(html('llms.txt'), /^# /);
});
