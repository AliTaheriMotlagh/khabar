"""Open the links in a post and pull out everything worth showing: tweet text, author, media, article text."""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from . import config

TWEET_RE = re.compile(
    r"https?://(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|fixupx|vxtwitter|fixvx)\.com/([^/\s]+)/status(?:es)?/(\d+)",
    re.I,
)
YOUTUBE_RE = re.compile(r"(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)([\w-]{11})")
SKIP_HOSTS = ("t.me", "telegram.me")


def domain(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def enrich_links(http: httpx.Client, links: list[str]) -> list[dict]:
    out: list[dict] = []
    for url in links:
        if len(out) >= config.MAX_LINKS:
            break
        if domain(url) in SKIP_HOSTS:
            continue
        try:
            m = TWEET_RE.search(url)
            item = fetch_tweet(http, m.group(1), m.group(2)) if m else fetch_page(http, url)
        except Exception as exc:
            print(f"  ! enrich failed for {url}: {exc}")
            item = {"kind": "link", "url": url, "domain": domain(url)}
        if item:
            out.append(item)
            # A short tweet that points at an article: read the article too, that's where the news is.
            if item["kind"] == "tweet" and item.get("links") and len(out) < config.MAX_LINKS + 1:
                ext = next((l for l in item["links"] if not TWEET_RE.search(l) and domain(l) not in SKIP_HOSTS), None)
                if ext:
                    try:
                        out.append(fetch_page(http, ext))
                    except Exception as exc:
                        print(f"  ! enrich failed for {ext}: {exc}")
    return out


def _tweet_media(media: Optional[dict]) -> list[dict]:
    items = []
    for m in (media or {}).get("all", []) or []:
        if m.get("type") == "photo":
            items.append({"type": "image", "url": m.get("url"), "width": m.get("width"), "height": m.get("height")})
        elif m.get("type") in ("video", "gif"):
            items.append(
                {
                    "type": "video",
                    "url": pick_video_variant(m),
                    "thumb": m.get("thumbnail_url"),
                    "width": m.get("width"),
                    "height": m.get("height"),
                    "duration": m.get("duration"),
                    "gif": m.get("type") == "gif",
                }
            )
    return items


def pick_video_variant(m: dict) -> Optional[str]:
    """Best mp4 that is at most MAX_VIDEO_HEIGHT tall — sharp enough, light enough for slow connections."""
    mp4s = [f for f in m.get("formats") or m.get("variants") or [] if f.get("container") == "mp4" or ".mp4" in f.get("url", "")]
    best, best_rate = None, -1
    for f in mp4s:
        size = re.search(r"/(\d+)x(\d+)/", f.get("url", ""))
        height = min(int(size.group(1)), int(size.group(2))) if size else 0
        rate = f.get("bitrate") or 0
        if height <= config.MAX_VIDEO_HEIGHT and rate > best_rate:
            best, best_rate = f["url"], rate
    return best or m.get("url")


def _tweet_links(t: dict) -> list[str]:
    facets = ((t.get("raw_text") or {}).get("facets")) or []
    return [f["replacement"] for f in facets if f.get("type") == "url" and f.get("replacement")]


def _tweet_dict(t: dict) -> dict:
    a = t.get("author") or {}
    return {
        "author": {"name": a.get("name"), "handle": a.get("screen_name"), "avatar": a.get("avatar_url")},
        "text": t.get("text") or "",
        "lang": t.get("lang"),
        "date": t.get("created_timestamp"),
        "stats": {k: t.get(k) for k in ("views", "likes", "retweets", "replies") if t.get(k) is not None},
        "media": _tweet_media(t.get("media")),
        "links": _tweet_links(t),
    }


def fetch_tweet(http: httpx.Client, user: str, status_id: str) -> dict:
    resp = http.get(f"https://api.fxtwitter.com/{user}/status/{status_id}")
    resp.raise_for_status()
    t = resp.json()["tweet"]
    item = {"kind": "tweet", "url": t.get("url") or f"https://x.com/{user}/status/{status_id}", "domain": "x.com"}
    item.update(_tweet_dict(t))
    if t.get("quote"):
        item["quote"] = _tweet_dict(t["quote"])
    art = t.get("article")
    if art:  # long-form X article
        blocks = ((art.get("content") or {}).get("blocks")) or []
        body = "\n\n".join(b.get("text", "") for b in blocks if b.get("text"))
        item["article"] = {
            "title": art.get("title"),
            "text": (body or art.get("preview_text") or "")[: config.MAX_ARTICLE_CHARS],
            "image": ((art.get("cover_media") or {}).get("media_info") or {}).get("original_img_url"),
        }
    return item


def _meta(soup: BeautifulSoup, *names: str) -> Optional[str]:
    for n in names:
        tag = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return None


def fetch_page(http: httpx.Client, url: str) -> dict:
    resp = http.get(url)
    resp.raise_for_status()
    final = str(resp.url)
    item = {"kind": "link", "url": final, "domain": domain(final)}
    yt = YOUTUBE_RE.search(final)
    if yt:
        item["kind"] = "youtube"
        item["video_id"] = yt.group(1)
    ctype = resp.headers.get("content-type", "")
    if "html" not in ctype:
        item["file_type"] = ctype.split(";")[0]
        return item

    soup = BeautifulSoup(resp.text, "html.parser")
    item.update(
        {
            "title": _meta(soup, "og:title", "twitter:title") or (soup.title.get_text(strip=True) if soup.title else None),
            "description": _meta(soup, "og:description", "twitter:description", "description"),
            "image": _meta(soup, "og:image", "twitter:image", "twitter:image:src"),
            "site": _meta(soup, "og:site_name") or item["domain"],
            "author": _meta(soup, "author", "article:author"),
            "published": _meta(soup, "article:published_time", "og:published_time", "date"),
        }
    )
    if item.get("image") and item["image"].startswith("/"):
        item["image"] = f"{urlparse(final).scheme}://{urlparse(final).netloc}{item['image']}"
    item["text"] = extract_article_text(resp.text, final, soup)
    return item


def extract_article_text(html: str, url: str, soup: BeautifulSoup) -> str:
    text = None
    try:
        import trafilatura

        text = trafilatura.extract(html, url=url, include_comments=False, include_tables=False, favor_precision=True)
    except Exception:
        pass
    if not text:
        for tag in soup(["script", "style", "noscript", "svg", "form", "nav", "footer", "aside", "header"]):
            tag.decompose()
        node = soup.find("article") or soup.find("main") or soup.body or soup
        text = node.get_text("\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text or "")
    return text[: config.MAX_ARTICLE_CHARS]
