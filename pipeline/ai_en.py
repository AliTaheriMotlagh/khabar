"""English headlines for the English edition (/en/, src/lib/en.ts): `ai.en = {title, short}` from the source's own
English text — the tweet, the linked article's title and description, the quoted post — never Gholam's Persian.

One small call per post (no examples, the input capped at ~900 characters, ≤80 tokens out: a few seconds on the
runner's Qwen), held to a JSON schema and checked (length, English, no emoji or hashtags), retried once, else
`{"failed": true}` (the site then uses the linked article's title or the source's first sentence). Redone only when its
input or EN_V changes. Kept across the headline's redo (pipeline/ai.py LATER).

    python -m pipeline.ai_en            # recent posts (AI_RECENT_DAYS), within AI_EN_BUDGET seconds
    python -m pipeline.ai_en --all      # every post (ai-backfill.yml)
    python -m pipeline.ai_en --pending  # how many are due
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from . import ai

EN_V = 1
AI_EN_BUDGET = float(os.getenv("AI_EN_BUDGET", "120"))
SCHEMA = {
    "type": "object",
    "properties": {"title": {"type": "string"}, "short": {"type": "string"}},
    "required": ["title", "short"],
    "additionalProperties": False,
}
SYSTEM = (
    "You are a news editor. From the source text, write a factual English news headline (40-95 characters, "
    "sentence case, names exact, no emoji, no hashtags, no quotes around it, no clickbait) and a short version "
    "(at most 45 characters). Say only what the text says. Answer in JSON."
)
URL = re.compile(r"https?://\S+")
WALL = re.compile(r"^\s*(?:-\s*)?YouTube\s*$|^Before you continue|^X - The Everything App", re.I)
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def _latin(s: str) -> float:
    letters = re.findall(r"[^\W\d_]", s)
    return sum(1 for c in letters if c.isascii() or "À" <= c <= "ɏ") / len(letters) if letters else 0.0


def source_text(post: dict) -> Optional[str]:
    """The post's English source, as the English page shows it (src/lib/en.ts), or None when there is none."""
    if post.get("digest"):
        return None
    parts = []
    for link in post.get("links") or []:
        if link.get("kind") == "tweet" and link.get("text"):
            author = (link.get("author") or {}).get("name") or ""
            parts.append(f"Post by {author}: {link['text']}" if author else link["text"])
            quote = (link.get("quote") or {}).get("text")
            if quote:
                parts.append(f"Quoting: {quote}")
        elif link.get("title") and not WALL.search(link["title"]):
            parts.append(f"Article: {link['title']}")
            if link.get("description"):
                parts.append(link["description"])
    text = URL.sub("", "\n".join(parts)).strip()
    text = re.sub(r"[ \t]+", " ", text)
    if len(re.findall(r"[^\W\d_]", text)) < 25 or _latin(text) < 0.7:
        return None
    return text[:900]


def is_due(post: dict) -> bool:
    text = source_text(post)
    if not text:
        return False
    en = (post.get("ai") or {}).get("en") or {}
    return en.get("v") != EN_V or en.get("src") != ai.input_hash(text)


def problems(answer: dict) -> list[str]:
    title, short = (answer.get("title") or "").strip(), (answer.get("short") or "").strip()
    out = []
    if not 20 <= len(title) <= 110:
        out.append(f"title length {len(title)}")
    if not 4 <= len(short) <= 50:
        out.append(f"short length {len(short)}")
    if _latin(title) < 0.9:
        out.append("title not English")
    if EMOJI.search(title) or "#" in title:
        out.append("emoji or hashtag")
    return out


def work_out(http: httpx.Client, post: dict) -> dict:
    text = source_text(post)
    stamp = {"model": ai.AI_MODEL, "v": EN_V, "src": ai.input_hash(text)}
    for temperature in (0.0, 0.3):
        try:
            answer = ai.chat(http, SYSTEM, [], text, SCHEMA, name="en", temperature=temperature, max_tokens=80)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            print(f"  ! en {post['id']}: {exc}")
            if isinstance(exc, httpx.TransportError):
                raise
            continue
        bad = problems(answer)
        if not bad:
            title = re.sub(r"\s+", " ", answer["title"]).strip().strip('"“”').rstrip(".")
            return {"title": title, "short": re.sub(r"\s+", " ", answer["short"]).strip().rstrip("."), **stamp}
        print(f"  ! en {post['id']}: {', '.join(bad)}: {answer.get('title')!r}")
    return {"failed": True, **stamp}


def due(posts: list[dict], everything: bool = False) -> list[dict]:
    """Posts without a current English headline, newest first (only the last AI_RECENT_DAYS unless `everything`)."""
    since = datetime.now(timezone.utc) - timedelta(days=ai.AI_RECENT_DAYS)
    fresh = lambda p: everything or datetime.fromisoformat(p["date"]) >= since
    return sorted((p for p in posts if fresh(p) and is_due(p)), key=lambda p: p["id"], reverse=True)


def run(everything: bool = False, budget: float = AI_EN_BUDGET, limit: Optional[int] = None) -> int:
    todo = due(ai.load_posts(), everything)[:limit]
    print(f"ai_en: {len(todo)} English headlines to write")
    done, start = 0, time.monotonic()
    with httpx.Client() as http:
        for post in todo:
            if time.monotonic() - start > budget:
                print(f"ai_en: budget of {budget:.0f}s used; {len(todo) - done} left for the next run")
                break
            try:
                en = work_out(http, post)
            except httpx.TransportError as exc:
                ai.server_gone("ai_en", exc, len(todo) - done)
                break
            post["ai"] = {**(post.get("ai") or {}), "en": en}
            ai.save(post)
            done += 1
            print(f"  ✓ {post['id']}: {en.get('title', 'failed')}")
    return done


if __name__ == "__main__":
    if "--pending" in sys.argv:
        print(len(due(ai.load_posts(), "--all" in sys.argv)))
    else:
        limit = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--limit=")), None)
        run("--all" in sys.argv, float(os.getenv("AI_EN_BUDGET", "1e9" if "--all" in sys.argv else str(AI_EN_BUDGET))), limit)
