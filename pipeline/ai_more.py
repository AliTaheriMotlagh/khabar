"""More from the same small model, after the headlines (PLAN.md P2). Three calls per post, each stamped with its own
version and input hash, so a post is worked out again only when its text or the prompt changes:

- story (P2-1): a Persian story from the English source when Gholam never wrote one (none after
  TRANSLATE_AFTER_HOURS, or only his "couldn't read it" apology). Stored as `ai.story`; the site labels it
  «ترجمه‌ی خودکار». Gholam's own text, if it comes later, wins.
- x (P2-5, 6, 8, 9, 10 and P1-C): importance 1–5, the people/companies/models named, technical terms with a
  one-line Persian explanation, «به زبان ساده», a quiz question, a 60-second video script and a share caption.
  Stored as `ai.x`; the terms and names also grow data/glossary.json and data/entities.json (first good answer
  wins, and both are editable by hand).
- speech (P2-2): how a Persian voice should say the Latin names in the text («GPT-5» → «جی‌پی‌تی پنج»). Only names
  the lexicon doesn't know yet are asked, so each is asked once ever; data/lexicon.json is applied at build time
  (src/lib/knowledge.ts spoken), so a hand edit there fixes every story at once. `ai.speech` marks a post as done.

    python -m pipeline.ai_more              # the newest posts first, until AI_MORE_BUDGET seconds are used up
    python -m pipeline.ai_more --pending    # how many posts are waiting
    python -m pipeline.ai_more --all [--limit=N] [--only=story|x|speech]
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import httpx

from . import ai, config, shape, telegram

STORY_V = 1
X_V = 1
SPEECH_V = 1
AI_MORE_BUDGET = float(os.getenv("AI_MORE_BUDGET", "240"))
TRANSLATE_AFTER_HOURS = float(os.getenv("TRANSLATE_AFTER_HOURS", "6"))

GLOSSARY = config.DATA_DIR / "glossary.json"
ENTITIES = config.DATA_DIR / "entities.json"
LEXICON = config.DATA_DIR / "lexicon.json"

FA = re.compile(r"[؀-ۿ]")
LATIN = re.compile(r"[A-Za-z]")


def fa_share(s: str) -> float:
    letters = re.findall(r"[^\W\d_]", s or "")
    return sum(1 for c in letters if "؀" <= c <= "ۿ") / len(letters) if letters else 0.0


def age_hours(iso: str) -> float:
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds() / 3600
    except ValueError:
        return 0.0


def gholam_text(post: dict) -> Optional[str]:
    g = post.get("gholam") or {}
    return g["text"] if g.get("text") and not telegram.is_gholam_error(g["text"]) else None


# ---------------------------------------------------------------- 1. the story when Gholam is silent

STORY_SCHEMA = {
    "type": "object",
    "properties": {
        "body": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 4},
        "why": {"type": "string"},
    },
    "required": ["body", "why"],
    "additionalProperties": False,
}
STORY_SYSTEM = """تو مترجم و دبیر خبر یک سایت فارسی خبرهای هوش مصنوعی هستی. از متن انگلیسی منبع (توییت، مقاله یا صفحه) یک خبر کوتاه فارسی بنویس. فقط JSON بده.

body: ۲ تا ۴ بند کوتاه به فارسی معیار و روان (نه محاوره). بند اول خودِ خبر است: چه کسی، چه کاری کرد یا چه چیزی معرفی شد. بندهای بعد جزئیات مهم: عددها، قابلیت‌ها، زمان و قیمت اگر در متن هست.
why: یک جمله که چرا این خبر مهم است.

