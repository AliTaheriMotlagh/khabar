"""Mehrzad's YouTube channel as data/videos.json, for the site's /videos/ section (PLAN.md P1-A).

Three sources, merged by video id:
- the channel's Telegram posts that share a video of his (always there; brings Gholam's Persian when he wrote one);
- yt-dlp (`--flat-playlist` on /videos and /streams for the list, then the full metadata of new ids only: date,
  duration, description, chapters). GitHub's runners reach YouTube; the dev machine doesn't. Once a day (VIDEOS_EVERY_H);
- the channel's RSS feed (newest 15) when yt-dlp is missing or YouTube blocks it.

    python -m pipeline.videos            # update data/videos.json (yt-dlp/RSS when due, the posts always)
    python -m pipeline.videos --posts    # only from the posts, no network
    python -m pipeline.videos --summarize [--limit=N]   # Persian summaries from subtitles (needs the model, P2-3)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from . import config, enrich, shape

CHANNEL_URL = os.getenv("YT_CHANNEL", "https://www.youtube.com/@mehrzad.samadi")
VIDEOS = config.DATA_DIR / "videos.json"
EVERY_H = float(os.getenv("VIDEOS_EVERY_H", "20"))
DESC_MAX = 3000

# «51. Beni: Camera Robot [Persian]» → episode 51; «Live 1: News and Graph Engineering» → live 1.
EPISODE_RE = re.compile(r"^\s*(\d+)\s*[.\-–:]\s*(.+?)\s*(?:\[(?:Persian|فارسی)\])?\s*$", re.I)
LIVE_RE = re.compile(r"^\s*Live\s*(\d+)\s*[:\-–]\s*(.+?)\s*$", re.I)
CHAPTER_RE = re.compile(r"^\s*(?:\(?)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\)?)\s*[-–—:]?\s*(.+?)\s*$")
LINK_RE = re.compile(r"https?://[^\s)>\]]+")


def parse_title(title: str) -> dict:
    live = LIVE_RE.match(title or "")
    if live:
        return {"n": int(live.group(1)), "name": live.group(2), "live": True}
    ep = EPISODE_RE.match(title or "")
    if ep:
        return {"n": int(ep.group(1)), "name": ep.group(2), "live": False}
    return {"n": None, "name": (title or "").strip(), "live": False}


def _seconds(stamp: str) -> int:
    parts = [int(p) for p in stamp.split(":")]
    s = 0
    for p in parts:
        s = s * 60 + p
    return s


def chapters(description: str) -> list[dict]:
    """Chapters from the description's timestamps ("00:00 Intro"), when it starts at 0 and has at least 3."""
    out = []
    for line in (description or "").splitlines():
        m = CHAPTER_RE.match(line)
        if m:
            out.append({"t": _seconds(m.group(1)), "title": m.group(2)})
    return out if len(out) >= 3 and out[0]["t"] == 0 else []


def links(description: str) -> list[str]:
    seen = []
    for url in LINK_RE.findall(description or ""):
        url = url.rstrip(".,;")
        if url not in seen and not re.search(r"youtube\.com/@|youtube\.com/channel|t\.me/|instagram\.com|linkedin\.com", url):
            seen.append(url)
    return seen[:12]


# ---- sources ----

def from_posts() -> dict[str, dict]:
    """Videos the channel shared itself as a bare link: Mehrzad's episodes and lives."""
    found: dict[str, dict] = {}
    for path in config.POSTS_DIR.glob("*.json"):
        post = json.loads(path.read_text("utf-8"))
        if post.get("digest") or post.get("forwarded_from"):
            continue
        if len(re.findall(r"[^\W\d_]", re.sub(r"https?://\S+", "", post.get("text", "")))) > 40:
            continue
        urls = [post.get("text", "")] + [l.get("url", "") for l in post.get("links") or []] + [(post.get("preview") or {}).get("url") or ""]
        vid = next((m.group(1) for u in urls if (m := enrich.YOUTUBE_RE.search(u))), None)
        if not vid:
            continue
        titles = [l.get("title") for l in post.get("links") or [] if l.get("kind") == "youtube" or "youtu" in l.get("url", "")]
        titles.append((post.get("preview") or {}).get("title"))
        title = next((t for t in titles if t and not shape.WALL_TITLE.search(t)), None)
        meta = parse_title(title or "")
        # Only his series («NN. … [Persian]», «Live N: …»): not every video the channel links to is his.
        if not title or meta["n"] is None:
            continue
        prev = found.get(vid)
        if prev and prev["post"] < post["id"]:
            continue  # the first post about it is the announcement
        found[vid] = {"id": vid, "title": title, "date": post["date"][:10], "post": post["id"]}
    return found


