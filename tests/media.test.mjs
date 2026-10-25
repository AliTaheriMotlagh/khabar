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
