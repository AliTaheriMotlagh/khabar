"""Headlines, a short line, topics and a type for each story, by a small local LLM (PLAN.md P1-B).

Gholam's first sentence makes a long, chatty headline («رفقا، اکانت … گفته که …», 160 characters on average) and the
keyword rules (shape.TOPICS) miss context. A small Qwen reads each story once and writes them; the site uses them and
falls back to the rules wherever they are missing.

Runs against any OpenAI-compatible server (AI_URL, AI_MODEL):
- in the workflow, llama.cpp's llama-server on the runner (scripts/ai-server.sh): free, no key, no quota;
- on a Mac, the same llama-server (Metal) for the backfill.
The answer is held to a JSON schema (topics are an enum of shape.TOPICS), then checked here: a bad answer is retried
once, then left out (`"ai": {"failed": true}`), so the post keeps the rules' headline and topics.

Stored in the post as `ai`: {title, short, topics, type, model, v, src}. `src` hashes the input and `v` is the prompt's
version: a post is worked out again only when one of them changes, so each story costs one call, ever.

    python -m pipeline.ai              # the newest posts without an answer, until AI_BUDGET seconds are used up
    python -m pipeline.ai --pending    # how many posts are waiting (the workflow skips the model when 0)
    python -m pipeline.ai --all        # every post, not only the last AI_RECENT_DAYS days (the backfill)
    python -m pipeline.ai --eval       # the golden set (pipeline/tests/golden.json) against the keyword rules
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from . import config, shape, telegram

AI_URL = os.getenv("AI_URL", "http://127.0.0.1:8080/v1").rstrip("/")
AI_MODEL = os.getenv("AI_MODEL", "qwen3.5-9b-q4_k_m")
AI_BUDGET = float(os.getenv("AI_BUDGET", "300"))  # seconds of model time per run; the rest waits for the next run
AI_RECENT_DAYS = float(os.getenv("AI_RECENT_DAYS", "3"))  # a normal run only looks at posts this new
AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "180"))
PROMPT_V = 2  # bump when the prompt or the rules change: every post is worked out again
# v2: topics defined one by one, and kept only when the text names them (`grounded`): the site uses them since v2.

TOPICS = [t[0] for t in shape.TOPICS]
TYPES = ["خبر", "ابزار و محصول", "پژوهش و مقاله", "آموزش", "نظر و تحلیل", "ویدیوی مهرزاد"]

def _topic_line(tag: str, words: tuple) -> str:
    """«گوگل: Google، Gemini، DeepMind…» — a few of the keywords say what the topic covers."""
    latin = [w for w in words if w.isascii() and w.lower() != tag.lower()][:5]
    return f"- {tag}: {'، '.join(latin)}" if latin else f"- {tag}"


TOPIC_LIST = "\n".join(_topic_line(tag, words) for tag, words in shape.TOPICS)
SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "short": {"type": "string"},
        "topics": {"type": "array", "items": {"type": "string", "enum": TOPICS}, "maxItems": 3},
        "type": {"type": "string", "enum": TYPES},
    },
    "required": ["title", "short", "topics", "type"],
    "additionalProperties": False,
}

SYSTEM = f"""تو دبیر خبر یک سایت فارسی خبرهای هوش مصنوعی و فناوری هستی. متن هر خبر را «غلام» به زبان محاوره نوشته؛ تو برایش تیتر، تیتر کوتاه، موضوع و نوع می‌نویسی. فقط JSON بده.

title (تیتر):
- فارسی معیار و روان، مثل تیتر یک خبرگزاری خوب؛ نه محاوره («میگه»، «اومده»، «رفقا» ممنوع).
- ۴۰ تا ۹۰ نویسه، یک جمله، با فعل، بدون نقطه‌ی پایانی و بدون ایموجی.
- خودِ خبر را بگو، نه اینکه چه کسی توییت کرده: «اکانت فلانی خبر داده که…» نه.
- نام شرکت، شخص یا محصول اصلی حتماً در تیتر باشد. نام محصول و مدل را همان‌طور که در متن آمده به لاتین بنویس (GPT-6.2، Claude Code)؛ نام شرکت‌ها و آدم‌های شناخته‌شده را به فارسی (اوپن‌ای‌آی، گوگل، جنسن هوانگ).
- عدد مهم (مبلغ، درصد، امتیاز) اگر هست بیاور، با رقم فارسی.
- چیزی را که در متن نیست اضافه نکن.

short (تیتر کوتاه برای دایره‌ی استوری و اعلان): حداکثر ۴۰ نویسه، چند کلمه، بدون فعلِ لازم.

