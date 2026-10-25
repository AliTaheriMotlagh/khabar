"""Offline tests for the parsers and shaping. Run: python -m pytest pipeline/tests  (or python -m pipeline.tests.test_pipeline)"""
from __future__ import annotations

from pipeline import enrich, run, shape, telegram

CHANNEL_HTML = """
<div class="tgme_channel_info">
  <div class="tgme_channel_info_header"><i class="tgme_page_photo_image"><img src="https://cdn4.telesco.pe/file/avatar.jpg"></i>
  <div class="tgme_channel_info_header_title"><span dir="auto">Future Focus with Mehrzad</span></div></div>
  <div class="tgme_channel_info_description">AI &amp; future tech</div>
  <div class="tgme_channel_info_counters"><div class="tgme_channel_info_counter"><span class="counter_value">1.2K</span> <span class="counter_type">subscribers</span></div></div>
</div>
<section class="tgme_channel_history js-message_history">
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="dlmehr/1500" data-view="x">
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_text js-message_text" dir="auto"><a href="https://fxtwitter.com/dunyaverse/status/2112586895100449083?s=52&amp;t=F41Q" target="_blank" rel="noopener">https://fxtwitter.com/dunyaverse/status/2112586895100449083?s=52&amp;t=F41Q</a></div>
    <a class="tgme_widget_message_link_preview" href="https://fxtwitter.com/dunyaverse/status/2112586895100449083?s=52&amp;t=F41Q">
      <i class="link_preview_image" style="background-image:url('https://cdn4.telesco.pe/file/preview.jpg')"></i>
      <div class="link_preview_site_name accent_color" dir="auto">FxTwitter</div>
      <div class="link_preview_title" dir="auto">Dünya Baradari (@dunyaverse)</div>
      <div class="link_preview_description" dir="auto">Today we introduce Plato: the ring for near-silent speech.<br/><br/>Order now</div>
    </a>
    <div class="tgme_widget_message_footer compact js-message_footer"><div class="tgme_widget_message_info short js-message_info">
      <span class="tgme_widget_message_views">30</span><span class="copyonly"> views</span>
      <span class="tgme_widget_message_meta">edited <a class="tgme_widget_message_date" href="https://t.me/dlmehr/1500"><time datetime="2026-10-20T15:31:00+00:00" class="time">15:31</time></a></span>
    </div></div>
  </div>
</div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="dlmehr/1501">
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_grouped_wrap"><div class="tgme_widget_message_grouped">
      <a class="tgme_widget_message_photo_wrap grouped_media_wrap" href="https://t.me/dlmehr/1501?single" style="width:300px;background-image:url('https://cdn4.telesco.pe/file/p1.jpg')"></a>
      <a class="tgme_widget_message_video_player grouped_media_wrap" href="https://t.me/dlmehr/1502?single">
        <i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn4.telesco.pe/file/v1thumb.jpg')"></i>
        <div class="tgme_widget_message_video_wrap" style="padding-top:56.25%"><video src="https://cdn4.telesco.pe/file/v1.mp4" class="tgme_widget_message_video js-message_video"></video></div>
        <time class="message_video_duration js-message_video_duration">1:16</time>
      </a>
    </div></div>
    <div class="tgme_widget_message_text js-message_text" dir="auto">Big news from <a href="https://openai.com/blog/x">OpenAI</a> today<br/>see https://example.com/a.</div>
    <div class="tgme_widget_message_footer"><span class="tgme_widget_message_views">1.4K</span>
      <a class="tgme_widget_message_date" href="https://t.me/dlmehr/1501"><time datetime="2026-10-20T16:00:00+00:00">16:00</time></a></div>
  </div>
</div></div>
</section>
"""