def _yt_dlp(*args: str) -> Optional[dict]:
    exe = shutil.which("yt-dlp")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "--no-warnings", "--ignore-no-formats-error", "-J", *args], capture_output=True, text=True, timeout=240, check=True)
        return json.loads(out.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError) as exc:
        print(f"  ! yt-dlp {' '.join(args)}: {str(exc)[:300]}")
        return None


def from_yt_dlp(known: dict[str, dict]) -> tuple[dict[str, dict], Optional[str]]:
    """The channel's whole list, and full metadata for ids not known yet (or known without a description)."""
    found: dict[str, dict] = {}
    channel_id = None
    for tab, live in (("videos", False), ("streams", True)):
        data = _yt_dlp("--flat-playlist", f"{CHANNEL_URL}/{tab}")
        if not data:
            continue
        channel_id = channel_id or data.get("channel_id") or data.get("id")
        for e in data.get("entries") or []:
            if e.get("id") and e.get("title"):
                found[e["id"]] = {"id": e["id"], "title": e["title"], "duration": e.get("duration"), **({"live": True} if live else {})}
    for vid, v in found.items():
        if (known.get(vid) or {}).get("description") is not None:
            continue
        full = _yt_dlp("--skip-download", f"https://www.youtube.com/watch?v={vid}")
        if not full:
            continue
        up = full.get("upload_date") or ""
        v.update({
            "title": full.get("title") or v["title"],
            "date": f"{up[:4]}-{up[4:6]}-{up[6:8]}" if len(up) == 8 else None,
            "duration": full.get("duration") or v.get("duration"),
            "description": (full.get("description") or "")[:DESC_MAX],
            "chapters": [{"t": int(c["start_time"]), "title": c["title"]} for c in full.get("chapters") or []] or None,
        })
    return found, channel_id


def from_rss(http: httpx.Client, channel_id: str) -> dict[str, dict]:
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "media": "http://search.yahoo.com/mrss/"}
    resp = http.get(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}")
    resp.raise_for_status()
    found = {}
    for entry in ET.fromstring(resp.content).findall("a:entry", ns):
        vid = entry.findtext("yt:videoId", namespaces=ns)
        desc = entry.findtext("media:group/media:description", namespaces=ns)
        if vid:
            found[vid] = {"id": vid, "title": entry.findtext("a:title", namespaces=ns), "date": (entry.findtext("a:published", namespaces=ns) or "")[:10],
                          **({"description": desc[:DESC_MAX]} if desc is not None else {})}
    return found


# ---- the file ----

def load() -> dict:
    if VIDEOS.exists():
        return json.loads(VIDEOS.read_text("utf-8"))
    return {"channel": {"url": CHANNEL_URL, "id": None}, "checked": None, "videos": []}


def merge(old: dict, *sources: dict[str, dict]) -> list[dict]:
    """Every source's fields over the stored ones, a field only replaced by a real value."""
    by_id = {v["id"]: dict(v) for v in old.get("videos", [])}
    for src in sources:
        for vid, v in src.items():
            cur = by_id.setdefault(vid, {"id": vid})
            for k, val in v.items():
                if val not in (None, "", []):
                    cur[k] = val
    out = []
    for v in by_id.values():
        meta = parse_title(v.get("title", ""))
        v["n"], v["name"] = meta["n"], meta["name"]
        v["live"] = bool(v.get("live") or meta["live"])
        if v.get("description"):
            v["chapters"] = v.get("chapters") or chapters(v["description"]) or None
            v["links"] = links(v["description"]) or None
        out.append({k: val for k, val in v.items() if val is not None})
    # Newest first: by date, then by number.
    return sorted(out, key=lambda v: (v.get("date") or "", v.get("n") or 0), reverse=True)


