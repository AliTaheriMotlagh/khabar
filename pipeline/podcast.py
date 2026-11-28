"""«پادکست خبر»: the day's stories as a conversation between two hosts — غلام (the channel's voice: explains, friendly,
in his colloquial Persian) and پریسا (asks what a listener would ask: what is it, why does it matter) — written by the
same small model, a story at a time, then made into sound on the runner (scripts/podcast.mjs: the site's own Cilla
voices in headless Chrome) and published to R2 with its podcast feed (/podcast.xml).

Every exchange is checked against the story it's about: each number and each Latin name in a line must be in that
story's text (Gholam's, or the source's), lines are Persian, short enough to say in one breath. An exchange that fails
is replaced by a fixed one built from the story's own sentences (`fallback`) — so a day always has its episode, and
nothing in it is the model's invention.

    python -m pipeline.podcast                 # the newest Tehran day's episode, if not written yet
    python -m pipeline.podcast --day 2026-11-27 --force
    python -m pipeline.podcast --no-model      # only the fixed exchanges (no llama-server needed)
    python -m pipeline.podcast --yesterday     # yesterday's (Tehran) episode: the morning run
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from . import ai, ai_more, config
from .daily import stories, tehran_day, title_of

DIR = config.DATA_DIR / "podcast"
V = 1
MAX_STORIES = 7
LINE_MAX = 280
HOSTS = {"g": "غلام", "p": "پریسا"}

SCHEMA = {
    "type": "object",
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"who": {"type": "string", "enum": ["g", "p"]}, "text": {"type": "string"}},
                "required": ["who", "text"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["lines"],
    "additionalProperties": False,
}
SYSTEM = """تو نویسنده‌ی یک پادکست خبری دونفره‌ی هوش مصنوعی به فارسی هستی. دو مجری:
g = «غلام»: خبر را توضیح می‌دهد، خودمانی و گرم، مثل یک رفیق باسواد. فقط چیزهایی را می‌گوید که در متن خبر آمده.
p = «پریسا»: کنجکاو است و سؤالی را می‌پرسد که یک شنونده‌ی معمولی می‌پرسد («یعنی چی؟»، «به درد کی می‌خوره؟»، «چرا مهمه؟»).
از روی متن یک خبر، یک گفت‌وگوی کوتاه ۴ تا ۶ خطی بنویس: اول p با یک سؤال یا جمله‌ی کوتاه خبر را شروع کند، بعد g توضیح بدهد، و به نوبت.
قوانین: هیچ عدد، اسم، تاریخ یا ادعایی را که در متن خبر نیست اضافه نکن. اسم‌های انگلیسی را همان‌طور که در متن آمده بنویس. هر خط حداکثر دو جمله و کمتر از ۲۵۰ نویسه. سلام و خداحافظی نکن (این گفت‌وگو وسط برنامه است). فقط JSON بده."""

DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
NUM = re.compile(r"\d+(?:[.,/]\d+)*")
LATIN = re.compile(r"[A-Za-z][A-Za-z0-9.\-+]*")


def source_text(p: dict) -> str:
    """Everything the story says: Gholam's text (or the model's translation), its closing take, the source post."""
    a = p["article"]
    parts = [title_of(p), *a.get("body", []), a.get("why") or ""]
    parts += [l.get("text") or "" for l in p.get("links") or []] + [l.get("title") or "" for l in p.get("links") or []]
    parts += ((p.get("ai") or {}).get("story") or {}).get("body") or []
    return "\n".join(parts)


def grounded(line: str, src: str) -> bool:
    """Each number and Latin name of `line` appears in the story's text."""
    s = src.translate(DIGITS)
    for n in NUM.findall(line.translate(DIGITS)):
        if n not in s:
            return False
    low = s.lower()
    return all(w.lower().strip(".-") in low for w in LATIN.findall(line))


def line_ok(text: str, src: str) -> bool:
    t = (text or "").strip()
    return 6 <= len(t) <= LINE_MAX and ai_more.fa_share(t) >= 0.55 and "http" not in t and grounded(t, src)


def sentences(text: str, n: int) -> str:
    """The first `n` sentences, at most LINE_MAX characters."""
    parts = re.split(r"(?<=[.!؟?])\s+", re.sub(r"\s+", " ", text).strip())
    out = ""
    for s in parts[:n]:
        if len(out) + len(s) + 1 > LINE_MAX:
            break
        out = f"{out} {s}".strip()
    return out or text[:LINE_MAX].rsplit(" ", 1)[0]


def strip_bullet(t: str) -> str:
    return re.sub(r"^\s*[•●▪*\-–—]\s*", "", t).strip()