topics (بخش‌های سایت): از فهرست زیر و فقط همین‌ها، معمولاً ۱ یا ۲ تا (حداکثر ۳)، مهم‌ترین اول؛ اولی بخش اصلی خبر است.
- فقط موضوعی که خبر درباره‌ی آن است و نامش (یا نام محصولش) در متن آمده. نامی که فقط برای مقایسه یا گذرا آمده («بهتر از GPT»، «پژوهشگر سابق انویدیا») حساب نیست.
- یک شرکت را فقط وقتی بیاور که خودش یا محصولش موضوع خبر است؛ شرکت یا استارتاپ دیگری که در فهرست نیست، موضوع شرکتی نمی‌گیرد.
- «کسب‌وکار» فقط برای خبر پول و بازار: درآمد، سود، سهام، خرید شرکت، عرضه‌ی اولیه. معرفی محصول یا ابزار کسب‌وکار نیست.
- اگر هیچ‌کدام نمی‌خورد، فهرست خالی.
{TOPIC_LIST}

type (یکی):
- «خبر»: رویداد، معامله، سرمایه‌گذاری، قانون، اختلال، استعفا، گزارش رسانه‌ها.
- «ابزار و محصول»: مدل، ابزار، اپ یا قابلیت تازه‌ای که می‌شود استفاده یا امتحانش کرد.
- «پژوهش و مقاله»: مقاله‌ی علمی، روش تازه، بنچمارک، گزارش پژوهشی.
- «آموزش»: راهنما، ترفند، دوره، توضیح یک مفهوم.
- «نظر و تحلیل»: دیدگاه یا تحلیل یک نفر، نه یک رویداد.
- «ویدیوی مهرزاد»: ویدیوی یوتیوب مهرزاد صمدی."""

# Real stories with hand-written answers: they show the style better than the rules alone.
EXAMPLES = [
    (
        "منبع: x.com\nعنوان اصلی: Check out Code Mode, a new, experimental way for Claude Code to work with tools.\n"
        "متن: سلام رفقا، اکانت ClaudeDevs یه قابلیت آزمایشی جدید برای کلود کد (Claude Code) معرفی کرده به اسم Code Mode. "
        "تا قبل از این، کلود ابزارها رو دونه دونه صدا می‌زد و منتظر نتیجه هر کدوم می‌موند؛ اما تو این حالت یه اسکریپت "
        "جاوااسکریپت می‌نویسه تا چند تا دستور و ابزار رو هم‌زمان یا پشت سر هم اجرا کنه. این قابلیت به‌صورت پیش‌فرض خاموشه "
        "و فعلاً فقط توی ترمینال کار می‌کنه.",
        {"title": "Claude Code حالت آزمایشی Code Mode را آورد: اجرای چند ابزار با یک اسکریپت", "short": "Code Mode در Claude Code",
         "topics": ["آنتروپیک", "کدنویسی"], "type": "ابزار و محصول"},
    ),
    (
        "منبع: x.com\nعنوان اصلی: 1/ From 7B to 30B parameters, zeroing fewer than 0.05% of frozen weights with GRPO matches full fine-tuning on math\n"
        "متن: رفقا، یه مقاله‌ی جدید از پژوهشگران NYU و دانشگاه کلگری روشی به اسم Deletion Tuning معرفی کرده که میگه برای "
        "یاد دادن مهارت‌های تازه به مدل‌های زبانی بزرگ، لازم نیست وزن‌های قبلی رو تغییر بدی؛ فقط کمتر از ۰.۰۵ درصد وزن‌ها "
        "رو صفر می‌کنی. توی مدل‌های ۷ تا ۳۰ میلیارد پارامتر این کار توی ریاضی به پای فاین‌تیون کامل می‌رسه و فراموشی هم کمتره.",
        {"title": "روش Deletion Tuning: صفر کردن کمتر از ۰٫۰۵ درصد وزن‌ها جای فاین‌تیون کامل را می‌گیرد", "short": "روش Deletion Tuning",
         "topics": [], "type": "پژوهش و مقاله"},
    ),
    (
        "منبع: x.com\nعنوان اصلی: my view on distillation\n"
        "متن: رفیق، کاربر thdxr توی دو تا پستی که از این رشته‌توییت در دسترسه، نظرش رو درباره بحث «دیستیلیشن» (distillation) "
        "مطرح کرده و می‌گه این یه مسئله کاملاً خصوصی بین شرکت‌هاست و دولت نباید دخالت کنه. به گفته اون، هر شرکتی حق داره کار "
        "رو برای رقبا سخت کنه، اما رقبا هم حق دارن از هم یاد بگیرن.",
        {"title": "thdxr: دیستیلیشن دعوای خصوصی شرکت‌هاست و دولت نباید دخالت کند", "short": "دیستیلیشن و دولت",
         "topics": ["سیاست و قانون"], "type": "نظر و تحلیل"},
    ),
    (
        "منبع: x.com\nعنوان اصلی: The California Department of Motor Vehicles issued the restrictions\n"
        "متن: رفقا، ظاهراً تاکسی‌های خودران «ویمو» (Waymo) فعلاً از اتوبان‌ها خط خوردن! 🚕 بر اساس گزارش تک‌کرانچ، اداره وسایل "
        "نقلیه کالیفرنیا (DMV) محدودیت‌هایی برای تردد این خودروها توی بزرگراه‌ها وضع کرده؛ دلیلش هم این بوده که سه تا خودروی "
        "ویمو وارد محدوده بسته کارگاه جاده‌ای در بزرگراه ۱۰۱ شدن. ویمو سرویس بزرگراهی رو در هر ۱۵ شهرش موقتاً متوقف کرده.",
        {"title": "کالیفرنیا تاکسی‌های خودران ویمو را از بزرگراه‌ها منع کرد", "short": "ویمو بی‌بزرگراه شد",
         "topics": ["گوگل"], "type": "خبر"},
    ),
    (
        "منبع: youtube.com\nعنوان اصلی: 51. Beni: Camera Robot [Persian]\nویدیوی یوتیوب مهرزاد صمدی.",
        {"title": "قسمت ۵۱ ویدیوهای مهرزاد: Beni، رباتی با دوربین", "short": "مهرزاد: ربات Beni",
         "topics": ["رباتیک"], "type": "ویدیوی مهرزاد"},
    ),
]

# Spoken Persian a headline mustn't have: Gholam's greetings, and colloquial forms («دیگه», «توی», «رو» for «را»).
_W = r"(?<![؀-ۿ‌])({})(?![؀-ۿ‌])"
GREETING = re.compile(r"رفقا|رفیق|سلام|داداش|ببین|بچه‌ها|میگه|می‌گه|اومده|درومده|" + _W.format("دیگه|توی|رو|میشه|می‌شه|کرده‌ن|نیس"))
URL_RE = re.compile(r"https?://\S+")


# ---- input ----

def _video(post: dict) -> Optional[str]:
    """The video's title, for a post that only shares a YouTube link (Mehrzad's episodes)."""
    if len(re.findall(r"[^\W\d_]", URL_RE.sub("", post.get("text", "")))) > 40:
        return None
    for l in post.get("links") or []:
        if l.get("kind") == "youtube" or "youtu" in l.get("url", ""):
            title = l.get("title") if l.get("title") and not shape.WALL_TITLE.search(l["title"]) else None
            return title or (post.get("preview") or {}).get("title")
    preview = post.get("preview") or {}
    return preview.get("title") if "youtu" in (preview.get("url") or "") else None


def source_input(post: dict) -> Optional[str]:
    """What the model reads: Gholam's text (or a shared video's title) and the source's own title. None: nothing to
    work with (a digest, an English post Gholam didn't translate)."""
    if post.get("digest"):
        return None
    gholam = post.get("gholam") or {}
    text = gholam.get("text") if gholam.get("text") and not telegram.is_gholam_error(gholam["text"]) else None
    # Without Gholam, the model's own Persian story (pipeline/ai_more.py translate, P2-1) gets a headline the same way.
    story = (post.get("ai") or {}).get("story") or {}
    if not text and story.get("body"):
        text = "\n".join(story["body"] + ([story["why"]] if story.get("why") else []))
    video = None if text else _video(post)
    if not text and not video:
        return None
    links = post.get("links") or []
    domains = list(dict.fromkeys(l.get("domain") for l in links if l.get("domain")))
    src = (post.get("article") or {}).get("source_title") or video
    lines = [f"منبع: {'، '.join(domains[:3]) or 't.me'}"]
    if src:
        lines.append(f"عنوان اصلی: {shape.clip(src, 200)}")
    if text:
        lines.append("متن: " + shape.clip(re.sub(r"\s+", " ", URL_RE.sub("", text)), 1500))
    else:
        lines.append("ویدیوی یوتیوب مهرزاد صمدی." if re.search(r"\[Persian\]|^Live \d", video or "") else "ویدیوی یوتیوب.")
    return "\n".join(lines)


def input_hash(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:12]


def is_due(post: dict) -> bool:
    text = source_input(post)
    if not text:
        return False
    ai = post.get("ai") or {}
    return ai.get("v") != PROMPT_V or ai.get("src") != input_hash(text)


# ---- the model ----

def chat(http: httpx.Client, system: str, examples: list, text: str, schema: dict, *, name: str = "answer",
         temperature: float = 0.0, max_tokens: int = 300) -> dict:
    """One answer held to a JSON schema. `examples` are (question, answer) pairs shown before the question."""
    messages = [{"role": "system", "content": system}]
    for q, a in examples:
        messages += [{"role": "user", "content": q}, {"role": "assistant", "content": json.dumps(a, ensure_ascii=False)}]
    messages.append({"role": "user", "content": text})
    body = {
        "model": AI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
        # Qwen3.5 thinks before it answers unless told not to: slower, and nothing to gain here.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    try:
        resp = http.post(f"{AI_URL}/chat/completions", json=body, timeout=AI_TIMEOUT)
    except httpx.TimeoutException:
        # Slow, not gone: a run's first answer also reads the long shared instructions and examples (60–95 s on the
        # runner, now and then over AI_TIMEOUT). One more try with twice the time; a second timeout is a TransportError
        # for the caller (`server_gone`).
        print(f"  … {name}: no answer in {AI_TIMEOUT:.0f}s, trying once more")
        resp = http.post(f"{AI_URL}/chat/completions", json=body, timeout=2 * AI_TIMEOUT)
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(content)


def ask(http: httpx.Client, text: str, temperature: float = 0.0) -> dict:
    return chat(http, SYSTEM, EXAMPLES, text, SCHEMA, name="story", temperature=temperature)


def _fa_share(s: str) -> float:
    letters = re.findall(r"[^\W\d_]", s)
    return sum(1 for c in letters if "؀" <= c <= "ۿ") / len(letters) if letters else 0.0


def problems(answer: dict) -> list[str]:
    """What's wrong with an answer (empty: fine)."""
    out = []
    title = (answer.get("title") or "").strip()
    short = (answer.get("short") or "").strip()
    if not 25 <= len(title) <= 100:
        out.append(f"title length {len(title)}")
    if _fa_share(title) < 0.45:
        out.append("title not Persian enough")
    if GREETING.search(title) or GREETING.search(short):
        out.append("colloquial words")
    if not 4 <= len(short) <= 48:
        out.append(f"short length {len(short)}")
    if any(t not in TOPICS for t in answer.get("topics") or []):
        out.append("unknown topic")
    if answer.get("type") not in TYPES:
        out.append("unknown type")
    return out


def grounded(topics: list[str], text: str) -> list[str]:
    """The model's topics that the text names (shape.named): on the golden set this took its precision from 49% to 83%
    (it put آنتروپیک on Perplexity and Liquid AI stories, ایلان ماسک on Jensen Huang's) and kept the best sections."""
    return [t for t in topics if shape.named(t, text)]


def tidy(answer: dict, text: str = "") -> dict:
    title = re.sub(r"\s+", " ", answer["title"]).strip().rstrip(".。")
    short = re.sub(r"\s+", " ", answer["short"]).strip().rstrip(".")
    topics = grounded(list(dict.fromkeys(t for t in answer.get("topics") or [] if t in TOPICS))[:3], text)
    return {"title": title, "short": short, "topics": topics, "type": answer["type"]}


def work_out(http: httpx.Client, post: dict) -> dict:
    """The `ai` field for one post: the answer, or {"failed": true} after a retry."""
    text = source_input(post)
    stamp = {"model": AI_MODEL, "v": PROMPT_V, "src": input_hash(text)}
    for temperature in (0.0, 0.2):
        try:
            answer = ask(http, text, temperature)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            print(f"  ! ai {post['id']}: {exc}")
            if isinstance(exc, httpx.TransportError):
                raise  # the server is gone: stop this run
            continue
        bad = problems(answer)
        if not bad:
            return {**tidy(answer, text), **stamp}
        print(f"  ! ai {post['id']}: {', '.join(bad)}: {answer.get('title')!r}")
    return {"failed": True, **stamp}


# ---- runs ----

# The later calls' answers (pipeline/ai_more.py) live in the same `ai` field and are kept when the headline is redone.
LATER = ("x", "story", "speech", "en")


def merged(post: dict, ai: dict) -> dict:
    old = post.get("ai") or {}
    return {**ai, **{k: old[k] for k in LATER if k in old}}


def load_posts() -> list[dict]:
    return [json.loads(p.read_text("utf-8")) for p in config.POSTS_DIR.glob("*.json")]


def due(posts: list[dict], everything: bool = False) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=AI_RECENT_DAYS)
    recent = lambda p: everything or datetime.fromisoformat(p["date"]) >= since
    return sorted((p for p in posts if recent(p) and is_due(p)), key=lambda p: p["id"], reverse=True)


def save(post: dict) -> None:
    path = config.POSTS_DIR / f"{post['id']}.json"
    path.write_text(json.dumps(post, ensure_ascii=False, indent=1) + "\n", "utf-8")


def run(everything: bool = False, budget: float = AI_BUDGET, limit: Optional[int] = None) -> int:
    todo = due(load_posts(), everything)[:limit]
    print(f"ai: {len(todo)} posts to work out with {AI_MODEL}")
    done, start = 0, time.monotonic()
    with httpx.Client() as http:
        for post in todo:
            if time.monotonic() - start > budget:
                print(f"ai: budget of {budget:.0f}s used; {len(todo) - done} left for the next run")
                break
            t = time.monotonic()
            try:
                post["ai"] = merged(post, work_out(http, post))
            except httpx.TransportError as exc:
                server_gone("ai", exc, len(todo) - done)
                break
            save(post)
            done += 1
            print(f"  ✓ {post['id']} ({time.monotonic() - t:.1f}s): {post['ai'].get('title', 'failed')}")
    return done


def server_gone(what: str, exc: Exception, left: int) -> None:
    """The model server stopped answering: keep what is saved, leave the rest to the next run, and don't fail the job
    (a crawl's AI step and every backfill chunk commit what was done; the next run starts a fresh server)."""
    print(f"::warning::{what}: the model server stopped answering ({type(exc).__name__}: {exc}); {left} left for the next run")


# ---- the golden set ----

GOLDEN = config.ROOT / "pipeline" / "tests" / "golden.json"


def _pr(got: list[str], want: list[str]) -> tuple[int, int, int]:
    g, w = set(got), set(want)
    return len(g & w), len(g), len(w)


def evaluate() -> None:
    """Topics and type against hand-checked answers, next to the keyword rules; headline rule passes; seconds per post."""
    golden = json.loads(GOLDEN.read_text("utf-8"))
    names = ("ai raw", "ai", "rules", "site")  # ai = grounded, as stored; site = what the site shows (ai, else rules)
    stats = {k: [0, 0, 0] for k in names}
    first = {k: 0 for k in names}
    types = passes = n = 0
    times = []
    with httpx.Client() as http:
        for item in golden:
            post = json.loads((config.POSTS_DIR / f"{item['id']}.json").read_text("utf-8"))
            text = source_input(post)
            t = time.monotonic()
            try:
                answer = ask(http, text)
            except Exception as exc:  # noqa: BLE001 — report and go on
                print(f"#{item['id']}: {exc}")
                continue
            times.append(time.monotonic() - t)
            n += 1
            bad = problems(answer)
            passes += not bad
            rules = [t for t in post["article"]["tags"] if t != "هوش مصنوعی"]
            raw = [t for t in answer.get("topics") or [] if t in TOPICS]
            mine = grounded(raw, text)
            for name, got in (("ai raw", raw), ("ai", mine), ("rules", rules), ("site", mine or rules)):
                stats[name] = [a + b for a, b in zip(stats[name], _pr(got, item["topics"]))]
                first[name] += bool(got) == bool(item["topics"]) and (not got or got[0] == item["topics"][0])
            types += answer.get("type") == item["type"]
            print(f"#{item['id']} {times[-1]:.1f}s {'ok' if not bad else bad}\n  ai:    {answer.get('title')} | {answer.get('short')} | {answer.get('topics')} | {answer.get('type')}"
                  f"{'' if mine == raw else f' → {mine}'}"
                  f"\n  rules: {post['article']['title'][:90]} | {rules}\n  want:  {item.get('title', '')} | {item['topics']} | {item['type']}")
    if not n:
        return
    print(f"\n{n} posts, {sum(times) / n:.1f}s per post (max {max(times):.1f}s), headline rules passed {passes}/{n}")
    for name in names:
        hit, got, want = stats[name]
        print(f"topics {name:6}: precision {hit / max(got, 1):.0%}  recall {hit / max(want, 1):.0%}  section right {first[name]}/{n}")
    print(f"type: {types}/{n}")


if __name__ == "__main__":
    if "--pending" in sys.argv:
        print(len(due(load_posts(), "--all" in sys.argv)))
    elif "--eval" in sys.argv:
        evaluate()
    else:
        limit = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--limit=")), None)
        run("--all" in sys.argv, float(os.getenv("AI_BUDGET", "1e9" if "--all" in sys.argv else str(AI_BUDGET))), limit)
