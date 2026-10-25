"""Read a public Telegram channel through its web preview (t.me/s/<channel>) — no account or API keys needed.

Gholam's comments live in the channel's linked discussion group; the public discussion widget
(t.me/<channel>/<id>?embed=1&discussion=1) exposes them without logging in.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
from bs4 import BeautifulSoup, Tag

from . import config

BG_URL_RE = re.compile(r"background-image:\s*url\(['\"]?(.*?)['\"]?\)")
PAD_RE = re.compile(r"padding-top:\s*([\d.]+)%")
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")


@dataclass
class TgMedia:
    type: str  # "image" | "video"
    url: str
    thumb: Optional[str] = None
    duration: Optional[str] = None
    ratio: Optional[float] = None  # height / width, so the page reserves space before the image loads


@dataclass
class TgPost:
    id: int
    date: str
    text: str
    links: list[str]
    media: list[TgMedia] = field(default_factory=list)
    preview: Optional[dict] = None
    forwarded_from: Optional[str] = None


class RetryTransport(httpx.HTTPTransport):
    """t.me and api.fxtwitter.com answer a long backfill with 429s now and then. A failed read is not harmless: a post is
    checked for Gholam only once and its links are read only once, so wait and ask again instead."""

    def __init__(self, tries: int = 4, wait: float = 2.0) -> None:
        super().__init__(retries=2)
        self.tries, self.wait = tries, wait

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        for attempt in range(1, self.tries + 1):
            resp = super().handle_request(request)
            if (resp.status_code != 429 and resp.status_code < 500) or attempt == self.tries:
                return resp
            resp.close()
            after = resp.headers.get("Retry-After", "")
            time.sleep(min(float(after), 60) if after.isdigit() else self.wait * 2 ** (attempt - 1))
        raise AssertionError("unreachable")


def client() -> httpx.Client:
    return httpx.Client(
        timeout=30,
        follow_redirects=True,
        transport=RetryTransport(),
        headers={"User-Agent": config.USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
    )


def _bg(tag: Optional[Tag]) -> Optional[str]:
    if not tag:
        return None
    m = BG_URL_RE.search(tag.get("style", ""))
    return m.group(1) if m else None


def _ratio(tag: Optional[Tag]) -> Optional[float]:
    """Telegram sizes media boxes with padding-top: N% on the element or a child."""
    for t in [tag, *(tag.select("[style*=padding-top]") if tag else [])]:
        m = PAD_RE.search((t.get("style") or "") if t else "")
        if m:
            return round(float(m.group(1)) / 100, 4)
    return None


def _text_with_links(node: Tag) -> tuple[str, list[str]]:
    """Plain text of a message, keeping hidden hyperlink targets (Telegram text_link entities)."""
    links: list[str] = []
    for br in node.find_all("br"):
        br.replace_with("\n")
    for a in node.find_all("a", href=True):
        href = a["href"]
        if href.startswith("http"):
            links.append(href)
            label = a.get_text()
            if label.strip() and label.strip() not in href:
                a.replace_with(f"{label} ({href})")
    text = node.get_text().strip()
    for url in URL_RE.findall(text):
        links.append(url.rstrip(".,;:!?"))
    seen, uniq = set(), []
    for link in links:
        if link not in seen:
            seen.add(link)
            uniq.append(link)
    return text, uniq


def parse_channel_page(html: str) -> tuple[dict, list[TgPost]]:
    soup = BeautifulSoup(html, "html.parser")
    avatar = soup.select_one(".tgme_page_photo_image img")
    info = {
        "title": _get_text(soup.select_one(".tgme_channel_info_header_title")),
        "description": _get_text(soup.select_one(".tgme_channel_info_description")),
        "avatar": avatar.get("src") if avatar else None,
        "subscribers": _get_text(soup.select_one(".tgme_channel_info_counter .counter_value")),
    }
    posts: list[TgPost] = []
    for msg in soup.select(".tgme_widget_message[data-post]"):
        try:
            posts.append(_parse_message(msg))
        except Exception as exc:  # one odd post must not break the run
            print(f"  ! could not parse {msg.get('data-post')}: {exc}")
    return info, posts


def _own_text(msg: Tag) -> Optional[Tag]:
    """The message's own text, not the shortened quote Telegram embeds when it replies to another message."""
    return msg.select_one(".js-message_text") or next(
        (t for t in msg.select("[class*='message_text']") if "reply" not in " ".join(t.get("class", []))), None
    )


def _get_text(tag: Optional[Tag]) -> str:
    return tag.get_text(" ", strip=True) if tag else ""