قاعده‌ها:
- فقط چیزی را بگو که در متن منبع هست؛ چیزی اضافه نکن و حدس نزن.
- هر محصول را فقط به شرکتی نسبت بده که در متن منبع صاحبش است. اگر متن نگفته کار کدام شرکت است، نام شرکتی نیاور.
- نام محصول و مدل را همان‌طور که در متن آمده به لاتین بنویس؛ نام شرکت‌ها و آدم‌های شناخته‌شده را به فارسی.
- عددها با رقم فارسی.
- اگر متن منبع تبلیغ یا خیلی کوتاه است، همان را کوتاه و دقیق بگو."""


def story_input(post: dict) -> Optional[str]:
    """The English material: the post's own words, the tweets (and quoted ones), the linked pages' titles and
    descriptions. None when there's too little to translate, or when it's only a shared video (videos.py does those)."""
    parts = []
    own = ai.URL_RE.sub("", post.get("text") or "").strip()
    if own:
        parts.append(f"متن پست: {own}")
    for l in post.get("links") or []:
        if l.get("kind") == "youtube":
            continue
        who = (l.get("author") or {}).get("name")
        if l.get("text"):
            parts.append(f"{'توییت ' + who if who else 'توییت'}: {ai.URL_RE.sub('', l['text']).strip()}")
        q = l.get("quote") or {}
        if q.get("text"):
            parts.append(f"نقل‌قول از {(q.get('author') or {}).get('name') or '؟'}: {ai.URL_RE.sub('', q['text']).strip()}")
        title = (l.get("article") or {}).get("title") or l.get("title")
        if title and not shape.WALL_TITLE.search(title):
            parts.append(f"عنوان صفحه ({l.get('domain', '')}): {title}")
        if l.get("description"):
            parts.append(f"توضیح صفحه: {l['description']}")
    pv = post.get("preview") or {}
    if not post.get("links") and pv.get("title"):
        parts.append(f"عنوان صفحه ({pv.get('site', '')}): {pv['title']}")
        if pv.get("description"):
            parts.append(f"توضیح صفحه: {pv['description']}")
    text = shape.clip(re.sub(r"[ \t]+", " ", "\n".join(parts)), 2500)
    return text if len(LATIN.findall(text)) >= 120 or (fa_share(text) > 0.5 and len(text) > 200) else None


def story_due(post: dict) -> bool:
    if post.get("digest") or gholam_text(post) or age_hours(post.get("date", "")) < TRANSLATE_AFTER_HOURS:
        return False
    text = story_input(post)
    old = (post.get("ai") or {}).get("story") or {}
    return bool(text) and (old.get("v") != STORY_V or old.get("src") != ai.input_hash(text))


def story_problems(a: dict) -> list[str]:
    out = []
    body = [re.sub(r"\s+", " ", p).strip() for p in a.get("body") or [] if p.strip()]
    text = " ".join(body)
    if not body or not 120 <= len(text) <= 1800:
        out.append(f"length {len(text)}")
    if fa_share(text) < 0.55:
        out.append("not Persian enough")
    if ai.GREETING.search(text):
        out.append("colloquial words")
    if not (a.get("why") or "").strip():
        out.append("no why")
    return out


def work_story(http: httpx.Client, post: dict) -> dict:
    text = story_input(post)
    stamp = {"model": ai.AI_MODEL, "v": STORY_V, "src": ai.input_hash(text)}
    for temperature in (0.0, 0.3):
        try:
            a = ai.chat(http, STORY_SYSTEM, [], text, STORY_SCHEMA, name="story", temperature=temperature, max_tokens=900)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            if isinstance(exc, httpx.TransportError):
                raise
            print(f"  ! story {post['id']}: {exc}")
            continue
        bad = story_problems(a)
        if not bad:
            return {"body": [re.sub(r"\s+", " ", p).strip() for p in a["body"] if p.strip()], "why": a["why"].strip(), **stamp}
        print(f"  ! story {post['id']}: {', '.join(bad)}")
    return {"failed": True, **stamp}


# ---------------------------------------------------------------- 2. the extras

KINDS = ["person", "company", "model", "product"]
X_SCHEMA = {
    "type": "object",
    "properties": {
        "importance": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
        "entities": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "properties": {"name_en": {"type": "string"}, "name_fa": {"type": "string"}, "kind": {"type": "string", "enum": KINDS}},
                "required": ["name_en", "name_fa", "kind"],
                "additionalProperties": False,
            },
        },
        "terms": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {"term": {"type": "string"}, "def": {"type": "string"}},
                "required": ["term", "def"],
                "additionalProperties": False,
            },
        },
        "simple": {"type": "string"},
        "quiz": {
            "type": "object",
            "properties": {
                "q": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 3},
                "answer": {"type": "integer", "enum": [0, 1, 2]},
            },
            "required": ["q", "options", "answer"],
            "additionalProperties": False,
        },
        "video": {
            "type": "object",
            "properties": {
                "hook": {"type": "string"},
                "points": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 3},
                "why": {"type": "string"},
            },
            "required": ["hook", "points", "why"],
            "additionalProperties": False,
        },
        "share": {"type": "string"},
    },
    "required": ["importance", "entities", "terms", "simple", "quiz", "video", "share"],
    "additionalProperties": False,
}
X_SYSTEM = """تو دبیر یک سایت فارسی خبرهای هوش مصنوعی هستی. برای خبری که می‌آید این‌ها را بده، فقط JSON و همه به فارسی معیار (نه محاوره):

