"""Offline tests for the model's later work (PLAN.md P2): what's asked, what's kept, what's spelled without a model."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from pipeline import ai, ai_more, comments, daily, related, videos


def test_numbers_and_acronyms_need_no_model():
    assert ai_more.num_fa(0) == "صفر"
    assert ai_more.num_fa(21) == "بیست و یک"
    assert ai_more.num_fa(1000) == "هزار"
    assert ai_more.num_fa(2026) == "دو هزار و بیست و شش"
    assert ai_more.num_fa(3_500_000) == "سه میلیون و پانصد هزار"
    assert ai_more.spell("GPT-5.2") == "جی پی تی پنج ممیز دو"
    assert ai_more.spell("$15") == "پانزده دلار"
    assert ai_more.spell("$2.5B") == "دو ممیز پنج میلیارد دلار"
    assert ai_more.spell("H100") == "اِچ صد"
    assert ai_more.spell("HTML") == "اِچ تی اِم اِل"
    # Words, not acronyms: the model says them.
    for word in ("Claude", "CUDA", "ROOST", "OpenAI", "GPT-4o"):
        assert ai_more.spell(word) is None


def test_latin_terms_word_by_word_without_handles():
    assert ai_more.latin_terms("کلود کد (Claude Code) از @rohan_ai و snake_case و GPT-5.2، $2.5B.") == ["Claude", "Code", "GPT-5.2", "$2.5B"]


def test_speech_todo_spells_what_it_can_and_asks_the_rest():
    lex: dict = {"claude": "کلود"}
    post = {"id": 1, "text": "", "article": {"title": "Claude و GPT-5 و Anthropic", "body": ["MIT و Claude"], "why": None}, "gholam": {"text": "x"}}
    todo = ai_more.speech_todo(post, lex)
    assert todo == ["Anthropic"]
    assert lex["GPT-5"] == "جی پی تی پنج" and lex["MIT"] == "اِم آی تی"


def test_tidy_x_keeps_the_good_parts():
    out = ai_more.tidy_x({
        "importance": 4,
        "entities": [{"name_en": "OpenAI", "name_fa": "اوپن‌ای‌آی", "kind": "company"}, {"name_en": "OpenAI", "name_fa": "اوپن", "kind": "company"},
                     {"name_en": "اوپن", "name_fa": "x", "kind": "company"}, {"name_en": "Sam Altman", "name_fa": "سم آلتمن", "kind": "boss"}],
        "terms": [{"term": "توکن", "def": "کوچک‌ترین تکه‌ی متن که مدل زبانی می‌خواند و می‌نویسد."}, {"term": "x", "def": "short"}],
        "simple": "",
        "quiz": {"q": "کدام؟", "options": ["الف", "الف", "ب"], "answer": 0},
        "video": {"hook": "یک جمله‌ی گیرا برای شروع", "points": ["نکته‌ی اول خبر", "نکته‌ی دوم خبر", "نکته‌ی سوم خبر"], "why": "چون مهم است"},
        "share": "یک متن کوتاه برای اشتراک\n#هوش_مصنوعی",
    })
    assert out["importance"] == 4
    assert [e["name_en"] for e in out["entities"]] == ["OpenAI"]
    assert [t["term"] for t in out["terms"]] == ["توکن"]
    assert out["simple"] is None and out["quiz"] is None  # empty; two equal options
    assert out["video"]["points"][2] == "نکته‌ی سوم خبر"
    assert out["share"].startswith("یک متن")


def test_story_only_without_gholam_and_after_a_while():
    old = "2026-01-01T00:00:00+00:00"
    tweet = {"kind": "tweet", "url": "https://x.com/a/status/1", "domain": "x.com", "author": {"name": "Ann"},
             "text": "We are releasing a new open model today with 70B parameters that beats every other open model on coding benchmarks by a wide margin, and it is free to download."}
    post = {"id": 5, "date": old, "text": "", "links": [tweet], "article": {"title": "t", "body": []}}
    assert ai_more.story_due(post)
    assert "Ann" in ai_more.story_input(post)
    assert not ai_more.story_due({**post, "gholam": {"text": "رفقا، یه مدل تازه اومده"}})
    assert not ai_more.story_due({**post, "date": datetime.now(timezone.utc).isoformat()})
    assert not ai_more.story_due({**post, "links": [{**tweet, "text": "short"}]})
    # Done once; done again only when the source changes.
    post["ai"] = {"story": {"v": ai_more.STORY_V, "src": ai.input_hash(ai_more.story_input(post)), "body": ["…"]}}
    assert not ai_more.story_due(post)


def test_headline_redone_keeps_the_later_answers():
    post = {"ai": {"title": "old", "x": {"importance": 3}, "story": {"body": ["a"]}, "speech": {"v": 1}}}
    assert ai.merged(post, {"title": "new", "v": 1}) == {"title": "new", "v": 1, "x": {"importance": 3}, "story": {"body": ["a"]}, "speech": {"v": 1}}


def test_remember_adds_new_terms_and_names_once(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_more, "GLOSSARY", tmp_path / "glossary.json")
    monkeypatch.setattr(ai_more, "ENTITIES", tmp_path / "entities.json")
    (tmp_path / "entities.json").write_text(json.dumps({"entities": [{"slug": "openai", "name_en": "OpenAI", "name_fa": "اوپن‌ای‌آی", "kind": "company"}]}))
    posts = [
        {"id": 2, "ai": {"x": {"terms": [{"term": "توکن", "def": "اولی"}], "entities": [{"name_en": "Open AI", "name_fa": "اوپن", "kind": "company"}, {"name_en": "Sam Altman", "name_fa": "سم آلتمن", "kind": "person"}]}}},
        {"id": 3, "ai": {"x": {"terms": [{"term": "توکن", "def": "دومی"}], "entities": [{"name_en": "Sam Altman", "name_fa": "آلتمن", "kind": "person"}]}}},
    ]
    assert ai_more.remember(posts) == (1, 2)
    g = json.loads((tmp_path / "glossary.json").read_text())
    e = json.loads((tmp_path / "entities.json").read_text())
    assert g["terms"] == [{"term": "توکن", "def": "اولی"}]
    assert [x["slug"] for x in e["entities"]] == ["openai", "open-ai", "sam-altman"]
    assert ai_more.remember(posts) == (0, 0)


def test_related_and_clusters(tmp_path, monkeypatch):
    monkeypatch.setattr(related, "VECTORS", tmp_path / "v.json")
    monkeypatch.setattr(related, "CLUSTER_SIM", 0.95)
    monkeypatch.setattr(related, "RELATED_SIM", 0.5)
    vec = {1: [1, 0, 0], 2: [0.99, 0.1, 0], 3: [0.7, 0.7, 0], 4: [0, 0, 1], 5: [1, 0.01, 0]}
    day = lambda d: f"2026-11-{d:02d}T10:00:00+00:00"
    dates = {1: day(1), 2: day(1), 3: day(2), 4: day(2), 5: day(9)}
    posts = [{"id": i, "date": dates[i], "article": {"title": f"t{i}", "body": ["متن"]}} for i in vec]
    (tmp_path / "v.json").write_text(json.dumps({"model": related.EMBED_MODEL, "dims": related.DIMS,
                                                  "items": {str(i): {"src": "x", "v": related.pack(v + [0] * (related.DIMS - 3))} for i, v in vec.items()}}))
    out = related.build(posts)
    assert out["clusters"] == [[1, 2]]  # 5 is as close but a week later: related, not the same news
    assert out["related"]["1"][:2] == [5, 3] and 2 not in out["related"]["1"]
    assert "4" not in out["related"] or 1 not in out["related"]["4"]


def test_week_key_runs_saturday_to_friday():
    key, start, end = daily.week_key(datetime(2026, 11, 20, 5, 0, tzinfo=timezone.utc))  # a Friday morning, Tehran
    assert key == "2026-11-20"
    assert start.date().isoformat() == "2026-11-14" and end.date().isoformat() == "2026-11-21"
    assert daily.week_key(datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc))[0] == "2026-11-20"


def test_vtt_text_drops_repeats_and_stamps_time():
    vtt = "WEBVTT\nKind: captions\n\n00:00:01.000 --> 00:00:03.000\nسلام\n\n00:00:02.000 --> 00:00:04.000\nسلام\n\n00:01:05.000 --> 00:01:07.000\n<c>ربات</c>\n"
    assert videos.vtt_text(vtt) == "[0:01] سلام [1:05] ربات"


def test_comments_do_nothing_without_keys(monkeypatch):
    monkeypatch.setattr(comments, "URL", "")
    assert comments.run() == 0


def test_related_file_waits_for_most_vectors(tmp_path, monkeypatch):
    monkeypatch.setattr(related, "VECTORS", tmp_path / "v.json")
    monkeypatch.setattr(related, "RELATED", tmp_path / "related.json")
    posts = [{"id": i, "date": "2026-11-01T10:00:00+00:00", "article": {"title": "t", "body": ["متن"]}} for i in range(1, 11)]
    (tmp_path / "v.json").write_text(json.dumps({"model": related.EMBED_MODEL, "dims": related.DIMS,
                                                  "items": {"1": {"src": "x", "v": related.pack([1.0] * related.DIMS)}}}))
    assert related.coverage(posts) == 0.1
    assert related.update_file(posts) is False and not (tmp_path / "related.json").exists()
