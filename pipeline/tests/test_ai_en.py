from pipeline import ai_en


def post(**kw):
    return {"id": 1, "date": "2026-11-24T10:00:00+00:00", "text": "", **kw}


def test_source_text_from_tweet_and_article():
    p = post(links=[{"kind": "tweet", "text": "NVIDIA unveils its next chip, twice as fast as the last one https://t.co/x", "author": {"name": "NVIDIA"}},
                    {"kind": "link", "title": "NVIDIA's new chip", "description": "Faster and cheaper."}])
    t = ai_en.source_text(p)
    assert t.startswith("Post by NVIDIA: NVIDIA unveils")
    assert "https://" not in t and "Article: NVIDIA's new chip" in t


def test_no_english_source():
    assert ai_en.source_text(post(links=[{"kind": "tweet", "text": "این یک متن فارسی است که منبع انگلیسی ندارد و طولانی است"}])) is None
    assert ai_en.source_text(post(digest=True, links=[{"kind": "tweet", "text": "x" * 100}])) is None


def test_problems():
    assert ai_en.problems({"title": "NVIDIA unveils a chip twice as fast as its last", "short": "NVIDIA's faster chip"}) == []
    assert "emoji or hashtag" in ai_en.problems({"title": "NVIDIA unveils a new chip today 🚀 #AI", "short": "New chip"})
    assert "title not English" in ai_en.problems({"title": "انویدیا تراشه‌ی تازه‌ای معرفی کرد امروز", "short": "x" * 10})
