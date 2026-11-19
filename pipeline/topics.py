"""«این روزها در …»: a short intro at the top of each topic page, from the topic's recent headlines (PLAN.md P3-4).

Once a week (.github/workflows/weekly.yml), for every topic with at least MIN_STORIES stories in the last DAYS days,
the model writes two or three sentences on what has been happening there. A topic is asked again only when its
headlines changed; one that went quiet keeps no intro (the page shows none rather than a stale one).
Written to data/topics.json.

    python -m pipeline.topics
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from . import ai, config, threads

V = 1
TOPICS = config.DATA_DIR / "topics.json"
DAYS = 14
MIN_STORIES = 3
MAX_STORIES = 15
BUDGET = float(os.getenv("TOPICS_BUDGET", "900"))
HIDDEN = {"هوش مصنوعی"}

SCHEMA = {
    "type": "object",
    "properties": {"intro": {"type": "string"}},
    "required": ["intro"],
    "additionalProperties": False,
}
SYSTEM = """تو دبیر یک سایت فارسی خبرهای هوش مصنوعی هستی. تیتر خبرهای دو هفته‌ی اخیرِ یک موضوع می‌آید. فقط JSON بده، به فارسی معیار (نه محاوره):
intro: ۲ یا ۳ جمله‌ی کوتاه (۸۰ تا ۳۲۰ نویسه) که این روزها در این موضوع چه گذشته: مهم‌ترین رویدادها و روندی که دیده می‌شود. با نام موضوع شروع نکن («در دنیای …» نه).
فقط از همین تیترها بگو؛ چیزی اضافه نکن و حدس نزن."""


def topics_of(post: dict) -> list[str]:
    """The topics the site files a story under (src/lib/posts.ts topicsOf): the model's from prompt v2, else the rules'."""
    a = post.get("ai") or {}
    if not post.get("digest") and a and not a.get("failed") and (a.get("v") or 0) >= 2 and a.get("topics"):
        return a["topics"]
    return (post.get("article") or {}).get("tags") or []


def recent(posts: list[dict], now: Optional[datetime] = None) -> dict[str, list[dict]]:
    since = (now or datetime.now(timezone.utc)) - timedelta(days=DAYS)
    by_topic: dict[str, list[dict]] = {}
    for p in sorted(posts, key=lambda p: p["id"], reverse=True):
        if p.get("digest") or datetime.fromisoformat(p["date"]) < since or not threads.headline(p):
            continue
        for t in topics_of(p):
            if t not in HIDDEN:
                by_topic.setdefault(t, []).append(p)
    return {t: ps for t, ps in by_topic.items() if len(ps) >= MIN_STORIES}


def topic_input(topic: str, posts: list[dict]) -> str:
    lines = [f"{p['date'][:10]} — {threads.headline(p)}" for p in posts[:MAX_STORIES]]
    return f"موضوع: {topic}\n" + "\n".join(lines)


def problems(intro: str) -> list[str]:
    out = []
    if not 60 <= len(intro) <= 360:
        out.append(f"length {len(intro)}")
    if ai._fa_share(intro) < 0.6:
        out.append("not Persian enough")
    if ai.GREETING.search(intro):
        out.append("colloquial words")
    return out


def run(budget: float = BUDGET) -> int:
    groups = recent(ai.load_posts())
    store = threads.load(TOPICS) or {"v": V, "items": {}}
    old = store.get("items") or {}
    items: dict = {}
    start, done = time.monotonic(), 0
    with httpx.Client() as http:
        for topic, posts in sorted(groups.items(), key=lambda kv: -len(kv[1])):
            text = topic_input(topic, posts)
            prev = old.get(topic) or {}
            if prev.get("src") == ai.input_hash(text) and prev.get("v") == V:
                items[topic] = prev
                continue
            if time.monotonic() - start > budget:
                if prev.get("intro"):
                    items[topic] = prev  # next week's run does it; a week-old intro beats none
                continue
            answer = None
            for temperature in (0.0, 0.3):
                try:
                    a = ai.chat(http, SYSTEM, [], text, SCHEMA, name="topic", temperature=temperature, max_tokens=300)
                except httpx.TransportError as exc:
                    ai.server_gone("topics", exc, len(groups) - done)
                    budget = -1.0
                    break
                except (httpx.HTTPError, ValueError, KeyError):
                    continue
                intro = re.sub(r"\s+", " ", a.get("intro") or "").strip()
                if not problems(intro):
                    answer = intro
                    break
            if answer:
                items[topic] = {"intro": answer, "stories": len(posts), "src": ai.input_hash(text), "v": V, "model": ai.AI_MODEL}
                done += 1
                print(f"  ✓ {topic}: {answer[:80]}")
    store = {"v": V, "updated": datetime.now(timezone.utc).date().isoformat(), "items": items}
    TOPICS.write_text(json.dumps(store, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"topics: {done} new intros, {len(items)} in all")
    return done


if __name__ == "__main__":
    run()