def _parse_message(msg: Tag) -> TgPost:
    post_id = int(msg["data-post"].split("/")[-1])
    time_tag = msg.select_one(".tgme_widget_message_date time")

    text_node = _own_text(msg)
    text, links = _text_with_links(text_node) if text_node else ("", [])

    media: list[TgMedia] = []
    for photo in msg.select(".tgme_widget_message_photo_wrap"):
        url = _bg(photo)
        if url:
            media.append(TgMedia("image", url, ratio=_ratio(photo)))
    for player in msg.select(".tgme_widget_message_video_player, .tgme_widget_message_roundvideo_player"):
        video = player.select_one("video")
        thumb = _bg(player.select_one(".tgme_widget_message_video_thumb, .tgme_widget_message_roundvideo_thumb"))
        duration = _get_text(player.select_one(".message_video_duration, .tgme_widget_message_roundvideo_duration"))
        ratio = _ratio(player)
        if video and video.get("src"):
            media.append(TgMedia("video", video["src"], thumb, duration or None, ratio))
        elif thumb:  # "media is too big" — Telegram only exposes the thumbnail
            media.append(TgMedia("image", thumb, ratio=ratio))

    preview = None
    lp = msg.select_one(".tgme_widget_message_link_preview")
    if lp:
        preview = {
            "url": lp.get("href"),
            "site": _get_text(lp.select_one(".link_preview_site_name")),
            "title": _get_text(lp.select_one(".link_preview_title")),
            "description": lp.select_one(".link_preview_description").get_text("\n", strip=True)
            if lp.select_one(".link_preview_description")
            else "",
            "image": _bg(lp.select_one(".link_preview_image, .link_preview_right_image")),
        }
        if preview["url"] and preview["url"] not in links:
            links.insert(0, preview["url"])

    fwd = msg.select_one(".tgme_widget_message_forwarded_from_name")
    return TgPost(
        id=post_id,
        date=time_tag["datetime"] if time_tag else "",
        text=text,
        links=[l for l in links if not re.match(r"https?://t\.me/", l)],
        media=media,
        preview=preview,
        forwarded_from=_get_text(fwd) or None,
    )


def fetch_posts(http: httpx.Client, pages: int) -> tuple[dict, list[TgPost]]:
    info: dict = {}
    posts: dict[int, TgPost] = {}
    before: Optional[int] = None
    for _ in range(pages):
        url = f"https://t.me/s/{config.CHANNEL}" + (f"?before={before}" if before else "")
        resp = http.get(url)
        resp.raise_for_status()
        page_info, page_posts = parse_channel_page(resp.text)
        info = info or page_info
        if not page_posts:
            break
        for p in page_posts:
            posts[p.id] = p
        before = min(p.id for p in page_posts)
        if before <= 1:
            break
    return info, sorted(posts.values(), key=lambda p: p.id)


def fetch_gholam_comment(http: httpx.Client, post_id: int) -> Optional[dict]:
    """Return Gholam's reply to a post, or None if he hasn't commented (yet). Raises httpx.HTTPError when the discussion
    could not be read, so a failed look is not mistaken for "no comment"."""
    resp = http.get(f"https://t.me/{config.CHANNEL}/{post_id}?embed=1&discussion=1&comments_limit=30")
    resp.raise_for_status()
    return parse_gholam_comment(resp.text)


# When the translation bot fails it still replies, with its error ("Could not summarize that message: 503 UNAVAILABLE…").
GHOLAM_ERROR_RE = re.compile(r"^\s*Could not (?:summarize|translate)\b|^\s*(?:Error|Exception)\b[:\s]", re.I)


def is_gholam_error(text: str) -> bool:
    return bool(GHOLAM_ERROR_RE.search(text or ""))


def parse_gholam_comment(html: str) -> Optional[dict]:
    soup = BeautifulSoup(html, "html.parser")
    # Widget markup differs slightly between channel posts and comments, so match loosely on class names.
    for msg in soup.select("[class*='widget_message'][data-post], .tgme_widget_message, .tme_widget_message"):
        author = _get_text(msg.select_one("[class*='author_name'], [class*='owner_name']"))
        text_node = _own_text(msg)
        if not text_node:
            continue
        for br in text_node.find_all("br"):
            br.replace_with("\n")
        text = text_node.get_text().strip()
        if is_gholam_error(text):
            continue  # not a translation: look for a later reply, or count as none
        if config.GHOLAM_SIGNATURE in text or (author and config.GHOLAM_NAME in author):
            time_tag = msg.select_one("time[datetime]")
            return {"text": clean_gholam(text), "date": time_tag["datetime"] if time_tag else None}
    return None


def clean_gholam(text: str) -> str:
    """Drop the signature line; the site renders its own byline."""
    lines = [l for l in text.strip().splitlines()]
    while lines and (not lines[-1].strip() or config.GHOLAM_SIGNATURE in lines[-1]):
        lines.pop()
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