importance (۱ تا ۵): ۵ = رویداد بزرگ (مدل یا محصول اصلی یک آزمایشگاه بزرگ، قانون یا تصمیم دولتی مهم، سرمایه‌گذاری یا خرید میلیارد دلاری)؛ ۴ = خبر مهم یک شرکت شناخته‌شده؛ ۳ = خبر معمولی؛ ۲ = ابزار کوچک، مقاله‌ی کم‌اهمیت یا نظر یک نفر؛ ۱ = تبلیغ یا شوخی.
entities: آدم‌ها، شرکت‌ها، مدل‌ها و محصول‌هایی که خبر واقعاً درباره‌ی آن‌هاست (نه هر نامی که گذرا آمده)، حداکثر ۶. name_en نام رسمی لاتین («OpenAI»، «Sam Altman»، «Claude Code»)، name_fa نوشتار فارسی رایج («اوپن‌ای‌آی»، «سم آلتمن»، «کلود کد»).
terms: اصطلاح‌های فنی خبر که یک خواننده‌ی عادی شاید نداند (مثل «توکن»، «فاین‌تیون»، «RAG»، «بنچمارک»)، حداکثر ۴؛ term همان‌طور که در متن آمده، def یک جمله‌ی ساده و دقیق (۳۰ تا ۱۴۰ نویسه). نام شرکت یا محصول اصطلاح نیست. اگر نیست، فهرست خالی.
simple: اگر خبر فنی است، دو جمله‌ی خیلی ساده که یک نوجوان هم بفهمد؛ اگر نه، رشته‌ی خالی.
quiz: یک پرسش چهارگزینه‌ای نه، سه‌گزینه‌ای از خودِ متن خبر: q پرسش، options سه گزینه‌ی کوتاه که فقط یکی درست است، answer شماره‌ی گزینه‌ی درست (۰، ۱ یا ۲). گزینه‌ی درست را همیشه اول نگذار.
video: متن یک ویدیوی ۶۰ ثانیه‌ای: hook یک جمله‌ی کوتاه و گیرا (حداکثر ۷۰ نویسه)، points سه نکته‌ی کوتاه (هر کدام حداکثر ۹۰ نویسه)، why یک جمله که چرا مهم است.
share: متن کوتاه برای اشتراک در تلگرام و اینستاگرام: دو خط، بعد ۲ یا ۳ هشتگ فارسی یا لاتین.
چیزی را که در متن نیست اضافه نکن."""
X_EXAMPLES = [
    (
        "تیتر: Claude Code حالت آزمایشی Code Mode را آورد: اجرای چند ابزار با یک اسکریپت\n"
        "متن: اکانت ClaudeDevs یه قابلیت آزمایشی جدید برای کلود کد (Claude Code) معرفی کرده به اسم Code Mode. تا قبل از این، "
        "کلود ابزارها رو دونه دونه صدا می‌زد و منتظر نتیجه هر کدوم می‌موند؛ اما تو این حالت یه اسکریپت جاوااسکریپت می‌نویسه تا "
        "چند تا دستور و ابزار رو هم‌زمان یا پشت سر هم اجرا کنه. این قابلیت به‌صورت پیش‌فرض خاموشه و فعلاً فقط توی ترمینال کار می‌کنه.",
        {
            "importance": 3,
            "entities": [{"name_en": "Anthropic", "name_fa": "آنتروپیک", "kind": "company"}, {"name_en": "Claude Code", "name_fa": "کلود کد", "kind": "product"}],
            "terms": [{"term": "اسکریپت", "def": "چند خط کد که پشت سر هم اجرا می‌شود تا کاری را خودکار انجام دهد."}],
            "simple": "دستیار برنامه‌نویسی Claude حالا می‌تواند به‌جای انجام کارها یکی‌یکی، یک برنامه‌ی کوچک بنویسد و چند کار را با هم انجام دهد. این کار سریع‌تر است.",
            "quiz": {"q": "Code Mode در Claude Code چه می‌کند؟", "options": ["مدل را روی گوشی اجرا می‌کند", "با یک اسکریپت چند ابزار را با هم اجرا می‌کند", "کد را به زبان فارسی ترجمه می‌کند"], "answer": 1},
            "video": {"hook": "Claude Code حالا با یک اسکریپت چند کار را با هم می‌کند", "points": ["حالت آزمایشی تازه‌ای به اسم Code Mode آمده", "به‌جای صدا زدن ابزارها یکی‌یکی، یک اسکریپت جاوااسکریپت می‌نویسد", "فعلاً پیش‌فرض خاموش است و فقط در ترمینال کار می‌کند"], "why": "ایجنت‌های برنامه‌نویسی با این روش سریع‌تر و کم‌هزینه‌تر کار می‌کنند."},
            "share": "Claude Code حالت تازه‌ای به اسم Code Mode گرفته: چند ابزار با یک اسکریپت.\nسریع‌تر از صدا زدن یکی‌یکی ابزارها.\n#ClaudeCode #هوش_مصنوعی",
        },
    ),
]


def x_input(post: dict) -> Optional[str]:
    text = gholam_text(post)
    story = (post.get("ai") or {}).get("story") or {}
    if not text and story.get("body"):
        text = "\n".join(story["body"] + ([story["why"]] if story.get("why") else []))
    if not text or post.get("digest"):
        return None
    title = (post.get("ai") or {}).get("title") or (post.get("article") or {}).get("title") or ""
    src = (post.get("article") or {}).get("source_title")
    lines = [f"تیتر: {title}"] + ([f"عنوان منبع: {shape.clip(src, 200)}"] if src else [])
    lines.append("متن: " + shape.clip(re.sub(r"\s+", " ", ai.URL_RE.sub("", text)), 1600))
    return "\n".join(lines)


def x_due(post: dict) -> bool:
    text = x_input(post)
    old = (post.get("ai") or {}).get("x") or {}
    return bool(text) and (old.get("v") != X_V or old.get("src") != ai.input_hash(text))


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def tidy_x(a: dict) -> dict:
    """Keep the parts that pass; drop the rest (a bad quiz shouldn't cost the post its names and terms)."""
    out: dict = {"importance": a.get("importance") if a.get("importance") in (1, 2, 3, 4, 5) else None}
    ents, seen = [], set()
    for e in a.get("entities") or []:
        en, fa, kind = _clean(e.get("name_en")), _clean(e.get("name_fa")), e.get("kind")
        if not en or not fa or kind not in KINDS or len(en) > 50 or len(fa) > 50 or not LATIN.search(en) or fa_share(fa) < 0.5:
            continue
        if en.lower() in seen:
            continue
        seen.add(en.lower())
        ents.append({"name_en": en, "name_fa": fa, "kind": kind})
    out["entities"] = ents
    terms = []
    for t in a.get("terms") or []:
        term, d = _clean(t.get("term")), _clean(t.get("def"))
        if term and 2 <= len(term) <= 40 and 20 <= len(d) <= 180 and fa_share(d) >= 0.6 and not ai.GREETING.search(d):
            terms.append({"term": term, "def": d})
    out["terms"] = terms
    simple = _clean(a.get("simple"))
    out["simple"] = simple if 30 <= len(simple) <= 360 and fa_share(simple) >= 0.6 and not ai.GREETING.search(simple) else None
    q = a.get("quiz") or {}
    opts = [_clean(o) for o in q.get("options") or []]
    ok_quiz = _clean(q.get("q")) and len(opts) == 3 and all(1 <= len(o) <= 90 for o in opts) and len(set(opts)) == 3 and q.get("answer") in (0, 1, 2)
    out["quiz"] = {"q": _clean(q["q"]), "options": opts, "answer": q["answer"]} if ok_quiz else None
    v = a.get("video") or {}
    pts = [_clean(p) for p in v.get("points") or []]
    ok_video = 8 <= len(_clean(v.get("hook"))) <= 90 and len(pts) == 3 and all(8 <= len(p) <= 120 for p in pts) and _clean(v.get("why"))
    out["video"] = {"hook": _clean(v["hook"]), "points": pts, "why": _clean(v["why"])} if ok_video else None
    share = (a.get("share") or "").strip()
    out["share"] = share if 20 <= len(share) <= 320 else None
    return out


def work_x(http: httpx.Client, post: dict) -> dict:
    text = x_input(post)
    stamp = {"model": ai.AI_MODEL, "v": X_V, "src": ai.input_hash(text)}
    for temperature in (0.0, 0.3):
        try:
            a = ai.chat(http, X_SYSTEM, X_EXAMPLES, text, X_SCHEMA, name="extras", temperature=temperature, max_tokens=900)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            if isinstance(exc, httpx.TransportError):
                raise
            print(f"  ! x {post['id']}: {exc}")
            continue
        out = tidy_x(a)
        if out["importance"] is not None:
            return {**out, **stamp}
    return {"failed": True, **stamp}


# ---------------------------------------------------------------- 3. the spoken names

SPEECH_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"term": {"type": "string"}, "say": {"type": "string"}},
                "required": ["term", "say"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}
