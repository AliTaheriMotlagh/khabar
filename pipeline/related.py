"""Related stories by meaning, and the same news told twice (PLAN.md P2-4).

Each story's headline and opening are turned into a vector by a small embedding model (Qwen3-Embedding-0.6B, run by
llama.cpp's llama-server with --embedding: scripts/ai-server.sh EMBED=1, port 8081). Stories whose vectors point the
same way are about the same thing:
- `related`: each story's closest stories (data/related.json), which «بیشتر بخوانید» shows instead of shared topics;
- `clusters`: stories within CLUSTER_HOURS of each other that are almost the same (three posts about one OpenAI
  launch): the timeline shows the first as the story and the others under it as «به‌روزرسانی‌ها».

The vectors are kept in the Actions cache (VECTORS, not in git): cheap to rebuild if it's evicted. Only the first
DIMS numbers of each (the model is trained so a prefix still works: "Matryoshka"), as int8, so 2,000 stories ≈ 0.5 MB.

    python -m pipeline.related            # vectors for new stories, then data/related.json
    python -m pipeline.related --tune     # print the closest pairs, to choose CLUSTER_SIM by eye
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx

from . import ai, config, shape

EMBED_URL = os.getenv("EMBED_URL", "http://127.0.0.1:8081").rstrip("/")
EMBED_MODEL = os.getenv("EMBED_MODEL", "qwen3-embedding-0.6b-q8_0")
VECTORS = Path(os.getenv("VECTORS", str(Path.home() / ".cache" / "khabar-vectors" / "vectors.json")))
RELATED = config.DATA_DIR / "related.json"
DIMS = 256
TOP = 6
RELATED_SIM = float(os.getenv("RELATED_SIM", "0.55"))  # below this, "related" is a stretch: shared topics do better
CLUSTER_SIM = float(os.getenv("CLUSTER_SIM", "0.86"))  # tuned on real pairs (--tune); a wrong merge is worse than none
CLUSTER_HOURS = 48
# Threads (P3-1): one story told over days or weeks (Jensen Huang's fall, Anthropic's IPO, Qwen4). Tuned on 1,825
# stories (2026-11-19): a story joins the thread of its closest earlier one within THREAD_DAYS when they are this
# similar, share a word rare across all stories (a name: «مگاسپید», "Inkling"), and it's close to the thread's last
# three too (no drift from Gemini into Google's earnings). Looser settings chained unrelated news into grab-bags.
THREAD_SIM = float(os.getenv("THREAD_SIM", "0.75"))
THREAD_DAYS = 14
THREAD_RARE = 0.01  # a shared word in at most this share of stories (at least 3)
THREAD_MIN = 3
EMBED_BUDGET = float(os.getenv("EMBED_BUDGET", "180"))
V = 1


def embed_text(post: dict) -> Optional[str]:
    """What a story is about: its headline and the first ~600 characters. None for digests and posts with no Persian."""
    if post.get("digest"):
        return None
    a = post.get("article") or {}
    story = (post.get("ai") or {}).get("story") or {}
    body = a.get("body") or story.get("body") or []
    title = (post.get("ai") or {}).get("title") or a.get("title") or ""
    if not body:
        return None
    return shape.clip(re.sub(r"\s+", " ", ai.URL_RE.sub("", f"{title}. {' '.join(body)}")), 700)


def pack(vec: list[float]) -> str:
    v = vec[:DIMS]
    norm = sum(x * x for x in v) ** 0.5 or 1.0
    return base64.b64encode(bytes((max(-127, min(127, round(x / norm * 127))) & 0xFF) for x in v)).decode()


def unpack(s: str) -> list[float]:
    raw = base64.b64decode(s)
    v = [(b - 256 if b > 127 else b) / 127 for b in raw]
    norm = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / norm for x in v]


def load_vectors() -> dict:
    try:
        data = json.loads(VECTORS.read_text("utf-8"))
        return data if data.get("model") == EMBED_MODEL and data.get("dims") == DIMS else {"model": EMBED_MODEL, "dims": DIMS, "items": {}}
    except (OSError, ValueError):
        return {"model": EMBED_MODEL, "dims": DIMS, "items": {}}


def embed(http: httpx.Client, texts: list[str]) -> list[list[float]]:
    resp = http.post(f"{EMBED_URL}/v1/embeddings", json={"model": EMBED_MODEL, "input": texts}, timeout=120)
    resp.raise_for_status()
    return [d["embedding"] for d in sorted(resp.json()["data"], key=lambda d: d["index"])]


def update_vectors(posts: list[dict], budget: float = EMBED_BUDGET) -> int:
    """Vectors for stories that have none (or whose text changed), newest first, in small batches."""
    store = load_vectors()
    items = store["items"]
    todo = []
    for p in sorted(posts, key=lambda p: p["id"], reverse=True):
        text = embed_text(p)
        if text and (items.get(str(p["id"])) or {}).get("src") != ai.input_hash(text):
            todo.append((p["id"], text))
    start, done = time.monotonic(), 0
    with httpx.Client() as http:
        for i in range(0, len(todo), 16):
            if time.monotonic() - start > budget:
                print(f"related: budget used; {len(todo) - done} stories left for the next run")
                break
            batch = todo[i : i + 16]
            for (pid, text), vec in zip(batch, embed(http, [t for _, t in batch])):
                items[str(pid)] = {"src": ai.input_hash(text), "v": pack(vec)}
            done += len(batch)
    VECTORS.parent.mkdir(parents=True, exist_ok=True)
    VECTORS.write_text(json.dumps(store), "utf-8")
    print(f"related: {done} new vectors, {len(items)} in all")
    return done


def similarities(posts: list[dict]):
    """(ids, dates, matrix of cosine similarities) for the stories with vectors. numpy when present, else plain Python."""
    items = load_vectors()["items"]
    by_id = {p["id"]: p for p in posts}
    ids = sorted((int(k) for k in items if int(k) in by_id and embed_text(by_id[int(k)])), reverse=True)
    vecs = [unpack(items[str(i)]["v"]) for i in ids]
    dates = [datetime.fromisoformat(by_id[i]["date"]).timestamp() for i in ids]
    try:
        import numpy as np

        m = np.array(vecs, dtype="float32")
        return ids, dates, (m @ m.T) if len(vecs) else np.zeros((0, 0))
    except ImportError:
        return ids, dates, [[sum(a * b for a, b in zip(u, v)) for v in vecs] for u in vecs]


def build(posts: list[dict]) -> dict:
    ids, dates, sim = similarities(posts)
    n = len(ids)
    # Same news: close in time and almost the same text, joined transitively (union-find).
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    window = CLUSTER_HOURS * 3600
    for i in range(n):
        for j in range(i + 1, n):
            if dates[i] - dates[j] > window:
                break  # ids are newest first, so the rest are older still
            if abs(dates[i] - dates[j]) <= window and sim[i][j] >= CLUSTER_SIM:
                parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(ids[i])
    clusters = sorted((sorted(g) for g in groups.values() if len(g) > 1), key=lambda g: -g[0])
    in_cluster = {pid: set(g) for g in clusters for pid in g}

    related = {}
    for i in range(n):
        row = sim[i]
        order = row.argsort()[::-1] if hasattr(row, "argsort") else sorted(range(n), key=lambda j: -row[j])
        same = in_cluster.get(ids[i], ())
        best = []
        for j in order:
            if float(row[j]) < RELATED_SIM or len(best) == TOP:
                break
            if j != i and ids[j] not in same:
                best.append(ids[j])
        if best:
            related[str(ids[i])] = best
    return {"v": V, "model": EMBED_MODEL, "related": related, "clusters": clusters, "threads": threads(ids, dates, sim, posts)}


WORD = re.compile(r"[A-Za-z؀-ۿ][A-Za-z0-9.\-؀-ۿ‌]{3,}")


def words(post: dict) -> set[str]:
    """The words a story's headline, source title and opening use (names among them)."""
    a = post.get("article") or {}
    text = " ".join([(post.get("ai") or {}).get("title") or "", a.get("title") or "", a.get("source_title") or "", " ".join(a.get("body") or [])[:600]])
    return {w.lower().strip(".-") for w in WORD.findall(ai.URL_RE.sub("", text))}