DISCUSSION_HTML = """
<div class="tgme_widget_message" data-post="dlmehr/1500"><div class="tgme_widget_message_text">original post</div></div>
<div class="tme_widget_discussion">
 <div class="tgme_widget_message js-widget_message" data-post-id="88">
  <div class="tgme_widget_message_author"><span class="tgme_widget_message_author_name" dir="auto">غلام</span></div>
  <div class="tgme_widget_message_reply_template js-reply_tpl"><div class="tgme_widget_message_text js-message_reply_text" dir="auto">ببین آبجی، وسط کنفرانس…</div></div>
  <div class="tgme_widget_message_text js-message_text" dir="auto">ببین آبجی، وسط کنفرانس بزرگ انویدیا در برلین چند تا معترض پریدند وسط. رئیس انویدیا خونسرد موند.<br/><br/>چرا مهمه؟ نشون میده تحریم‌ها کار نمی‌کنه.<br/>--داش غلام</div>
  <time datetime="2026-10-20T15:39:00+00:00"></time>
 </div>
</div>
"""


def test_channel_page():
    info, posts = telegram.parse_channel_page(CHANNEL_HTML)
    assert info["title"] == "Future Focus with Mehrzad"
    assert info["avatar"].endswith("avatar.jpg")
    assert info["subscribers"] == "1.2K"
    assert [p.id for p in posts] == [1500, 1501]

    p = posts[0]
    assert p.date.startswith("2026-10-20T15:31")
    assert p.links[0].startswith("https://fxtwitter.com/dunyaverse/status/2112586895100449083")
    assert p.preview["title"] == "Dünya Baradari (@dunyaverse)"
    assert p.preview["image"].endswith("preview.jpg")

    q = posts[1]
    assert [m.type for m in q.media] == ["image", "video"]
    assert q.media[1].url.endswith("v1.mp4") and q.media[1].thumb.endswith("v1thumb.jpg") and q.media[1].duration == "1:16"
    assert q.media[1].ratio == 0.5625 and q.media[0].ratio is None
    assert "OpenAI (https://openai.com/blog/x)" in q.text
    assert q.links == ["https://openai.com/blog/x", "https://example.com/a"]


def test_gholam_comment():
    c = telegram.parse_gholam_comment(DISCUSSION_HTML)
    assert c is not None
    assert c["text"].startswith("ببین آبجی") and "رئیس انویدیا خونسرد موند" in c["text"]  # full text, not the reply preview
    assert "داش غلام" not in c["text"]
    assert c["date"] == "2026-10-20T15:39:00+00:00"
    assert telegram.parse_gholam_comment("<div class='tgme_widget_message'><div class='tgme_widget_message_text'>hi</div></div>") is None


def test_shape():
    c = telegram.parse_gholam_comment(DISCUSSION_HTML)
    paras, why = shape.split_gholam(c["text"])
    assert why == "نشون میده تحریم‌ها کار نمی‌کنه."
    assert len(paras) == 1
    title = shape.headline(paras)
    assert title.startswith("وسط کنفرانس بزرگ انویدیا"), title
    assert not title.endswith(".")
    assert shape.tags(c["text"], title=title)[0] == "انویدیا"
    assert shape.tags("during the morning") == []  # whole-word match: no false "ring" → گجت
    assert "گجت" in shape.tags("Plato: smart glasses for near-silent speech", "یه عینک هوشمند تازه")


def test_tags_are_whole_words_and_need_more_than_a_passing_mention():
    # «فضای مجازی» is cyberspace, «اپلیکیشن» an app, «متاسفانه» "unfortunately", «اوپن‌سورس» open source.
    for text in ("فضای مجازی شلوغه", "این اپلیکیشن رو ببین", "متاسفانه نشد", "یه مدل اوپن‌سورس"):
        assert shape.tags(text, text) == [], text
    assert shape.tags("Moonshot raises concerns", "Moonshot raises concerns") == ["چین"]  # not space, not funding
    # Named in Gholam's Persian and the English source: the topic. A single comparison: not a topic.
    kimi = "Moonshot's Kimi K3.1 beats OpenAI's latest model on 6 benchmarks"
    assert shape.tags(kimi, "مون‌شات با کیمی حسابی گردوخاک کرده") == ["چین"]
    assert shape.tags("یه حفره امنیتی تو کروم", "hackers exploit a Chrome zero-day", title="حفره امنیتی کروم") == ["امنیت"]
    assert shape.tags("ربات‌های انسان‌نما", "Humanoid robots are coming", title="ربات‌ها")[0] == "رباتیک"


