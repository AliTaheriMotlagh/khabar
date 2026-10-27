// API tests against the in-memory store: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.KHABAR_MEMORY_STORE = '1';
process.env.ADMIN_TOKEN = 'admin-secret';
const comments = await import('../api/comments.js');
const react = await import('../api/react.js');
const engage = await import('../api/engage.js');
const live = await import('../api/live.js');
const chat = await import('../api/chat.js');
const leaders = await import('../api/leaders.js');
const { _memory } = await import('../api/_lib.js');

let ip = 0;
const req = (method, path, body, headers = {}) =>
  new Request(`https://site.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ip % 250}`, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
const call = async (fn, ...args) => {
  const res = await fn(req(...args));
  return { status: res.status, body: await res.json(), res };
};
const A = 'guest-aaaaaaaaaaaaaaaa';
const B = 'guest-bbbbbbbbbbbbbbbb';

test('comments: post, list, validation, delete by owner and admin', async () => {
  const made = await call(comments.POST, 'POST', '/api/comments', { post: 7, guest: A, name: ' علی ', text: 'خبر خوبی بود\n\n\n\nممنون' });
  assert.equal(made.status, 201);
  assert.equal(made.body.comment.name, 'علی');
  assert.equal(made.body.comment.text, 'خبر خوبی بود\n\nممنون');
  assert.equal(made.body.comment.o, undefined, 'owner hash stays private');

  assert.equal((await call(comments.POST, 'POST', '/api/comments', { post: 7, guest: A, text: 'x' })).status, 400);
  assert.equal((await call(comments.POST, 'POST', '/api/comments', { post: 'x', guest: A, text: 'سلام' })).status, 400);
  const bot = await call(comments.POST, 'POST', '/api/comments', { post: 7, guest: A, text: 'buy now', website: 'spam.com' });
  assert.equal(bot.body.comment, null);

  await call(comments.POST, 'POST', '/api/comments', { post: 7, guest: B, text: 'دومی' });
  const list = await call(comments.GET, 'GET', '/api/comments?post=7');
  assert.deepEqual(list.body.comments.map((c) => c.text), ['دومی', 'خبر خوبی بود\n\nممنون']);
  assert.match(list.res.headers.get('cache-control'), /s-maxage=10/);

  const id = made.body.comment.id;
  assert.equal((await call(comments.DELETE, 'DELETE', `/api/comments?post=7&id=${id}`, { guest: B })).status, 403);
  assert.equal((await call(comments.DELETE, 'DELETE', `/api/comments?post=7&id=${id}`, { guest: A })).status, 200);
  const other = list.body.comments[0].id;
  assert.equal((await call(comments.DELETE, 'DELETE', `/api/comments?post=7&id=${other}`, {}, { authorization: 'Bearer admin-secret' })).status, 200);
  assert.equal((await call(comments.GET, 'GET', '/api/comments?post=7')).body.comments.length, 0);
});

test('reactions count once per guest and show up in engage', async () => {
  for (const g of [A, A, B]) await call(react.POST, 'POST', '/api/react', { post: 9, guest: g, reaction: 'fire', on: true });
  let r = await call(react.POST, 'POST', '/api/react', { post: 9, guest: A, reaction: 'fire', on: false });
  assert.equal(r.body.count, 1);
  r = await call(react.POST, 'POST', '/api/react', { post: 9, guest: A, reaction: 'fire', on: false });
  assert.equal(r.body.count, 1, 'removing twice does not go below the real count');
  assert.equal((await call(react.POST, 'POST', '/api/react', { post: 9, guest: A, reaction: 'nope', on: true })).status, 400);

  await call(comments.POST, 'POST', '/api/comments', { post: 9, guest: A, text: 'عالی' });
  const e = await call(engage.GET, 'GET', '/api/engage?ids=9,10,abc');
  assert.deepEqual(e.body, { 9: { r: { fire: 1 }, c: 1, v: 0 } });
});

test('live presence, visits and the leaderboard', async () => {
  const first = await call(live.POST, 'POST', '/api/live', { guest: A, post: 11, view: true, name: 'علی' });
  assert.equal(first.status, 200);
  assert.ok(first.body.online >= 1 && first.body.total >= 1 && first.body.today >= 1);
  assert.equal(first.body.views, 1);
  const beat = await call(live.POST, 'POST', '/api/live', { guest: B });
  assert.equal(beat.body.online, 2);
  assert.equal(beat.body.total, undefined, 'heartbeats do not count as visits');

  // Like X: one reader is one view per post (and one visit to the site) per 24 hours, however often they reload.
  const again = await call(live.POST, 'POST', '/api/live', { guest: A, post: 11, view: true });
  assert.equal(again.body.views, 1);
  assert.equal(again.body.total, first.body.total);
  const other = await call(live.POST, 'POST', '/api/live', { guest: B, post: 11, view: true });
  assert.equal(other.body.views, 2);
  assert.equal(other.body.total, first.body.total + 1);
  assert.equal(other.body.today, 2);
  const elsewhere = await call(live.POST, 'POST', '/api/live', { guest: A, post: 12, view: true });
  assert.equal(elsewhere.body.views, 1, 'a reader counts once on each post they open');
  assert.equal(elsewhere.body.total, other.body.total, '… but once for the site');
  assert.equal((await call(engage.GET, 'GET', '/api/engage?ids=11,12')).body[11].v, 2);

  // Posts read before the 24-hour rule start from the readers who opened them, not the old page-load counter.
  const lib = await import('../api/_lib.js');
  await lib.redis(['SADD', 'v:40', 'r1'], ['SADD', 'v:40', 'r2'], ['HINCRBY', 'h:views', '40', '57']);
  assert.equal((await call(engage.GET, 'GET', '/api/engage?ids=40')).body[40].v, 2);
  assert.equal((await call(live.POST, 'POST', '/api/live', { guest: B, post: 40, view: true })).body.views, 3);

  const real = _memory.now;
  _memory.now = () => real() + 25 * 3600_000;
  try {
    const tomorrow = await call(live.POST, 'POST', '/api/live', { guest: A, post: 11, view: true });
    assert.equal(tomorrow.body.views, 3, 'a day later the same reader counts again');
    assert.equal(tomorrow.body.total, other.body.total + 1);
  } finally {
    _memory.now = real;
  }

  const board = await call(leaders.GET, 'GET', '/api/leaders');
  assert.equal(board.body.week[0].name, 'علی');
  assert.ok(board.body.week[0].points >= 1);
});

test('chat: post, list, limits', async () => {
  const sent = await call(chat.POST, 'POST', '/api/chat', { guest: A, name: 'علی', text: 'سلام\nبه همه' });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.text, 'سلام به همه');
  assert.equal(typeof sent.body.message.c, 'number');
  assert.equal((await call(chat.POST, 'POST', '/api/chat', { guest: A, text: '   ' })).status, 400);
  const list = await call(chat.GET, 'GET', '/api/chat');
  assert.equal(list.body.messages[0].text, 'سلام به همه');
  const beat = await call(live.POST, 'POST', '/api/live', { guest: B });
  assert.equal(beat.body.chat, sent.body.message.id, 'heartbeat carries the newest chat id');

  const burst = [];
  for (let i = 0; i < 10; i++) {
    burst.push((await chat.POST(req('POST', '/api/chat', { guest: B, text: `پیام ${i}` }, { 'x-forwarded-for': '9.9.9.9' }))).status);
  }
  assert.ok(burst.includes(429), 'rate limited per guest');

  // Readers behind one VPN exit / carrier NAT share an IP and must not throttle each other.
  const shared = [];
  for (let i = 0; i < 10; i++) {
    const g = `shared-guest-${String(i).padStart(4, '0')}`;
    shared.push((await chat.POST(req('POST', '/api/chat', { guest: g, text: 'سلام' }, { 'x-forwarded-for': '8.8.4.4' }))).status);
    shared.push((await live.POST(req('POST', '/api/live', { guest: g, view: true }, { 'x-forwarded-for': '8.8.4.4' }))).status);
  }
  assert.ok(shared.every((s) => s < 400), 'one shared IP is not one reader');
});