def threads(ids: list[int], dates: list[float], sim, posts: list[dict]) -> list[list[int]]:
    """Stories that follow one another on one subject, each thread oldest first, newest thread first."""
    n = len(ids)
    if not n:
        return []
    by_id = {p["id"]: p for p in posts}
    ws = [words(by_id[i]) for i in ids]
    # How rare a word is, across every story (not only those with a vector yet).
    df: dict[str, int] = {}
    corpus = [p for p in posts if embed_text(p)]
    for p in corpus:
        for w in words(p):
            df[w] = df.get(w, 0) + 1
    rare_max = max(3, len(corpus) * THREAD_RARE)
    window = THREAD_DAYS * 86400
    root = list(range(n))  # index → its thread's first story (ids are newest first, so we walk from the end)
    members: dict[int, list[int]] = {}
    for i in reversed(range(n)):
        best = None
        for j in range(i + 1, n):
            if dates[j] < dates[i] - window:
                break
            if float(sim[i][j]) >= THREAD_SIM and any(df[w] <= rare_max for w in ws[i] & ws[j]):
                if best is None or sim[i][j] > sim[i][best]:
                    best = j
        if best is not None:
            r = root[best]
            last = members[r][-3:]
            if sum(float(sim[i][k]) for k in last) / len(last) >= THREAD_SIM - 0.05:
                root[i] = r
                members[r].append(i)
                continue
        members[i] = [i]
    out = [sorted(ids[k] for k in m) for m in members.values() if len(m) >= THREAD_MIN]
    return sorted(out, key=lambda t: -t[-1])


