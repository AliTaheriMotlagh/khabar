"""Re-host media on our own site: Telegram's and Twitter's CDNs are filtered in Iran, the site isn't."""
from __future__ import annotations

import io
import shutil
from pathlib import Path
from typing import Optional

import httpx
from PIL import Image

from . import config


def _rel(path: Path) -> str:
    return "media/" + path.relative_to(config.MEDIA_DIR).as_posix()


def save_image(http: httpx.Client, url: Optional[str], dest: Path, max_width: int = config.IMAGE_MAX_WIDTH) -> Optional[dict]:
    """Download an image and store it as WebP. Returns {src, width, height} or None."""
    if not url:
        return None
    dest = dest.with_suffix(".webp")
    if dest.exists():
        with Image.open(dest) as im:
            return {"src": _rel(dest), "width": im.width, "height": im.height}
    try:
        resp = http.get(url)
        resp.raise_for_status()
        with Image.open(io.BytesIO(resp.content)) as im:
            im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
            if im.width > max_width:
                im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "WEBP", quality=80, method=6)
            return {"src": _rel(dest), "width": im.width, "height": im.height}
    except Exception as exc:
        print(f"  ! image failed {url[:80]}: {exc}")
        return None


def save_video(http: httpx.Client, url: Optional[str], dest: Path) -> Optional[str]:
    """Stream a video to disk unless it's bigger than MAX_VIDEO_MB. Returns the relative path or None."""
    if not url:
        return None
    dest = dest.with_suffix(".mp4")
    if dest.exists():
        return _rel(dest)
    limit = config.MAX_VIDEO_MB * 1024 * 1024
    tmp = dest.with_suffix(".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with http.stream("GET", url) as resp:
            resp.raise_for_status()
            if int(resp.headers.get("content-length") or 0) > limit:
                print(f"  - video too big, linking instead: {url[:80]}")
                return None
            size = 0
            with tmp.open("wb") as f:
                for chunk in resp.iter_bytes(1 << 16):
                    size += len(chunk)
                    if size > limit:
                        raise ValueError("video over size limit")
                    f.write(chunk)
        tmp.rename(dest)
        return _rel(dest)
    except Exception as exc:
        print(f"  ! video failed {url[:80]}: {exc}")
        tmp.unlink(missing_ok=True)
        return None


def localize(http: httpx.Client, post_id: int, items: list[dict], prefix: str) -> list[dict]:
    """Turn remote media descriptors into local ones; keeps the remote URL as a fallback."""
    folder = config.MEDIA_DIR / str(post_id)
    out = []
    for i, m in enumerate(items):
        name = f"{prefix}{i}"
        if m["type"] == "image":
            img = save_image(http, m.get("url"), folder / name)
            if img:
                out.append({"type": "image", **img, "remote": m.get("url")})
        else:
            poster = save_image(http, m.get("thumb"), folder / f"{name}-poster")
            src = save_video(http, m.get("url"), folder / name)
            out.append(
                {
                    "type": "video",
                    "src": src,
                    "poster": poster["src"] if poster else None,
                    "width": m.get("width") or (poster or {}).get("width"),
                    "height": m.get("height") or (poster or {}).get("height"),
                    "duration": m.get("duration"),
                    "gif": m.get("gif", False),
                    "remote": m.get("url"),
                }
            )
    return out


def avatar(http: httpx.Client, url: Optional[str], key: str) -> Optional[str]:
    img = save_image(http, url, config.MEDIA_DIR / "avatars" / key, max_width=96)
    return img["src"] if img else None


def prune(budget_mb: float = config.MEDIA_BUDGET_MB) -> None:
    """Keep the media store under budget: drop videos of the oldest posts first, then their images."""
    root = config.MEDIA_DIR
    if not root.exists():
        return
    files = [p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts]
    total = sum(p.stat().st_size for p in files)
    budget = budget_mb * 1024 * 1024
    if total <= budget:
        return

    def post_key(p: Path) -> int:
        try:
            return int(p.relative_to(root).parts[0])
        except ValueError:
            return 1 << 62  # avatars etc. are kept

    for pattern in ("*.mp4", "*.webp"):
        for p in sorted((f for f in files if f.match(pattern)), key=post_key):
            if total <= budget or post_key(p) == 1 << 62:
                break
            total -= p.stat().st_size
            p.unlink()
    for d in root.iterdir():
        if d.is_dir() and d.name != ".git" and not any(d.iterdir()):
            shutil.rmtree(d)
    print(f"media pruned to {total / 1048576:.0f} MB")