def update(network: bool = True) -> bool:
    data = load()
    posts = from_posts()
    checked = data.get("checked")
    due = network and (not checked or datetime.fromisoformat(checked) < datetime.now(timezone.utc) - timedelta(hours=EVERY_H))
    # A post shares a video the file doesn't have yet: a new episode, look now.
    known = {v["id"] for v in data.get("videos", [])}
    due = due or (network and any(vid not in known for vid in posts))
    sources = [posts]
    if due:
        listed, channel_id = from_yt_dlp({v["id"]: v for v in data.get("videos", [])})
        if channel_id:
            data["channel"]["id"] = channel_id
        if listed:
            sources.insert(0, listed)
        elif data["channel"].get("id"):
            try:
                with httpx.Client(timeout=30, headers={"User-Agent": config.USER_AGENT}) as http:
                    sources.insert(0, from_rss(http, data["channel"]["id"]))
            except (httpx.HTTPError, ET.ParseError) as exc:
                print(f"  ! youtube rss: {exc}")
        data["checked"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    before = json.dumps(data.get("videos", []), ensure_ascii=False, sort_keys=True)
    data["videos"] = merge(data, *sources)
    changed = json.dumps(data["videos"], ensure_ascii=False, sort_keys=True) != before
    if changed or due or not VIDEOS.exists():
        VIDEOS.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"videos: {len(data['videos'])} ({'changed' if changed else 'no change'})")
    return changed


# ---- Persian summaries from the subtitles (PLAN.md P2-3) ----
# The video's auto subtitles (yt-dlp, Persian first) as text with a time every ~30 s, read by the model in chunks:
# each chunk gives notes; then one call writes the Persian headline, summary, 5–8 points, chapter titles in Persian (the
# description's own chapters translated when it has them, else from the times in the notes) and a shelf category.
# Without subtitles, the title and description alone. Stored as the video's `ai`; done again only when SUMMARY_V changes.
SUMMARY_V = 2  # 2: a longer write-up, more points, chapter descriptions, quotes, names, takeaways, a teaser script
CATEGORIES = ["مقاله‌خوانی", "تکنیک‌های مدل", "ایجنت و ابزار", "رباتیک", "گفتگو و مهمان", "لایو", "مهارت و مسیر شغلی", "خبر و تحلیل"]
CHUNK = 3500
VTT_TIME = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\.\d{3} --> ")


def vtt_text(vtt: str) -> str:
    """Plain text from a WebVTT file, the rolling auto-caption repeats removed, a [m:ss] stamp every ~30 s."""
    out, last, stamp_at, t = [], "", -30, 0
    for line in vtt.splitlines():
        m = VTT_TIME.match(line)
        if m:
            t = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
            continue
        line = re.sub(r"<[^>]+>", "", line).strip()
        if not line or line == "WEBVTT" or line.startswith(("Kind:", "Language:", "NOTE")) or line == last:
            continue
        if t - stamp_at >= 30:
            out.append(f"[{t // 60}:{t % 60:02d}]")
            stamp_at = t
        out.append(line)
        last = line
    return re.sub(r"\s+", " ", " ".join(out)).strip()


def subtitles(vid: str) -> Optional[str]:
    exe = shutil.which("yt-dlp")
    if not exe:
        return None
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        try:
            subprocess.run([exe, "--no-warnings", "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "fa,fa-orig,en,en-orig",
                            "--sub-format", "vtt", "-o", f"{tmp}/%(id)s.%(ext)s", f"https://www.youtube.com/watch?v={vid}"],
                           capture_output=True, text=True, timeout=180, check=True)
        except subprocess.SubprocessError as exc:
            print(f"  ! subtitles {vid}: {str(exc)[:200]}")
            return None
        files = sorted(Path(tmp).glob("*.vtt"), key=lambda f: (0 if ".fa" in f.name else 1, f.name))
        return vtt_text(files[0].read_text("utf-8", errors="replace")) if files else None