test('CORS preflight', async () => {
  const res = await chat.OPTIONS(req('OPTIONS', '/api/chat', null, { origin: 'https://example.github.io' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('sync: starts one crawl, not while one runs or right after one', async () => {
  const off = await import('../api/sync.js?off');
  assert.equal((await call(off.GET, 'GET', '/api/sync')).status, 501, 'no token: the button stays hidden');

  process.env.GITHUB_DISPATCH_TOKEN = 'gh-token';
  const sync = await import('../api/sync.js?on');
  const realFetch = globalThis.fetch;
  let runs = [];
  const dispatched = [];
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.headers.Authorization, 'Bearer gh-token');
    if (String(url).endsWith('/dispatches')) {
      dispatched.push(JSON.parse(init.body));
      runs = [{ status: 'queued' }, ...runs];
      return new Response(null, { status: 204 });
    }
    return Response.json({ workflow_runs: runs });
  };
  try {
    const hourAgo = new Date(Date.now() - 36e5).toISOString();
    runs = [{ status: 'completed', conclusion: 'success', updated_at: hourAgo }];
    const st = await call(sync.GET, 'GET', '/api/sync');
    assert.deepEqual(st.body, { running: false, last: hourAgo });
    assert.match(st.res.headers.get('cache-control'), /s-maxage=15/);

    const first = await call(sync.POST, 'POST', '/api/sync', { guest: A });
    assert.equal(first.body.queued, true);
    assert.deepEqual(dispatched, [{ ref: 'main' }]);
    const again = await call(sync.POST, 'POST', '/api/sync', { guest: B });
    assert.deepEqual([again.body.queued, again.body.running], [false, true], 'already queued: nothing new starts');

    runs = [{ status: 'completed', conclusion: 'success', updated_at: new Date().toISOString() }];
    assert.equal((await call(sync.POST, 'POST', '/api/sync', { guest: B })).body.queued, false, 'a crawl just finished');
    assert.equal(dispatched.length, 1);
    assert.equal((await call(sync.POST, 'POST', '/api/sync', { guest: 'nope' })).status, 400);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

test('watch: a crawl once the newest post has its comment (or after a grace), and for a late comment', async () => {
  const off = await import('../api/watch.js?off');
  assert.equal((await call(off.GET, 'GET', '/api/watch')).status, 501, 'not configured');

  process.env.GITHUB_DISPATCH_TOKEN = 'gh-token';
  process.env.WATCH_SECRET = 'watch-secret';
  const watch = await import('../api/watch.js?on');
  const realFetch = globalThis.fetch;
  const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
  const post = (id, at) =>
    `<div class="tgme_widget_message js-widget_message" data-post="dlmehr/${id}"><div class="tgme_widget_message_text js-message_text">x</div>` +
    `<a class="tgme_widget_message_date" href="https://t.me/dlmehr/${id}"><time datetime="${at}" class="time">1</time></a></div>`;
  const discussion = (at) =>
    `<div class="tgme_widget_message" data-post="dlmehr/1"></div><div class="tme_widget_discussion">` +
    (at
      ? `<div class="tgme_widget_message js-widget_message" data-post-id="9"><div class="tgme_widget_message_author">` +
        `<span class="tgme_widget_message_author_name">غلام</span></div><div class="js-message_text">ببین…<br/>--داش غلام</div>` +
        `<time datetime="${at}"></time></div>`
      : '') +
    `</div>`;
  let channel = '';
  let comments = {};
  let runs = [];
  const dispatched = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://t.me/s/')) return new Response(channel);
    if (url.startsWith('https://t.me/')) return new Response(discussion(comments[url.match(/dlmehr\/(\d+)/)[1]]));
    assert.equal(init.headers.Authorization, 'Bearer gh-token');
    if (url.endsWith('/dispatches')) {
      dispatched.push(url);
      runs = [{ status: 'queued', conclusion: null, created_at: new Date().toISOString() }, ...runs];
      return new Response(null, { status: 204 });
    }
    return Response.json({ workflow_runs: runs });
  };
  const tick = async () => (await call(watch.GET, 'GET', '/api/watch?key=watch-secret')).body;
  try {
    assert.equal((await call(watch.GET, 'GET', '/api/watch?key=nope')).status, 401);
    const auth = await call(watch.GET, 'GET', '/api/watch', null, { authorization: 'Bearer watch-secret' });
    assert.equal(auth.status, 200, 'the secret also works as a bearer token');

    runs = [{ status: 'completed', conclusion: 'success', created_at: ago(600) }];
    channel = post(100, ago(7200)) + post(101, ago(20));
    assert.deepEqual(await tick(), { queued: false, reason: null }, 'a new post waits for Gholam');
    comments[101] = ago(5);
    assert.deepEqual(await tick(), { queued: true, reason: 'post 101' });
    assert.deepEqual(await tick(), { queued: false, reason: null }, 'that crawl has it');

    runs = [{ status: 'completed', conclusion: 'success', created_at: ago(250) }];
    channel = post(100, ago(7200)) + post(102, ago(200));
    assert.deepEqual(await tick(), { queued: true, reason: 'post 102' }, 'no comment after the grace (a digest)');

    runs = [{ status: 'completed', conclusion: 'success', created_at: ago(30) }];
    comments[102] = ago(10);
    assert.deepEqual(await tick(), { queued: true, reason: 'gholam 102' }, 'a comment after the last crawl');
    assert.equal(dispatched.length, 3);

    assert.deepEqual(watch.parseChannel(post(7, '2026-10-20T15:31:00+00:00')), [{ id: 7, at: Date.parse('2026-10-20T15:31:00Z') }]);
    assert.equal(watch.parseGholam(discussion(null)), 0);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GITHUB_DISPATCH_TOKEN;
    delete process.env.WATCH_SECRET;
  }
});
