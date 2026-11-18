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
AI_MODEL = os.getenv("AI_MODEL", "qwen3.5-4b-q4_k_m")
AI_BUDGET = float(os.getenv("AI_BUDGET", "300"))  # seconds of model time per run; the rest waits for the next run
AI_RECENT_DAYS = float(os.getenv("AI_RECENT_DAYS", "3"))  # a normal run only looks at posts this new
AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "180"))
PROMPT_V = 1  # bump when the prompt or the rules change: every post is worked out again

TOPICS = [t[0] for t in shape.TOPICS]
TYPES = ["خبر", "ابزار و محصول", "پژوهش و مقاله", "آموزش", "نظر و تحلیل", "ویدیوی مهرزاد"]
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

topics: از این فهرست و فقط همین‌ها، حداکثر ۳ تا، مهم‌ترین اول. فقط موضوعی که خبر واقعاً درباره‌ی آن است، نه هر نامی که گذرا آمده. اگر هیچ‌کدام نمی‌خورد، فهرست خالی.
{"، ".join(TOPICS)}

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

GREETING = re.compile(r"رفقا|رفیق|سلام|داداش|ببین|بچه‌ها|میگه|می‌گه|اومده|درومده")
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

def ask(http: httpx.Client, text: str, temperature: float = 0.0) -> dict:
    messages = [{"role": "system", "content": SYSTEM}]
    for q, a in EXAMPLES:
        messages += [{"role": "user", "content": q}, {"role": "assistant", "content": json.dumps(a, ensure_ascii=False)}]
    messages.append({"role": "user", "content": text})
    resp = http.post(
        f"{AI_URL}/chat/completions",
        json={
            "model": AI_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": 300,
            "response_format": {"type": "json_schema", "json_schema": {"name": "story", "strict": True, "schema": SCHEMA}},
            # Qwen3.5 thinks before it answers unless told not to: slower, and nothing to gain for a headline.
            "chat_template_kwargs": {"enable_thinking": False},
        },
        timeout=AI_TIMEOUT,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(content)


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


def tidy(answer: dict) -> dict:
    title = re.sub(r"\s+", " ", answer["title"]).strip().rstrip(".。")
    short = re.sub(r"\s+", " ", answer["short"]).strip().rstrip(".")
    topics = list(dict.fromkeys(t for t in answer.get("topics") or [] if t in TOPICS))[:3]
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
            return {**tidy(answer), **stamp}
        print(f"  ! ai {post['id']}: {', '.join(bad)}: {answer.get('title')!r}")
    return {"failed": True, **stamp}


# ---- runs ----

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
            post["ai"] = work_out(http, post)
            save(post)
            done += 1
            print(f"  ✓ {post['id']} ({time.monotonic() - t:.1f}s): {post['ai'].get('title', 'failed')}")
    return done


# ---- the golden set ----

GOLDEN = config.ROOT / "pipeline" / "tests" / "golden.json"


def _pr(got: list[str], want: list[str]) -> tuple[int, int, int]:
    g, w = set(got), set(want)
    return len(g & w), len(g), len(w)


def evaluate() -> None:
    """Topics and type against hand-checked answers, next to the keyword rules; headline rule passes; seconds per post."""
    golden = json.loads(GOLDEN.read_text("utf-8"))
    stats = {"ai": [0, 0, 0], "rules": [0, 0, 0]}
    first = {"ai": 0, "rules": 0}
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
            for name, got in (("ai", answer.get("topics") or []), ("rules", rules)):
                stats[name] = [a + b for a, b in zip(stats[name], _pr(got, item["topics"]))]
                first[name] += bool(got) == bool(item["topics"]) and (not got or got[0] == item["topics"][0])
            types += answer.get("type") == item["type"]
            print(f"#{item['id']} {times[-1]:.1f}s {'ok' if not bad else bad}\n  ai:    {answer.get('title')} | {answer.get('short')} | {answer.get('topics')} | {answer.get('type')}"
                  f"\n  rules: {post['article']['title'][:90]} | {rules}\n  want:  {item.get('title', '')} | {item['topics']} | {item['type']}")
    if not n:
        return
    print(f"\n{n} posts, {sum(times) / n:.1f}s per post (max {max(times):.1f}s), headline rules passed {passes}/{n}")
    for name in ("ai", "rules"):
        hit, got, want = stats[name]
        print(f"topics {name:5}: precision {hit / max(got, 1):.0%}  recall {hit / max(want, 1):.0%}  section right {first[name]}/{n}")
    print(f"type: {types}/{n}")


if __name__ == "__main__":
    if "--pending" in sys.argv:
        print(len(due(load_posts(), "--all" in sys.argv)))
    elif "--eval" in sys.argv:
        evaluate()
    else:
        limit = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--limit=")), None)
        run("--all" in sys.argv, float(os.getenv("AI_BUDGET", "1e9" if "--all" in sys.argv else str(AI_BUDGET))), limit)