NOTES_SCHEMA = {"type": "object", "properties": {"notes": {"type": "array", "items": {"type": "string"}, "maxItems": 8}},
                "required": ["notes"], "additionalProperties": False}
_STR_LIST = lambda lo, hi: {"type": "array", "items": {"type": "string"}, "minItems": lo, "maxItems": hi}  # noqa: E731
SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "story": _STR_LIST(2, 5),
        "points": _STR_LIST(5, 12),
        "chapters": {"type": "array", "items": {"type": "object", "properties": {"t": {"type": "integer"}, "title": {"type": "string"}, "about": {"type": "string"}},
                                               "required": ["t", "title", "about"], "additionalProperties": False}, "maxItems": 24},
        "quotes": _STR_LIST(0, 4),
        "names": _STR_LIST(0, 12),
        "takeaways": _STR_LIST(2, 5),
        "teaser": {"type": "object", "properties": {"hook": {"type": "string"}, "points": _STR_LIST(3, 3), "why": {"type": "string"}},
                   "required": ["hook", "points", "why"], "additionalProperties": False},
        "category": {"type": "string", "enum": CATEGORIES},
    },
    "required": ["title", "summary", "story", "points", "chapters", "quotes", "names", "takeaways", "teaser", "category"],
    "additionalProperties": False,
}
NOTES_SYSTEM = """بخشی از زیرنویس یک ویدیوی فارسی یوتیوب درباره‌ی هوش مصنوعی را می‌گیری (زمان‌ها داخل [ ] آمده). نکته‌های اصلی همین بخش را با جزئیات (اسم‌ها، عددها، مثال‌ها) به فارسی معیار بنویس، هر نکته یک جمله، و زمان شروعش را اول آن بیاور، مثل «[12:30] …». فقط JSON."""
SUMMARY_SYSTEM = f"""تو خلاصه‌ی فارسی کامل یک ویدیوی یوتیوب مهرزاد صمدی درباره‌ی هوش مصنوعی را می‌نویسی، به فارسی معیار و روان. فقط JSON.
title: تیتر فارسی ویدیو (۳۰ تا ۸۰ نویسه)، موضوع اصلی را بگوید.
summary: ۲ تا ۳ جمله که ویدیو درباره‌ی چیست.
story: ۲ تا ۵ بند، هر بند ۳ تا ۵ جمله: روایت کامل ویدیو به ترتیب، با جزئیات، اسم‌ها، عددها و مثال‌هایی که گفته شده.
points: ۸ تا ۱۲ نکته‌ی اصلی، هر کدام یک جمله‌ی مشخص (نه کلی).
chapters: فصل‌های ویدیو با زمان شروع به ثانیه (t)، عنوان فارسی کوتاه (title) و یک جمله درباره‌ی آن فصل (about). اگر فصل‌های خود ویدیو داده شده، همان زمان‌ها را نگه دار و عنوانشان را به فارسی برگردان. اگر نه، از زمان‌های یادداشت‌ها ۴ تا ۸ فصل بساز که اولی از ۰ شروع شود.
quotes: تا ۴ جمله‌ی به‌یادماندنی که در ویدیو گفته شده (فقط اگر در یادداشت‌ها آمده)، به فارسی.
names: آدم‌ها، شرکت‌ها، مدل‌ها، مقاله‌ها و ابزارهایی که نامشان آمده، به همان شکل اصلی (انگلیسی اگر انگلیسی است).
takeaways: ۲ تا ۵ چیزی که بیننده می‌تواند با خودش ببرد یا امتحان کند.
teaser: برای یک ویدیوی کوتاه معرفی: hook (یک جمله‌ی گیرا که کنجکاو کند)، points (سه نکته‌ی خیلی کوتاه)، why (چرا ارزش دیدن دارد، یک جمله).
category: یکی از: {"، ".join(CATEGORIES)}.
فقط از چیزی که در یادداشت‌ها و توضیح آمده بنویس؛ چیزی از خودت اضافه نکن."""