def fallback(p: dict) -> list[dict]:
    """An exchange from the story's own sentences: the question, Gholam's opening, why it matters."""
    a = p["article"]
    body = [strip_bullet(t) for t in a.get("body", []) if strip_bullet(t) and "http" not in t]
    short = ((p.get("ai") or {}).get("short") or title_of(p)).strip()
    lines = [{"who": "p", "text": f"خب غلام، {short}؛ قضیه چیه؟"}]
    if body:
        lines.append({"who": "g", "text": sentences(body[0], 2)})
    if len(body) > 1:
        lines.append({"who": "p", "text": "جزئیات بیشترش چیه؟"})
        lines.append({"who": "g", "text": sentences(body[1], 2)})
    if a.get("why"):
        lines.append({"who": "p", "text": "حالا چرا این مهمه؟"})
        lines.append({"who": "g", "text": sentences(a["why"], 2)})
    return lines


def exchange(http: Optional[httpx.Client], p: dict) -> tuple[list[dict], bool]:
    """The model's exchange about one story when it passes the checks, else the fixed one. (lines, by_model)"""
    src = source_text(p)
    if http is not None:
        a = p["article"]
        text = "\n".join([f"تیتر: {title_of(p)}", *[strip_bullet(t) for t in a.get("body", [])], f"چرا مهمه: {a.get('why') or ''}"])
        for temperature in (0.4, 0.7):
            try:
                ans = ai.chat(http, SYSTEM, [], text[:3500], SCHEMA, name="podcast", temperature=temperature, max_tokens=700)
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                print(f"podcast {p['id']}: {exc}")
                if isinstance(exc, httpx.TransportError):
                    break
                continue
            lines = [{"who": l["who"], "text": re.sub(r"\s+", " ", l["text"]).strip()} for l in ans.get("lines") or [] if l.get("who") in HOSTS]
            bad = [l["text"] for l in lines if not line_ok(l["text"], src)]
            if 3 <= len(lines) <= 8 and not bad and lines[0]["who"] == "p" and any(l["who"] == "g" for l in lines):
                return lines, True
            print(f"podcast {p['id']}: answer didn't pass ({len(lines)} lines; {bad[:1]})")
    return fallback(p), False


def episode(posts: list[dict], day: Optional[str] = None, use_model: bool = True, force: bool = False) -> Optional[dict]:
    todo = stories(posts)
    if not todo:
        return None
    day = day or tehran_day(todo[0]["date"])
    today = [p for p in todo if tehran_day(p["date"]) == day]
    # The most important first, then the newest; at most MAX_STORIES.
    today.sort(key=lambda p: (-(((p.get("ai") or {}).get("x") or {}).get("importance") or 0), -p["id"]))
    today = today[:MAX_STORIES]
    if not today:
        return None
    path = DIR / f"{day}.json"
    ids = [p["id"] for p in today]
    if path.exists() and not force:
        old = json.loads(path.read_text("utf-8"))
        # The same stories, written the same way — or by the model already, or with no model to ask: nothing to do.
        if old.get("ids") == ids and old.get("v") == V and (old.get("by_model") or not use_model):
            return None
    by_model = 0
    lines: list[dict] = []
    n = len(today)
    fa = str(n).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
    lines.append({"who": "g", "text": f"سلام رفقا! من غلامم و این‌جا پادکست خبرهای هوش مصنوعیه. امروز {fa} خبر داریم."})
    lines.append({"who": "p", "text": "سلام به همه، من هم پریسام. بریم سراغ خبرها."})
    http = httpx.Client() if use_model else None
    try:
        for k, p in enumerate(today):
            ex, m = exchange(http, p)
            by_model += m
            # The story's place, said by Gholam before the exchange (fixed: grounded).
            if k:
                lines.append({"who": "g", "text": "خبر بعدی." if k < n - 1 else "و خبر آخر."})
            lines += [{**l, "id": p["id"]} for l in ex]
    finally:
        if http is not None:
            http.close()
    lines.append({"who": "g", "text": "همین بود رفقا. متن کامل و منبع هر خبر توی سایت هست."})
    lines.append({"who": "p", "text": "ممنون که با ما بودید. تا خبرهای بعدی، خدانگهدار!"})
    out = {
        "day": day,
        "v": V,
        "title": f"پادکست خبر · {fa} خبر",
        "ids": ids,
        "hosts": HOSTS,
        "lines": lines,
        "model": ai.AI_MODEL if by_model else None,
        "by_model": by_model,
    }
    DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"podcast: {day}, {len(today)} stories ({by_model} by the model), {len(lines)} lines")
    return out


def main(argv: list[str]) -> None:
    posts = [json.loads(f.read_text("utf-8")) for f in sorted(config.POSTS_DIR.glob("*.json"))]
    day = argv[argv.index("--day") + 1] if "--day" in argv else None
    # The morning run: yesterday's whole day (Tehran), every story in it.
    if "--yesterday" in argv:
        day = (datetime.now(timezone(timedelta(hours=3, minutes=30))) - timedelta(days=1)).date().isoformat()
    episode(posts, day, use_model="--no-model" not in argv, force="--force" in argv)


if __name__ == "__main__":
    main(sys.argv[1:])
