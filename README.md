# khabar

A Persian news site built from the public Telegram channel [@dlmehr](https://t.me/dlmehr).
For each channel post, the article text is Gholam's (غلام) first comment in the post's discussion thread;
the post itself, its links, tweets and media are shown as the source.

- `pipeline/` — Python crawler: `t.me/s/<channel>` → Gholam's comment → link content → re-hosted media → `data/posts/<id>.json`
- `src/` — Astro static site (feed, post pages, tags, search, RSS, offline support)

## Run locally

```sh
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python -m pipeline.run          # PAGES=10 to backfill older posts
npm ci && npm run dev
```

Without crawled data the site falls back to `data/sample/`.

## Deploy

The GitHub Actions workflow (`.github/workflows/site.yml`) crawls every 30 minutes, commits `data/` to `main`
and media to the orphan `media` branch, then builds and deploys GitHub Pages.

**GitHub Pages:** Settings → Pages → Source: **GitHub Actions**.

**Vercel:** import the repo (framework: Astro; `vercel.json` sets the rest). Every crawl commit to `main` redeploys it,
and the build fetches the `media` branch itself. For a private repo, add a `GITHUB_TOKEN` environment variable
in Vercel with read access to the repo's contents.

Channel and branding settings: `pipeline/config.py` (env vars) and `src/site.ts`.