def summarize_one(http, v: dict) -> Optional[dict]:
    from . import ai, ai_more

    text = subtitles(v["id"])
    notes: list[str] = []
    if text:
        for i in range(0, min(len(text), CHUNK * 14), CHUNK):
            try:
                notes += ai.chat(http, NOTES_SYSTEM, [], text[i : i + CHUNK], NOTES_SCHEMA, name="notes", max_tokens=600)["notes"]
            except Exception as exc:  # noqa: BLE001 — a chunk lost is a few notes lost
                print(f"  ! notes {v['id']}: {exc}")
    given = "\n".join(f"{c['t']}: {c['title']}" for c in v.get("chapters") or [])
    q = "\n".join([f"عنوان ویدیو: {v.get('title')}", f"مدت: {v.get('duration') or '؟'} ثانیه",
                    *([f"فصل‌های خود ویدیو (ثانیه: عنوان):\n{given}"] if given else []),
                    f"توضیح ویدیو: {shape.clip(v.get('description') or '', 1500)}",
                    *([f"یادداشت‌های زیرنویس:\n" + "\n".join(notes)] if notes else [])])
    for temperature in (0.1, 0.4):
        try:
            a = ai.chat(http, SUMMARY_SYSTEM, [], q, SUMMARY_SCHEMA, name="summary", temperature=temperature, max_tokens=3200)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! summary {v['id']}: {exc}")
            continue
        dur = v.get("duration") or 10**6
        chaps = sorted({c["t"]: (c["title"].strip(), (c.get("about") or "").strip()) for c in a.get("chapters") or [] if 0 <= c["t"] < dur and c["title"].strip()}.items())
        clean = lambda xs: [x.strip() for x in xs or [] if x and x.strip()]  # noqa: E731
        story = [p for p in clean(a.get("story")) if ai_more.fa_share(p) >= 0.6]
        if 20 <= len(a.get("title", "")) <= 100 and ai_more.fa_share(a.get("summary", "")) >= 0.6 and len(a.get("points") or []) >= 3:
            teaser = a.get("teaser") or {}
            return {"title": a["title"].strip(), "summary": a["summary"].strip(), "story": story, "points": clean(a["points"]),
                    "chapters": [{"t": t, "title": title, **({"about": about} if about else {})} for t, (title, about) in chaps] if len(chaps) >= 2 and chaps[0][0] == 0 else [],
                    # Quotes only when they came from the words said (the subtitles), never from a description.
                    "quotes": clean(a.get("quotes")) if notes else [], "names": clean(a.get("names"))[:12], "takeaways": clean(a.get("takeaways")),
                    "teaser": {"hook": (teaser.get("hook") or "").strip(), "points": clean(teaser.get("points"))[:3], "why": (teaser.get("why") or "").strip()} if teaser.get("hook") else None,
                    "category": a["category"], "from": "subtitles" if notes else "description", "v": SUMMARY_V, "model": ai.AI_MODEL}
    return None


def summarize(limit: int = 1) -> int:
    data = load()
    todo = [v for v in data["videos"] if (v.get("ai") or {}).get("v") != SUMMARY_V][:limit]
    done = 0
    with httpx.Client() as http:
        for v in todo:
            out = summarize_one(http, v)
            if out:
                v["ai"] = out
                done += 1
                print(f"  ✓ video {v['id']}: {out['title']} ({out['from']})")
    if done:
        VIDEOS.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return done


if __name__ == "__main__":
    if "--summarize" in sys.argv:
        summarize(int(next((a.split("=")[1] for a in sys.argv if a.startswith("--limit=")), "1")))
    else:
        update(network="--posts" not in sys.argv)
