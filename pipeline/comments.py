"""Automatic comment checks (PLAN.md P2-12): the comments added since the last run, read by the same small model,
which flags insults, spam and off-topic ones for the owner's page (/admin/ «بررسی خودکار نظرها»). It never hides a
comment: the owner decides, as with readers' reports.

Reads Upstash Redis over its REST API with the site's own keys, given to the workflow as secrets
(KV_REST_API_URL, KV_REST_API_TOKEN; KV_PREFIX if the site uses one). Without them it does nothing.
Costs per run: one read of the newest comments and of the last-checked marker, plus one write per flag.

    python -m pipeline.comments
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import httpx

from . import ai

URL = (os.getenv("KV_REST_API_URL") or os.getenv("UPSTASH_REDIS_REST_URL") or "").rstrip("/")
TOKEN = os.getenv("KV_REST_API_TOKEN") or os.getenv("UPSTASH_REDIS_REST_TOKEN") or ""
PREFIX = os.getenv("KV_PREFIX", "")
FLAGS = {"insult": "توهین", "spam": "تبلیغ یا هرزنامه", "offtopic": "بی‌ربط"}

SCHEMA = {
    "type": "object",
    "properties": {"verdict": {"type": "string", "enum": ["ok", "insult", "spam", "offtopic"]}},
    "required": ["verdict"],
    "additionalProperties": False,
}
SYSTEM = """تو ناظر نظرهای یک سایت فارسی خبرهای هوش مصنوعی هستی. یک نظر خواننده را می‌گیری و فقط یکی را می‌گویی، به صورت JSON:
- ok: نظر عادی، حتی اگر انتقادی، مخالف، کوتاه یا شوخی باشد.
- insult: فحش، توهین به آدم‌ها یا گروه‌ها، تهدید.
- spam: تبلیغ، لینک فروش، کانال یا پیج دیگر، پیام تکراری بی‌معنی.
- offtopic: کاملاً بی‌ربط به خبر و به هوش مصنوعی و فناوری (مثلاً سیاست داخلی یا دعوای شخصی).
در شک، ok."""


def redis(*cmds):
    resp = httpx.post(f"{URL}/pipeline", headers={"Authorization": f"Bearer {TOKEN}"},
                      json=[[c, PREFIX + k, *args] for c, k, *args in cmds], timeout=20)
    resp.raise_for_status()
    return [r.get("result") for r in resp.json()]


def run() -> int:
    if not URL or not TOKEN:
        print("comments: no Upstash keys; skipped")
        return 0
    recent, seen = redis(["LRANGE", "c:recent", "0", "49"], ["GET", "flags:seen"])
    rows = []
    for raw in recent or []:
        try:
            rows.append(json.loads(raw))
        except ValueError:
            continue
    seen = seen or ""
    new = [c for c in rows if c.get("at", "") > seen]
    if not new:
        print("comments: nothing new")
        return 0
    flagged = []
    with httpx.Client() as http:
        for c in sorted(new, key=lambda c: c["at"]):
            text = f"خبر شماره‌ی {c.get('post')}\n" + (f"بخش نقل‌شده: {c['quote']}\n" if c.get("quote") else "") + f"نظر: {c.get('text', '')[:1000]}"
            try:
                verdict = ai.chat(http, SYSTEM, [], text, SCHEMA, name="verdict", max_tokens=20)["verdict"]
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                print(f"comments: {exc}")
                break  # the rest are checked next run (the marker stays before them)
            seen = max(seen, c["at"])
            if verdict in FLAGS:
                flagged.append(["HSET", "flags", f"{c['post']}:{c['id']}", json.dumps({"why": FLAGS[verdict], "at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False)])
    redis(*flagged, ["SET", "flags:seen", seen])
    print(f"comments: {len(new)} checked, {len(flagged)} flagged")
    return len(flagged)


if __name__ == "__main__":
    run()
