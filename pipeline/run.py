"""Crawl the channel → attach Gholam's comment → open links → data/posts/<id>.json

Everything published comes from the channel itself (post, link content, Gholam's Persian comment).
Media is never downloaded: posts keep the original image/video URLs.

Usage:  python -m pipeline.run            (cron: newest page only)
        PAGES=10 python -m pipeline.run   (backfill older posts)
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Optional

from . import config, enrich, shape, telegram

DIGEST_RE = re.compile(r"(خلاصه\s+اخبار\s*(?:۲۴|24)\s*ساعت|24[-\s]?hour\s+(?:news\s+summary|daily\s+digest)|daily\s+digest)", re.I)


def load(post_id: int) -> Optional[dict]:
    path = config.POSTS_DIR / f"{post_id}.json"
    return json.loads(path.read_text("utf-8")) if path.exists() else None


def save(post: dict) -> None:
    config.POSTS_DIR.mkdir(parents=True, exist_ok=True)
    path = config.POSTS_DIR / f"{post['id']}.json"
    path.write_text(json.dumps(post, ensure_ascii=False, indent=1) + "\n", "utf-8")


def age_hours(iso: str) -> float:
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds() / 3600
    except ValueError:
        return 1e9


def tg_media(tp: telegram.TgPost) -> list[dict]:
    return [
        {"type": m.type, "src": m.url, "poster": m.thumb, "ratio": m.ratio, "duration": m.duration}
        if m.type == "video"
        else {"type": "image", "src": m.url, "ratio": m.ratio}
        for m in tp.media
    ]


def build_article(post: dict) -> dict:
    """Persian presentation fields derived from Gholam's comment + the source content."""
    links = post.get("links") or []
    gholam = post.get("gholam") or {}
    paras, why = shape.split_gholam(gholam.get("text", "")) if gholam else ([], None)
    src_title = shape.source_title(post.get("text", ""), links, post.get("preview"))
    title = shape.headline(paras) or src_title or shape.clip(post.get("text", ""), 110) or f"پست {post['id']}"
    english = " ".join(
        [post.get("text", "")]
        + [l.get("text") or "" for l in links]
        + [l.get("title") or "" for l in links]
        + [(l.get("article") or {}).get("title") or "" for l in links]
    )
    return {
        "title": title,
        "source_title": src_title if src_title != title else None,
        "body": paras,
        "why": why,
        "tags": shape.tags(english, gholam.get("text", "")),
    }


def process(http, tp: telegram.TgPost) -> None:
    existing = load(tp.id) or {}
    src_hash = hashlib.sha1((tp.text + "|" + "|".join(tp.links) + "|" + str(len(tp.media))).encode()).hexdigest()[:12]
    changed = existing.get("hash") != src_hash

    post = {
        "id": tp.id,
        "url": f"https://t.me/{config.CHANNEL}/{tp.id}",
        "date": tp.date,
        "text": tp.text,
        "forwarded_from": tp.forwarded_from,
        "digest": bool(DIGEST_RE.search(tp.text)),
        "hash": src_hash,
        # Telegram's CDN URLs are signed and can rotate, so they are refreshed on every crawl (no download, no cost).
        "media": tg_media(tp),
        "preview": {**tp.preview} if tp.preview else None,
    }

    # Gholam's comment: keep checking until he replies (or the post is too old to expect one).
    gholam = existing.get("gholam")
    if (not gholam or changed) and age_hours(tp.date) < config.GHOLAM_POLL_HOURS:
        found = telegram.fetch_gholam_comment(http, tp.id)
        if found:
            if found["text"] != (gholam or {}).get("text"):
                print(f"  ✓ gholam comment for {tp.id}")
            gholam = found
    post["gholam"] = gholam

    # Linked tweets/pages are only re-read when the post itself changed.
    post["links"] = existing["links"] if not changed and "links" in existing else enrich.enrich_links(http, tp.links)

    if not tp.text and not post["links"] and not post["media"]:
        return  # service message or media Telegram won't show on the web

    post["article"] = build_article(post)
    post["updated"] = existing.get("updated")
    if needs_save(post, existing):
        post["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        save(post)


TG_CDN_RE = re.compile(r"https://[\w.-]*telesco\.pe/[^\"\s]+")


def needs_save(post: dict, existing: dict) -> bool:
    """Changed, ignoring Telegram's re-signed CDN URLs until the stored ones are URL_REFRESH_HOURS old."""
    if post == existing:
        return False
    strip = lambda p: TG_CDN_RE.sub("", json.dumps(p, ensure_ascii=False, sort_keys=True))
    return strip(post) != strip(existing) or age_hours(existing.get("updated") or "") >= config.URL_REFRESH_HOURS


def refresh_articles() -> None:
    """Re-derive article fields for every stored post (run after changing shape.py)."""
    for path in sorted(config.POSTS_DIR.glob("*.json")):
        post = json.loads(path.read_text("utf-8"))
        post["digest"] = bool(DIGEST_RE.search(post.get("text", "")))
        post["article"] = build_article(post)
        save(post)


def main() -> None:
    config.POSTS_DIR.mkdir(parents=True, exist_ok=True)
    with telegram.client() as http:
        info, posts = telegram.fetch_posts(http, config.PAGES)
        print(f"fetched {len(posts)} posts from @{config.CHANNEL}")
        if not posts:
            raise SystemExit("no posts found — is the channel public and t.me reachable?")
        if info.get("title"):
            info["username"] = config.CHANNEL
            (config.DATA_DIR / "channel.json").write_text(json.dumps(info, ensure_ascii=False, indent=1) + "\n", "utf-8")
        for tp in reversed(posts):
            print(f"- post {tp.id}")
            try:
                process(http, tp)
            except Exception as exc:  # one broken post must not stop the run
                print(f"  ! failed {tp.id}: {exc!r}")


if __name__ == "__main__":
    import sys

    refresh_articles() if "--refresh" in sys.argv else main()