SPEECH_SYSTEM = """این نام‌ها و نمادهای لاتین در یک خبر فارسی آمده‌اند و یک صدای فارسی باید آن‌ها را بخواند. برای هر کدام بنویس که به فارسی چطور تلفظ می‌شود، با حروف فارسی (بدون هیچ حرف لاتین). فقط JSON بده.
- نام‌ها همان‌طور که اهلش می‌گویند: OpenAI → «اوپن اِی آی»، Anthropic → «آنتروپیک»، Claude → «کلود»، Gemini → «جمنای».
- سرواژه‌ها حرف به حرف: GPT → «جی پی تی»، AI → «اِی آی»، API → «اِی پی آی».
- عددها و نسخه‌ها به فارسی: GPT-5.2 → «جی پی تی پنج ممیز دو»، $2.5B → «دو و نیم میلیارد دلار»، 70B → «هفتاد میلیارد».
- برای هر term دقیقاً همان رشته را برگردان."""
SPEECH_EXAMPLES = [
    ("Claude\nCode\nSWE-bench\nGPT-4o\nNVIDIA\nthe", {"items": [
        {"term": "Claude", "say": "کلود"}, {"term": "Code", "say": "کد"}, {"term": "SWE-bench", "say": "اس دبلیو ای بنچ"},
        {"term": "GPT-4o", "say": "جی پی تی فور او"}, {"term": "NVIDIA", "say": "اِنویدیا"}, {"term": "the", "say": "دِ"}]}),
]
# One Latin word or version («Claude», «GPT-5.2», «SWE-bench», «OSS.new») or a dollar amount. Word by word, so «Claude»
# learned once also says «Claude Code» and «Claude Opus»; the voice reads each word in Persian letters.
TERM_RE = re.compile(r"\$\d[\d,.]*\s?[KMBT]?\b|[A-Za-z][\w.+&'/-]*")