def test_digest_has_no_tags():
    post = {"id": 1, "text": "24-hour news summary.\n1 — OpenAI, Google, Apple and Nvidia …", "digest": True, "links": []}
    assert run.build_article(post)["tags"] == []


def test_headline_is_never_cut_mid_sentence():
    long = "رفیق، بچه‌های پلتفرم ابری Railway یه آژیر خطر فوری کشیدن و اعلام کردن که توی سیستم‌هاشون تحرکات مشکوک و غیرعادی ردیابی شده. بقیه‌اش"
    assert shape.headline([long]) == "بچه‌های پلتفرم ابری Railway یه آژیر خطر فوری کشیدن و اعلام کردن که توی سیستم‌هاشون تحرکات مشکوک و غیرعادی ردیابی شده"
    clause = "بچه‌های دیپ‌مایند گوگل یه مقاله دادن بیرون و رفتن سراغ یه روش باحال" + "؛ " + "فرض کن " * 40
    assert shape.headline([clause]) == "بچه‌های دیپ‌مایند گوگل یه مقاله دادن بیرون و رفتن سراغ یه روش باحال"
    runaway = shape.headline(["کلمه " * 100])
    assert runaway.endswith("…") and len(runaway) <= shape.HEADLINE_MAX + 1


def test_tweet_regex_and_variant():
    m = enrich.TWEET_RE.search("https://fxtwitter.com/dunyaverse/status/2112586895100449083?s=52")
    assert m.group(1) == "dunyaverse" and m.group(2) == "2112586895100449083"
    v = enrich.pick_video_variant(
        {
            "url": "https://video.twimg.com/x/vid/avc1/2560x1440/big.mp4",
            "formats": [
                {"url": "https://video.twimg.com/x/pl/a.m3u8", "container": "m3u8"},
                {"url": "https://video.twimg.com/x/vid/avc1/640x360/a.mp4", "bitrate": 832000, "container": "mp4"},
                {"url": "https://video.twimg.com/x/vid/avc1/1280x720/b.mp4", "bitrate": 2176000, "container": "mp4"},
                {"url": "https://video.twimg.com/x/vid/avc1/1920x1080/c.mp4", "bitrate": 5000000, "container": "mp4"},
            ],
        }
    )
    assert v.endswith("1280x720/b.mp4")


def test_tweet_media_keeps_urls():
    items = enrich._tweet_media(
        {
            "all": [
                {"type": "photo", "url": "https://pbs.twimg.com/media/a.jpg", "width": 1200, "height": 675},
                {"type": "gif", "url": "https://video.twimg.com/g.mp4", "thumbnail_url": "https://pbs.twimg.com/g.jpg", "width": 400, "height": 400},
            ]
        }
    )
    assert items[0] == {"type": "image", "src": "https://pbs.twimg.com/media/a.jpg", "ratio": 0.5625}
    assert items[1]["src"] == "https://video.twimg.com/g.mp4" and items[1]["poster"].endswith("g.jpg") and items[1]["gif"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)


def test_digest_detection():
    assert run.DIGEST_RE.search("24-hour news summary.\n\n1 — Unitree unveiled H2-X")
    assert run.DIGEST_RE.search("خلاصه اخبار ۲۴ ساعت گذشته")
    assert not run.DIGEST_RE.search("OpenAI shipped a new model today")


