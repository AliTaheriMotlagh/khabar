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
