// /api/media: a fresh Telegram CDN URL for a post's n-th media item, in the crawler's order (photos, then videos).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const media = await import('../api/media.js');

// Same shape as the album in pipeline/tests/test_pipeline.py, plus a video Telegram won't play on the web.
const EMBED = `
<div class="tgme_widget_message_grouped">
  <a class="tgme_widget_message_video_player grouped_media_wrap" href="https://t.me/dlmehr/1502?single">
    <i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn4.telesco.pe/file/v1thumb.jpg')"></i>
    <div class="tgme_widget_message_video_wrap" style="padding-top:56.25%"><video src="https://cdn4.telesco.pe/file/v1.mp4?token=a&amp;b=1" class="tgme_widget_message_video js-message_video"></video></div>
  </a>
  <a class="tgme_widget_message_photo_wrap grouped_media_wrap" href="https://t.me/dlmehr/1501?single" style="width:300px;background-image:url('https://cdn4.telesco.pe/file/p1.jpg')"></a>
  <a class="tgme_widget_message_video_player not_supported" href="https://t.me/dlmehr/1503">
    <i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn4.telesco.pe/file/big-thumb.jpg')"></i>
  </a>
</div>
<a class="tgme_widget_message_link_preview" href="https://x.com"><i class="link_preview_image" style="background-image:url('https://cdn4.telesco.pe/file/preview.jpg')"></i></a>`;

test('parses media in the crawler order', () => {
  assert.deepEqual(media.parseMedia(EMBED), [
    { src: 'https://cdn4.telesco.pe/file/p1.jpg', poster: null },
    { src: 'https://cdn4.telesco.pe/file/v1.mp4?token=a&b=1', poster: 'https://cdn4.telesco.pe/file/v1thumb.jpg' },
    { src: 'https://cdn4.telesco.pe/file/big-thumb.jpg', poster: null },
  ]);
  assert.deepEqual(media.parseMedia('<div>no media</div>'), []);
  assert.equal(media.parsePreview(EMBED), 'https://cdn4.telesco.pe/file/preview.jpg');
  assert.equal(media.parsePreview('<div></div>'), null);
});

test('redirects to the current URL, cached; 404 and 400 otherwise', async () => {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => (asked.push(String(url)), new Response(EMBED));
  try {
    const get = (q) => media.GET(new Request(`https://site.test/api/media/?${q}`));
    let res = await get('p=1501&i=1&f=poster');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://cdn4.telesco.pe/file/v1thumb.jpg');
    assert.match(res.headers.get('cache-control'), /s-maxage=3600/);
    assert.equal(asked[0], 'https://t.me/dlmehr/1501?embed=1&mode=tme');
    res = await get('p=1501&i=0');
    assert.equal(res.headers.get('location'), 'https://cdn4.telesco.pe/file/p1.jpg');
    assert.equal((await get('p=1501&f=preview')).headers.get('location'), 'https://cdn4.telesco.pe/file/preview.jpg');
    assert.equal((await get('p=1501&i=7')).status, 404);
    assert.equal((await get('p=abc&i=0')).status, 400);
    assert.equal((await get('p=1501')).status, 400);
    globalThis.fetch = async () => new Response('down', { status: 500 });
    res = await get('p=1501&i=0');
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  } finally {
    globalThis.fetch = real;
  }
});

test('/api/img relays pictures from the channel CDNs only, cached for good', async () => {
  const img = await import('../api/img.js');
  const real = globalThis.fetch;
  const asked = [];
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url).startsWith('https://t.me/')) return new Response(EMBED);
    if (String(url).endsWith('.html')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
    if (String(url).includes('missing-in-wsrv') && String(url).startsWith('https://wsrv.nl/')) return new Response('', { status: 502 });
    if (String(url).includes('missing-in-wsrv')) return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
    if (String(url).includes('missing')) return new Response('', { status: 404 });
    return new Response(JPEG, { headers: { 'content-type': 'image/jpeg', 'content-length': String(JPEG.length) } });
  };
  try {
    const get = (q) => img.GET(new Request(`https://site.test/api/img/?${q}`));
    let res = await get(`u=${encodeURIComponent('https://pbs.twimg.com/media/abc.jpg?name=small')}&w=320`);
    assert.equal(res.status, 200);
    assert.equal(asked.at(-1), `https://wsrv.nl/?url=${encodeURIComponent('https://pbs.twimg.com/media/abc.jpg?name=small')}&w=320&we&output=webp&q=80`, 'resized on the way');
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('cache-control'), /s-maxage=31536000/);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), JPEG);
    // A post's Telegram picture by index: looked up like /api/media, then relayed.
    res = await get('p=1501&i=1&f=poster');
    assert.equal(res.status, 200);
    assert.equal(asked.at(-1), 'https://cdn4.telesco.pe/file/v1thumb.jpg');
    // The resizer failing: the original instead. A width the site doesn't use is ignored.
    asked.length = 0;
    res = await get(`u=${encodeURIComponent('https://pbs.twimg.com/media/missing-in-wsrv.jpg')}&w=800`);
    assert.equal(res.status, 200);
    assert.deepEqual(asked, [`https://wsrv.nl/?url=${encodeURIComponent('https://pbs.twimg.com/media/missing-in-wsrv.jpg')}&w=800&we&output=webp&q=80`, 'https://pbs.twimg.com/media/missing-in-wsrv.jpg']);
    asked.length = 0;
    await get(`u=${encodeURIComponent('https://pbs.twimg.com/media/abc.jpg')}&w=999`);
    assert.deepEqual(asked, ['https://pbs.twimg.com/media/abc.jpg']);
    assert.equal((await get('p=1501&i=7')).status, 404);
    // Not an open proxy, and only pictures.
    assert.equal((await get(`u=${encodeURIComponent('https://evil.example/x.jpg')}`)).status, 403);
    assert.equal((await get(`u=${encodeURIComponent('http://pbs.twimg.com/media/abc.jpg')}`)).status, 403);
    assert.equal((await get(`u=${encodeURIComponent('https://pbs.twimg.com.evil.example/x.jpg')}`)).status, 403);
    assert.equal((await get(`u=${encodeURIComponent('https://pbs.twimg.com/page.html')}`)).status, 415);
    assert.equal((await get(`u=${encodeURIComponent('https://pbs.twimg.com/missing.jpg')}`)).status, 404);
    assert.equal((await get('p=x')).status, 400);
  } finally {
    globalThis.fetch = real;
  }
});