def latin_terms(text: str) -> list[str]:
    """The Latin words a voice would have to read; @handles and snake_case names are left out."""
    out = []
    for m in TERM_RE.finditer(ai.URL_RE.sub(" ", re.sub(r"@\w+", " ", text or ""))):
        t = m.group(0).strip(" .,'/-&")
        if t and "_" not in t and t not in out:
            out.append(t)
    return out


# ---- what needs no model: letters spelled out, numbers said in Persian ----
LETTERS = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "اِی بی سی دی ای اِف جی اِچ آی جی کی اِل اِم اِن او پی کیو آر اِس تی یو وی دبلیو اِکس وای زد".split()))
ONES = "صفر یک دو سه چهار پنج شش هفت هشت نه ده یازده دوازده سیزده چهارده پانزده شانزده هفده هجده نوزده".split()
TENS = {2: "بیست", 3: "سی", 4: "چهل", 5: "پنجاه", 6: "شصت", 7: "هفتاد", 8: "هشتاد", 9: "نود"}
HUNDREDS = {1: "صد", 2: "دویست", 3: "سیصد", 4: "چهارصد", 5: "پانصد", 6: "ششصد", 7: "هفتصد", 8: "هشتصد", 9: "نهصد"}


def num_fa(n: int) -> str:
    """An integer in Persian words (up to the trillions)."""
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " و " + ONES[n % 10])
    if n < 1000:
        return HUNDREDS[n // 100] + ("" if n % 100 == 0 else " و " + num_fa(n % 100))
    for size, name in ((10**12, "تریلیون"), (10**9, "میلیارد"), (10**6, "میلیون"), (1000, "هزار")):
        if n >= size:
            head = name if n // size == 1 and size == 1000 else f"{num_fa(n // size)} {name}"
            return head + ("" if n % size == 0 else " و " + num_fa(n % size))
    return str(n)


def number_fa(s: str) -> Optional[str]:
    """«5» → «پنج», «2.5» → «دو ممیز پنج», «1,000» → «هزار»; None for anything else."""
    s = s.replace(",", "")
    if not re.fullmatch(r"\d{1,13}(\.\d{1,3})?", s):
        return None
    whole, _, frac = s.partition(".")
    out = num_fa(int(whole))
    if frac:
        out += " ممیز " + (" ".join(ONES[int(d)] for d in frac) if frac.startswith("0") else num_fa(int(frac)))
    return out


SCALE = {"K": "هزار", "M": "میلیون", "B": "میلیارد", "T": "تریلیون"}


def spell(term: str) -> Optional[str]:
    """How to say a term without asking the model: acronyms letter by letter, versions and amounts in Persian
    («GPT-5.2» → «جی پی تی پنج ممیز دو», «$2.5B» → «دو ممیز پنج میلیارد دلار», «70B» → «هفتاد بی»). None: a real word."""
    money = re.fullmatch(r"\$(\d[\d,.]*)\s?([KMBT])?", term)
    if money and number_fa(money.group(1)):
        return f"{number_fa(money.group(1))}{' ' + SCALE[money.group(2)] if money.group(2) else ''} دلار"
    parts = re.split(r"[-\s]+", term)
    said = []
    for part in parts:
        if not part:
            continue
        n = number_fa(part)
        if n:
            said.append(n)
        elif re.fullmatch(r"[A-Z]{1,3}|[B-DF-HJ-NP-TV-Z]{4,6}", part):
            # Short, or no vowel to say it by (HTML): an acronym. CUDA, ROOST and MATH are said as words.
            said.append(" ".join(LETTERS[c] for c in part))
        elif re.fullmatch(r"[A-Z]{1,3}\d+(\.\d+)?|\d+(\.\d+)?[A-Z]{1,3}", part):
            said.extend(spell(x) or "" for x in re.findall(r"[A-Z]+|\d+(?:\.\d+)?", part))
        else:
            return None
    return " ".join(x for x in said if x) or None


def load_json(path, fallback):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return fallback


def lexicon() -> dict:
    return load_json(LEXICON, {})


def speech_text(post: dict) -> str:
    a = post.get("article") or {}
    story = (post.get("ai") or {}).get("story") or {}
    body = (a.get("body") or []) if gholam_text(post) else (story.get("body") or [])
    return "\n".join([(post.get("ai") or {}).get("title") or a.get("title") or "", *body, a.get("why") or story.get("why") or ""])


def speech_todo(post: dict, lex: dict) -> list[str]:
    """The names the lexicon doesn't know yet. Acronyms, versions and amounts are spelled here and added to it
    straight away; only real words are left for the model."""
    if post.get("digest"):
        return []
    known = {k.lower() for k in lex}
    todo = []
    for t in latin_terms(speech_text(post)):
        if t.lower() in known:
            continue
        said = spell(t)
        if said:
            lex[t] = said
            known.add(t.lower())
        else:
            todo.append(t)
    return todo[:20]


def speech_due(post: dict, lex: dict) -> bool:
    todo = speech_todo(post, lex)
    old = (post.get("ai") or {}).get("speech") or {}
    return bool(todo) and (old.get("v") != SPEECH_V or old.get("src") != ai.input_hash("\n".join(todo)))


def good_say(s: str) -> bool:
    return bool(s) and not LATIN.search(s) and fa_share(s) >= 0.95 and len(s) <= 80


def work_speech(http: httpx.Client, post: dict, lex: dict) -> dict:
    todo = speech_todo(post, lex)
    stamp = {"v": SPEECH_V, "src": ai.input_hash("\n".join(todo))}
    try:
        a = ai.chat(http, SPEECH_SYSTEM, SPEECH_EXAMPLES, "\n".join(todo), SPEECH_SCHEMA, name="speech", max_tokens=60 + 30 * len(todo))
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        if isinstance(exc, httpx.TransportError):
            raise
        print(f"  ! speech {post['id']}: {exc}")
        return {"failed": True, **stamp}
    asked = {t.lower(): t for t in todo}
    added = 0
    for item in a.get("items") or []:
        term, say = _clean(item.get("term")), _clean(item.get("say"))
        if term.lower() in asked and good_say(say) and asked[term.lower()] not in lex:
            lex[asked[term.lower()]] = say
            added += 1
    return {**stamp, "added": added}


# ---------------------------------------------------------------- glossary and entities

def norm(s: str) -> str:
    return re.sub(r"[\s‌_-]+", " ", (s or "").lower()).strip()


def slugify(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", (s or "").lower(), flags=re.ASCII).strip()
    return re.sub(r"[\s_-]+", "-", s)[:60].strip("-")


def remember(posts: list[dict]) -> tuple[int, int]:
    """Add the terms and names the extras found to the shared files. A name or term already there is left as it is."""
    g = load_json(GLOSSARY, {"terms": []})
    e = load_json(ENTITIES, {"entities": []})
    terms = {norm(t["term"]): t for t in g["terms"]}
    for t in g["terms"]:
        for a in t.get("aliases") or []:
            terms.setdefault(norm(a), t)
    ents = {norm(x["name_en"]): x for x in e["entities"]}
    slugs = {x["slug"] for x in e["entities"]}
    new_t = new_e = 0
    for post in sorted(posts, key=lambda p: p["id"]):
        x = (post.get("ai") or {}).get("x") or {}
        if x.get("failed"):
            continue
        for t in x.get("terms") or []:
            if norm(t["term"]) not in terms:
                item = {"term": t["term"], "def": t["def"]}
                g["terms"].append(item)
                terms[norm(t["term"])] = item
                new_t += 1
        for en in x.get("entities") or []:
            key = norm(en["name_en"])
            if key in ents:
                continue
            slug = base = slugify(en["name_en"]) or f"e{len(slugs) + 1}"
            n = 2
            while slug in slugs:
                slug, n = f"{base}-{n}", n + 1
            item = {"slug": slug, "name_en": en["name_en"], "name_fa": en["name_fa"], "kind": en["kind"]}
            e["entities"].append(item)
            ents[key] = item
            slugs.add(slug)
            new_e += 1
    if new_t:
        GLOSSARY.write_text(json.dumps(g, ensure_ascii=False, indent=1) + "\n", "utf-8")
    if new_e:
        ENTITIES.write_text(json.dumps(e, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return new_t, new_e


# ---------------------------------------------------------------- runs

def recent(posts: list[dict], everything: bool) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=ai.AI_RECENT_DAYS)
    keep = [p for p in posts if everything or datetime.fromisoformat(p["date"]) >= since]
    return sorted(keep, key=lambda p: p["id"], reverse=True)


def pending(posts: list[dict], everything: bool = False) -> dict:
    lex = lexicon()
    todo = recent(posts, everything)
    return {"story": sum(map(story_due, todo)), "x": sum(map(x_due, todo)), "speech": sum(speech_due(p, lex) for p in todo)}


def run(everything: bool = False, budget: float = AI_MORE_BUDGET, limit: Optional[int] = None, only: Optional[str] = None) -> int:
    posts = ai.load_posts()
    todo = recent(posts, everything)
    lex = lexicon()
    start = time.monotonic()
    done = 0
    jobs: list[tuple[str, Callable[[dict], bool], Callable[[httpx.Client, dict], dict]]] = [
        # The story first: the headline and the extras of an untranslated post need it.
        ("story", story_due, work_story),
        ("x", x_due, work_x),
        ("speech", lambda p: speech_due(p, lex), lambda h, p: work_speech(h, p, lex)),
    ]
    with httpx.Client() as http:
        for name, due, work in jobs:
            if only and name != only:
                continue
            queue = [p for p in todo if due(p)][:limit]
            print(f"ai_more {name}: {len(queue)} posts")
            for post in queue:
                if time.monotonic() - start > budget:
                    print(f"ai_more: budget of {budget:.0f}s used")
                    break
                if name == "speech" and not speech_due(post, lex):
                    continue  # an earlier post taught the lexicon these names
                t = time.monotonic()
                post["ai"] = post.get("ai") or {}
                post["ai"][name] = work(http, post)
                ai.save(post)
                if name == "speech":
                    LEXICON.write_text(json.dumps(dict(sorted(lex.items(), key=lambda kv: kv[0].lower())), ensure_ascii=False, indent=1) + "\n", "utf-8")
                done += 1
                r = post["ai"][name]
                print(f"  ✓ {name} {post['id']} ({time.monotonic() - t:.1f}s){' failed' if r.get('failed') else ''}")
    t, e = remember(posts)
    if t or e:
        print(f"ai_more: {t} new terms, {e} new names")
    return done


if __name__ == "__main__":
    args = sys.argv[1:]
    everything = "--all" in args
    if "--pending" in args:
        p = pending(ai.load_posts(), everything)
        print(sum(p.values()) if "--total" in args else json.dumps(p))
    else:
        limit = next((int(a.split("=")[1]) for a in args if a.startswith("--limit=")), None)
        only = next((a.split("=")[1] for a in args if a.startswith("--only=")), None)
        run(everything, float(os.getenv("AI_MORE_BUDGET", "1e9" if everything else str(AI_MORE_BUDGET))), limit, only)