def write(data: dict) -> bool:
    """Write data/related.json if it changed (a commit is a deploy)."""
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    old = RELATED.read_text("utf-8") if RELATED.exists() else ""
    if old == text:
        return False
    RELATED.write_text(text, "utf-8")
    return True


def coverage(posts: list[dict]) -> float:
    """The share of stories that have a vector (current or not)."""
    items = load_vectors()["items"]
    wanted = [p for p in posts if embed_text(p)]
    return sum(str(p["id"]) in items for p in wanted) / max(1, len(wanted))


MIN_COVERAGE = 0.95


def update_file(posts: list[dict]) -> bool:
    """data/related.json from the vectors, once they cover nearly every story: a fresh Actions cache fills over a few runs,
    and a file from part of the stories would lose the related lists the rest already have."""
    have = coverage(posts)
    if have < MIN_COVERAGE:
        print(f"related: vectors for {have:.0%} of the stories; data/related.json waits until {MIN_COVERAGE:.0%}")
        return False
    return write(build(posts))


def tune(posts: list[dict], n: int = 40) -> None:
    ids, dates, sim = similarities(posts)
    by_id = {p["id"]: p for p in posts}
    pairs = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            if abs(dates[i] - dates[j]) <= CLUSTER_HOURS * 3600:
                pairs.append((float(sim[i][j]), ids[i], ids[j]))
    pairs.sort(reverse=True)
    title = lambda pid: ((by_id[pid].get("ai") or {}).get("title") or by_id[pid]["article"]["title"])[:80]
    for s, a, b in pairs[:n]:
        print(f"{s:.3f}  {a} {title(a)}\n       {b} {title(b)}")


if __name__ == "__main__":
    posts = ai.load_posts()
    if "--tune" in sys.argv:
        tune(posts, int(next((a.split("=")[1] for a in sys.argv if a.startswith("--n=")), "40")))
    else:
        try:
            update_vectors(posts)
        except httpx.HTTPError as exc:
            print(f"related: embedding server unavailable ({exc}); keeping the vectors there are")
        print("related: data/related.json " + ("updated" if update_file(posts) else "unchanged"))
