"""Crawl the channel → attach Gholam's comment → open links → re-host media → data/posts/<id>.json

Everything published comes from the channel itself (post, link content, Gholam's Persian comment).

Usage:  python -m pipeline.run            (cron: newest page only)
        PAGES=10 python -m pipeline.run   (backfill older posts)
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Optional

from . import config, enrich, media, shape, telegram

DIGEST_RE = re.compile(r"(خلاصه\s+اخبار\s*(?:۲۴|24)\s*ساعت|24[-\s]?hour\s+daily\s+digest|daily\s+digest)", re.I)


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


def localize_link(http, post_id: int, i: int, link: dict) -> dict:
    link = dict(link)
    folder = config.MEDIA_DIR / str(post_id)
    if link.get("media"):
        link["media"] = media.localize(http, post_id, link["media"], f"l{i}-")
    if (link.get("quote") or {}).get("media"):
        link["quote"] = {**link["quote"], "media": media.localize(http, post_id, link["quote"]["media"], f"l{i}q-")}
    for holder in (link, link.get("quote") or {}):
        a = holder.get("author") or {}
        if a.get("avatar") and a.get("handle"):
            holder["author"] = {**a, "avatar": media.avatar(http, a["avatar"], a["handle"].lower())}
    if link.get("kind") == "youtube" and not link.get("image"):
        link["image"] = f"https://i.ytimg.com/vi/{link['video_id']}/hqdefault.jpg"
    if isinstance(link.get("image"), str):
        link["image"] = media.save_image(http, link["image"], folder / f"l{i}-og")
    if isinstance((link.get("article") or {}).get("image"), str):
        link["article"] = {**link["article"], "image": media.save_image(http, link["article"]["image"], folder / f"l{i}-cover")}
    return link


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
        **existing,
        "id": tp.id,
        "url": f"https://t.me/{config.CHANNEL}/{tp.id}",
        "date": tp.date,
        "edited": tp.edited,
        "views": tp.views,
        "text": tp.text,
        "forwarded_from": tp.forwarded_from,
        "digest": bool(DIGEST_RE.search(tp.text)),
        "hash": src_hash,
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

    # Links and media — only re-fetched when the post itself changed.
    if changed or "links" not in existing:
        raw_links = enrich.enrich_links(http, tp.links)
        post["links"] = [localize_link(http, tp.id, i, l) for i, l in enumerate(raw_links)]
        own = [{"type": m.type, "url": m.url, "thumb": m.thumb} for m in tp.media]
        post["media"] = media.localize(http, tp.id, own, "m")
        post["preview"] = None
        if tp.preview:
            prev = dict(tp.preview)
            prev["image"] = media.save_image(http, prev.get("image"), config.MEDIA_DIR / str(tp.id) / "preview")
            post["preview"] = prev

    if not tp.text and not post.get("links") and not post.get("media"):
        return  # service message or media Telegram won't show on the web

    post["article"] = build_article(post)
    if post != existing:
        post["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        save(post)


def refresh_articles() -> None:
    """Re-derive article fields for every stored post (run after changing shape.py)."""
    for path in sorted(config.POSTS_DIR.glob("*.json")):
        post = json.loads(path.read_text("utf-8"))
        post["article"] = build_article(post)
        save(post)


def main() -> None:
    config.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    with telegram.client() as http:
        info, posts = telegram.fetch_posts(http, config.PAGES)
        print(f"fetched {len(posts)} posts from @{config.CHANNEL}")
        if not posts:
            raise SystemExit("no posts found — is the channel public and t.me reachable?")
        if info.get("title"):
            info["avatar"] = media.avatar(http, info.get("avatar"), f"channel-{config.CHANNEL}")
            info["username"] = config.CHANNEL
            (config.DATA_DIR / "channel.json").write_text(json.dumps(info, ensure_ascii=False, indent=1) + "\n", "utf-8")
        for tp in reversed(posts):
            print(f"- post {tp.id}")
            try:
                process(http, tp)
            except Exception as exc:  # one broken post must not stop the run
                print(f"  ! failed {tp.id}: {exc!r}")
    media.prune()


if __name__ == "__main__":
    import sys

    refresh_articles() if "--refresh" in sys.argv else main()