def test_resigned_cdn_url_alone_is_not_a_change():
    from datetime import datetime, timedelta, timezone

    ago = lambda h: (datetime.now(timezone.utc) - timedelta(hours=h)).isoformat(timespec="seconds")
    old = {"id": 1, "text": "hi", "preview": {"image": "https://cdn4.telesco.pe/file/AAA"}, "updated": ago(1)}
    resigned = {**old, "preview": {"image": "https://cdn4.telesco.pe/file/BBB"}}
    stale = {**old, "updated": ago(run.config.URL_REFRESH_HOURS + 1)}
    assert not run.needs_save(dict(old), old)
    assert not run.needs_save(resigned, old)
    assert run.needs_save(resigned, old, refresh_urls=True)
    assert run.needs_save({**old, "text": "edited"}, old)
    assert run.needs_save(resigned, {})
    plain = {"id": 2, "text": "no telegram media", "updated": ago(run.config.URL_REFRESH_HOURS + 1)}
    assert not run.needs_save(dict(plain), plain, refresh_urls=True)

    # One stale post refreshes them all, so URL-only saves land on one run instead of being spread over many.
    assert not run.urls_due([old, plain, None])
    assert run.urls_due([old, stale])


def test_no_catch_all_ai_tag():
    assert "هوش مصنوعی" not in shape.tags("OpenAI's new LLM agent", "یه مدل هوش مصنوعی تازه")
    assert "اوپن‌ای‌آی" in shape.tags("OpenAI's new LLM agent", title="OpenAI's new LLM agent")


def test_backfill_checks_old_posts_once(tmp_path, monkeypatch):
    import json
    from datetime import datetime, timezone

    monkeypatch.setattr(run.config, "POSTS_DIR", tmp_path)
    base = {"url": "u", "date": "2026-10-14T19:00:00+00:00", "links": [], "media": [], "preview": None}
    fresh = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run.save({**base, "id": 4, "date": fresh, "text": "https://x.com/c/status/4", "gholam": None})
    run.save({**base, "id": 1, "text": "https://x.com/a/status/1", "gholam": None})
    run.save({**base, "id": 2, "text": "https://x.com/b/status/2", "gholam": None})
    run.save({**base, "id": 3, "text": "24-hour news summary", "digest": True, "gholam": None})
    asked = []
    found = {1: {"text": "ببین رفیق، یه مدل تازه اومده. چرا مهمه؟ چون ارزونه.", "date": None}}
    monkeypatch.setattr(run.telegram, "fetch_gholam_comment", lambda http, pid: asked.append(pid) or found.get(pid))

    run.backfill_gholam(None)
    assert sorted(asked) == [1, 2], "digests and posts still polled by process() are skipped"
    one = json.loads((tmp_path / "1.json").read_text("utf-8"))
    assert one["gholam"]["text"].startswith("ببین") and one["article"]["title"].startswith("یه مدل تازه")
    assert json.loads((tmp_path / "2.json").read_text("utf-8"))["gholam_checked"]

    asked.clear()
    run.backfill_gholam(None)
    assert asked == [], "each post is only checked once"


def test_backfill_retries_a_failed_look(tmp_path, monkeypatch):
    import json

    import httpx

    monkeypatch.setattr(run.config, "POSTS_DIR", tmp_path)
    run.save({"id": 1, "url": "u", "date": "2026-10-14T19:00:00+00:00", "text": "https://x.com/a/status/1", "links": [], "media": [], "preview": None, "gholam": None})

    def blocked(http, pid):
        raise httpx.HTTPStatusError("429", request=httpx.Request("GET", "https://t.me"), response=httpx.Response(429))

    monkeypatch.setattr(run.telegram, "fetch_gholam_comment", blocked)
    run.backfill_gholam(None)
    assert "gholam_checked" not in json.loads((tmp_path / "1.json").read_text("utf-8")), "a failed look is asked again"


def test_client_waits_out_rate_limits(monkeypatch):
    import httpx

    answers = [httpx.Response(429, headers={"Retry-After": "0"}), httpx.Response(503), httpx.Response(200, text="ok")]
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", lambda self, req: answers.pop(0))
    monkeypatch.setattr(telegram.time, "sleep", lambda s: None)
    with telegram.client() as http:
        assert http.get("https://t.me/s/dlmehr").text == "ok"
    assert not answers
