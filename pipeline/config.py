"""All tunables come from environment variables so GitHub Actions can override them."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CHANNEL = os.getenv("TG_CHANNEL", "dlmehr").lstrip("@")
DATA_DIR = ROOT / os.getenv("DATA_DIR", "data")
POSTS_DIR = DATA_DIR / "posts"
# How many t.me/s pages (≈20 posts each) to read per run. Re-reading a few pages keeps media URLs fresh.
PAGES = int(os.getenv("PAGES", "3"))
# Telegram re-signs its CDN URLs on every page load. Saving a post only for that is deferred until its stored URLs
# are this old, otherwise every crawl commits (and redeploys the site) without any news.
URL_REFRESH_HOURS = float(os.getenv("URL_REFRESH_HOURS", "6"))
# Keep re-checking a post's discussion for Gholam's comment for this many hours.
GHOLAM_POLL_HOURS = float(os.getenv("GHOLAM_POLL_HOURS", "48"))
GHOLAM_NAME = os.getenv("GHOLAM_NAME", "غلام")
GHOLAM_SIGNATURE = os.getenv("GHOLAM_SIGNATURE", "داش غلام")

MAX_LINKS = int(os.getenv("MAX_LINKS", "2"))
# Pick the best X/Twitter video rendition up to this height: sharp enough, light enough for slow connections.
MAX_VIDEO_HEIGHT = int(os.getenv("MAX_VIDEO_HEIGHT", "720"))

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
