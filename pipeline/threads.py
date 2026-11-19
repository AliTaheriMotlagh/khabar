"""A headline and «ماجرا تا اینجا» for each thread of stories (PLAN.md P3-1).

pipeline/related.py finds the threads (one subject over days or weeks, from the stories' vectors) in data/related.json;
this asks the model once per thread for a name («ماجرای برکناری جنسن هوانگ») and two or three sentences of background,
from the stories' headlines only. A thread is asked again only when its stories change (`src`), so a run costs nothing
when no thread grew. Written to data/threads.json; the site shows a thread without them under a plain heading.

    python -m pipeline.threads            (the crawl: within THREADS_BUDGET seconds, newest threads first)
    python -m pipeline.threads --pending  (how many threads wait)
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Optional

import httpx

from . import ai, config

V = 1
THREADS = config.DATA_DIR / "threads.json"
RELATED = config.DATA_DIR / "related.json"
BUDGET = float(os.getenv("THREADS_BUDGET", "150"))
MAX_STORIES = 12  # the newest ones, when a thread is longer: the model reads headlines, not a book

SCHEMA = {
    "type": "object",
    "properties": {"title": {"type": "string"}, "summary": {"type": "string"}},
    "required": ["title", "summary"],
    "additionalProperties": False,
}
SYSTEM = """تو دبیر یک سایت فارسی خبرهای هوش مصنوعی هستی. چند خبر پشت سر هم درباره‌ی یک ماجرا می‌آید، هر کدام با تاریخ و تیترش. فقط JSON بده، به فارسی معیار (نه محاوره):
title: نام این ماجرا، یک عبارت کوتاه (۱۵ تا ۶۰ نویسه) که با «ماجرای» یا نام اصلی شروع شود، بدون فعل و بدون نقطه؛ مثل «ماجرای برکناری جنسن هوانگ» یا «عرضه‌ی سهام آنتروپیک».
summary: ماجرا تا اینجا، در ۲ یا ۳ جمله‌ی کوتاه به ترتیب زمان: از کجا شروع شد و الان به کجا رسیده (۸۰ تا ۳۲۰ نویسه).
فقط از همین تیترها بگو؛ چیزی اضافه نکن و حدس نزن. نام محصول و مدل را همان‌طور که در تیترها آمده بنویس."""


def load(path) -> dict:
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def headline(post: dict) -> str:
    """The model's headline, else the story's own (Gholam's first sentence), on one line."""
    title = (post.get("ai") or {}).get("title") if not (post.get("ai") or {}).get("failed") else None
    return re.sub(r"\s+", " ", title or (post.get("article") or {}).get("title") or "").strip()


def thread_input(ids: list[int], by_id: dict) -> Optional[str]:
    lines = [f"{by_id[i]['date'][:10]} — {headline(by_id[i])}" for i in ids[-MAX_STORIES:] if i in by_id and headline(by_id[i])]
    return "\n".join(lines) if len(lines) >= 2 else None


def problems(a: dict) -> list[str]:
    title, summary = (a.get("title") or "").strip(), (a.get("summary") or "").strip()
    out = []
    if not 10 <= len(title) <= 70:
        out.append(f"title length {len(title)}")
    if not 60 <= len(summary) <= 360:
        out.append(f"summary length {len(summary)}")
    if ai._fa_share(title + summary) < 0.6:
        out.append("not Persian enough")
    if ai.GREETING.search(title) or ai.GREETING.search(summary):
        out.append("colloquial words")
    return out


def pending(threads: list[list[int]], by_id: dict, done: dict) -> list[tuple[str, list[int], str]]:
    """(key, ids, input) of the threads whose answer is missing or out of date, newest thread first."""
    out = []
    for ids in threads:
        text = thread_input(ids, by_id)
        key = str(ids[0])
        if text and ((done.get(key) or {}).get("src") != ai.input_hash(text) or (done.get(key) or {}).get("v") != V):
            out.append((key, ids, text))
    return out


def work(http: httpx.Client, text: str) -> Optional[dict]:
    for temperature in (0.0, 0.3):
        try:
            a = ai.chat(http, SYSTEM, [], text, SCHEMA, name="thread", temperature=temperature, max_tokens=300)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            if isinstance(exc, httpx.TransportError):
                raise
            continue
        if not problems(a):
            return {"title": re.sub(r"\s+", " ", a["title"]).strip().rstrip("."), "summary": re.sub(r"\s+", " ", a["summary"]).strip()}
    return None


def run(budget: float = BUDGET) -> int:
    threads = (load(RELATED).get("threads") or [])
    by_id = {p["id"]: p for p in ai.load_posts()}
    store = load(THREADS) or {"v": V, "items": {}}
    items: dict = store.setdefault("items", {})
    todo = pending(threads, by_id, items)
    print(f"threads: {len(threads)} in all, {len(todo)} to name")
    start, done = time.monotonic(), 0
    with httpx.Client() as http:
        for key, ids, text in todo:
            if time.monotonic() - start > budget:
                print(f"threads: budget used; {len(todo) - done} left for the next run")
                break
            try:
                answer = work(http, text)
            except httpx.TransportError as exc:
                ai.server_gone("threads", exc, len(todo) - done)
                break
            # A thread the model can't name keeps its last good answer (or none: the site's plain heading) until it grows.
            items[key] = {**(answer or {k: v for k, v in (items.get(key) or {}).items() if k in ("title", "summary")}),
                          "src": ai.input_hash(text), "v": V, "model": ai.AI_MODEL}
            done += 1
            print(f"  ✓ thread {key} ({len(ids)} stories): {(answer or {}).get('title', 'no answer')}")
    # Threads that no longer exist (merged or re-cut) are dropped, so the file stays small.
    live = {str(t[0]) for t in threads}
    store["items"] = {k: v for k, v in sorted(items.items(), key=lambda kv: -int(kv[0])) if k in live}
    text = json.dumps(store, ensure_ascii=False, indent=1) + "\n"
    if not THREADS.exists() or THREADS.read_text("utf-8") != text:
        THREADS.write_text(text, "utf-8")
    return done


if __name__ == "__main__":
    if "--pending" in sys.argv:
        threads = load(RELATED).get("threads") or []
        print(len(pending(threads, {p["id"]: p for p in ai.load_posts()}, (load(THREADS).get("items") or {}))))
    else:
        run()
