"""The morning podcast's host lines (PLAN.md P2-7) and the weekly recap (P2-11), by the same small model.

Daily: for the newest Tehran day's stories, a greeting with the day's highlights, one line that leads into each story,
and a sign-off, in data/daily/<day>.json. The home page's «پادکست خبرهای امروز» (src/scripts/playlist.ts) says the
greeting, each story's line before its headline, and the sign-off — in whatever order and subset the reader's settings
pick, so a line never refers to "the next" story. Done again when the day's stories change, at most every REDO_MIN.

Weekly: «هفته‌ای که گذشت», the week's ~8 stories that mattered most (most read, from the site's /api/stats/, then the
most important by ai.x.importance), each in one line, in data/weekly/<friday>.json; shown at the top of /week/ and
readable aloud. Run on Friday morning (Tehran) by .github/workflows/weekly.yml.

    python -m pipeline.daily             # today's host lines, if due
    python -m pipeline.daily --weekly    # this week's recap
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from . import ai, ai_more, config

DAILY_DIR = config.DATA_DIR / "daily"
WEEKLY_DIR = config.DATA_DIR / "weekly"
SITE = os.getenv("SITE", "https://blog.remixt.app").rstrip("/")
REDO_MIN = float(os.getenv("DAILY_REDO_MIN", "90"))
TEHRAN = timezone(timedelta(hours=3, minutes=30))
MAX_ITEMS = 25


def tehran_day(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(TEHRAN).date().isoformat()


def title_of(p: dict) -> str:
    return (p.get("ai") or {}).get("title") or p["article"]["title"]


def stories(posts: list[dict]) -> list[dict]:
    """Posts the site lists as stories: Gholam's (or the model's) Persian text, not a digest."""
    out = []
    for p in posts:
        if p.get("digest"):
            continue
        if ai_more.gholam_text(p) and p["article"].get("body") or ((p.get("ai") or {}).get("story") or {}).get("body"):
            out.append(p)
    return sorted(out, key=lambda p: p["id"], reverse=True)


def line_ok(s: str, n: int = 200) -> bool:
    s = (s or "").strip()
    return 10 <= len(s) <= n and ai_more.fa_share(s) >= 0.6 and not ai.GREETING.search(s.replace("سلام", ""))


# ---------------------------------------------------------------- daily

DAILY_SCHEMA = {
    "type": "object",
    "properties": {
        "intro": {"type": "string"},
        "items": {
            "type": "array",
            "items": {"type": "object", "properties": {"id": {"type": "integer"}, "line": {"type": "string"}}, "required": ["id", "line"], "additionalProperties": False},
        },
        "outro": {"type": "string"},
    },
    "required": ["intro", "items", "outro"],
    "additionalProperties": False,
}
DAILY_SYSTEM = """تو گوینده‌ی یک پادکست کوتاه صبحگاهی خبرهای هوش مصنوعی به فارسی هستی، گرم و صمیمی ولی به فارسی معیار و روان. فهرست خبرهای امروز را می‌گیری. فقط JSON بده.
intro: یک یا دو جمله‌ی خوشامد («صبح بخیر» یا «سلام»)، تعداد خبرها، و اشاره به دو یا سه خبر مهم‌تر. حداکثر ۲۲۰ نویسه.
items: برای هر خبر (با همان id) یک جمله‌ی کوتاه که شنونده را به آن خبر ببرد، مثل «برویم سراغ اوپن‌ای‌آی که…» یا «خبر بعدی از دنیای رباتیک است». هر جمله مستقل باشد و به خبر قبلی یا بعدی اشاره نکند، چون ترتیب خبرها برای هر شنونده فرق می‌کند. حداکثر ۱۲۰ نویسه، و تیتر را تکرار نکن.
outro: یک جمله‌ی خداحافظی کوتاه، و دعوت به خواندن متن کامل خبرها در سایت."""


def daily(posts: list[dict], force: bool = False) -> Optional[dict]:
    todo = stories(posts)
    if not todo:
        return None
    day = tehran_day(todo[0]["date"])
    today = [p for p in todo if tehran_day(p["date"]) == day][:MAX_ITEMS]
    path = DAILY_DIR / f"{day}.json"
    ids = [p["id"] for p in today]
    if path.exists() and not force:
        old = json.loads(path.read_text("utf-8"))
        if old.get("ids") == ids:
            return None
        if time.time() - path.stat().st_mtime < REDO_MIN * 60:
            print(f"daily: {day} was written {int((time.time() - path.stat().st_mtime) / 60)} min ago; next time")
            return None
    text = "\n".join(f"{p['id']}: {title_of(p)}" for p in today)
    with httpx.Client() as http:
        for temperature in (0.3, 0.6):
            try:
                a = ai.chat(http, DAILY_SYSTEM, [], f"تعداد خبرها: {len(today)}\n{text}", DAILY_SCHEMA, name="daily", temperature=temperature, max_tokens=120 + 70 * len(today))
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                print(f"daily: {exc}")
                if isinstance(exc, httpx.TransportError):
                    return None
                continue
            links = {str(i["id"]): re.sub(r"\s+", " ", i["line"]).strip() for i in a.get("items") or [] if i.get("id") in ids and line_ok(i.get("line"), 160)}
            if line_ok(a.get("intro"), 280) and line_ok(a.get("outro"), 200) and len(links) >= len(ids) // 2:
                out = {"day": day, "intro": a["intro"].strip(), "links": links, "outro": a["outro"].strip(), "ids": ids, "model": ai.AI_MODEL}
                DAILY_DIR.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
                print(f"daily: {day}, {len(links)} of {len(ids)} stories")
                return out
            print("daily: answer didn't pass the checks")
    return None


# ---------------------------------------------------------------- weekly

WEEKLY_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "intro": {"type": "string"},
        "items": {
            "type": "array",
            "items": {"type": "object", "properties": {"id": {"type": "integer"}, "line": {"type": "string"}}, "required": ["id", "line"], "additionalProperties": False},
        },
        "outro": {"type": "string"},
    },
    "required": ["title", "intro", "items", "outro"],
    "additionalProperties": False,
}
WEEKLY_SYSTEM = """تو دبیر خبر یک سایت فارسی خبرهای هوش مصنوعی هستی و مرور هفتگی «هفته‌ای که گذشت» را می‌نویسی، به فارسی معیار و روان. فهرست مهم‌ترین خبرهای هفته را با متن کوتاهشان می‌گیری. فقط JSON بده.
title: یک تیتر کوتاه برای این هفته که مهم‌ترین اتفاق را بگوید (حداکثر ۷۰ نویسه).
intro: دو جمله که حال‌وهوای هفته را بگوید.
items: برای هر خبر (با همان id) یک جمله‌ی خبری کامل که بگوید چه شد و چرا مهم بود (حداکثر ۱۸۰ نویسه). فقط از متن خود خبر.
outro: یک جمله‌ی پایانی کوتاه."""


def week_key(now: Optional[datetime] = None) -> tuple[str, datetime, datetime]:
    """This week, Saturday to Friday (Tehran): its Friday's date as the key, and its start and end."""
    now = (now or datetime.now(timezone.utc)).astimezone(TEHRAN)
    friday = now.date() - timedelta(days=(now.weekday() - 4) % 7)  # the latest Friday, today included
    end = datetime.combine(friday + timedelta(days=1), datetime.min.time(), TEHRAN)
    return friday.isoformat(), end - timedelta(days=7), end


