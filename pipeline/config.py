"""All tunables come from environment variables so GitHub Actions can override them."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CHANNEL = os.getenv("TG_CHANNEL", "dlmehr").lstrip("@")
DATA_DIR = ROOT / os.getenv("DATA_DIR", "data")
POSTS_DIR = DATA_DIR / "posts"
# Media lives outside git history (an orphan "media" branch) and is copied into public/media at build.
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", str(ROOT / "media-store")))

# How many t.me/s pages (≈20 posts each) to read per run. Cron uses 1; first run / backfill uses more.
PAGES = int(os.getenv("PAGES", "1"))
# Keep re-checking a post's discussion for Gholam's comment for this many hours.
GHOLAM_POLL_HOURS = float(os.getenv("GHOLAM_POLL_HOURS", "48"))
GHOLAM_NAME = os.getenv("GHOLAM_NAME", "غلام")
GHOLAM_SIGNATURE = os.getenv("GHOLAM_SIGNATURE", "داش غلام")

MAX_LINKS = int(os.getenv("MAX_LINKS", "2"))
MAX_ARTICLE_CHARS = int(os.getenv("MAX_ARTICLE_CHARS", "5000"))

MAX_VIDEO_MB = float(os.getenv("MAX_VIDEO_MB", "25"))
MAX_VIDEO_HEIGHT = int(os.getenv("MAX_VIDEO_HEIGHT", "720"))
MEDIA_BUDGET_MB = float(os.getenv("MEDIA_BUDGET_MB", "800"))
IMAGE_MAX_WIDTH = int(os.getenv("IMAGE_MAX_WIDTH", "1400"))

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