def top_week() -> list[int]:
    try:
        data = httpx.get(f"{SITE}/api/stats/", timeout=20).json()
        return [int(t["id"]) for t in (data.get("top") or {}).get("week") or []]
    except Exception as exc:  # noqa: BLE001 — the importance ranking still works without the counts
        print(f"weekly: no view counts ({exc})")
        return []


def weekly(posts: list[dict], now: Optional[datetime] = None, force: bool = False) -> Optional[dict]:
    key, start, end = week_key(now)
    path = WEEKLY_DIR / f"{key}.json"
    if path.exists() and not force:
        print(f"weekly: {key} is done")
        return None
    in_week = [p for p in stories(posts) if start <= datetime.fromisoformat(p["date"]) < end]
    if len(in_week) < 4:
        print("weekly: too few stories this week")
        return None
    by_id = {p["id"]: p for p in in_week}
    pick = [i for i in top_week() if i in by_id][:5]
    importance = lambda p: (((p.get("ai") or {}).get("x") or {}).get("importance") or 0, p["id"])
    for p in sorted(in_week, key=importance, reverse=True):
        if len(pick) >= 8:
            break
        if p["id"] not in pick:
            pick.append(p["id"])
    pick.sort(key=lambda i: importance(by_id[i]), reverse=True)
    text = "\n\n".join(f"{i}: {title_of(by_id[i])}\n{ai_more.shape.clip(' '.join(by_id[i]['article'].get('body') or ((by_id[i].get('ai') or {}).get('story') or {}).get('body') or []), 500)}" for i in pick)
    with httpx.Client() as http:
        for temperature in (0.2, 0.5):
            try:
                a = ai.chat(http, WEEKLY_SYSTEM, [], text, WEEKLY_SCHEMA, name="weekly", temperature=temperature, max_tokens=1600)
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                print(f"weekly: {exc}")
                if isinstance(exc, httpx.TransportError):
                    return None
                continue
            items = [{"id": i["id"], "line": re.sub(r"\s+", " ", i["line"]).strip()} for i in a.get("items") or [] if i.get("id") in by_id and line_ok(i.get("line"), 260)]
            if line_ok(a.get("title"), 90) and line_ok(a.get("intro"), 360) and len(items) >= 4:
                out = {"week": key, "from": start.date().isoformat(), "to": (end - timedelta(days=1)).date().isoformat(), "title": a["title"].strip(),
                       "intro": a["intro"].strip(), "items": items, "outro": (a.get("outro") or "").strip(), "model": ai.AI_MODEL}
                WEEKLY_DIR.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
                print(f"weekly: {key}, {len(items)} stories: {out['title']}")
                return out
            print("weekly: answer didn't pass the checks")
    return None


if __name__ == "__main__":
    posts = ai.load_posts()
    if "--weekly" in sys.argv:
        weekly(posts, force="--force" in sys.argv)
    else:
        daily(posts, force="--force" in sys.argv)
