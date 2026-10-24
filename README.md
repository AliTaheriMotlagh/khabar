# فیوچر فوکوس — Future Focus

A Persian news site built automatically from the Telegram channel [@dlmehr](https://t.me/dlmehr) by [Mehrzad Samadi](https://mehrzad.ai/).
Live at **https://khabar-ai.vercel.app**.

Every channel post becomes a news story. The Persian text is Gholam's first comment under the post (the translation);
images and videos are shown straight from the source, and every story links to its original tweet or article.

**Features**
- Visual timeline grouped by day, a lead section, a full or short (headline list) view; the daily “24-hour summary” links each line to its story.
- Guest features with no signup: reactions, comments, a live chat, “online now” and visit counters.
- Gamification: points, levels, badges, daily streaks, a weekly leaderboard; new stories since your last visit are marked until you read them.
- Reading history and saved stories, offline reading (service worker), installable as an app, light/dark themes, text size.
- SEO: canonical URLs, Open Graph/Twitter cards, NewsArticle structured data, sitemap + Google News sitemap, RSS, search (Pagefind).

## Run locally

```sh
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt pytest
.venv/bin/python -m pipeline.run       # crawl the channel into data/ (PAGES=10 to backfill)
npm ci
npm run dev                            # site only, http://localhost:4321
npm run build && npm run serve         # site + API (in-memory), http://localhost:4322
npm test && .venv/bin/python -m pytest -q pipeline/tests
```

## Deploy (all free tiers)

**Vercel (primary):** import the GitHub repo (framework: Astro; `vercel.json` sets the rest). Then in the project:
1. *Storage → Create / connect → Upstash Redis* (free). This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`; comments, reactions,
   chat and counters start working on the next deploy. Without it the site works and those features stay hidden.
2. Optional environment variables: `ADMIN_TOKEN` (lets you delete any comment), `HASH_SALT` (any random string),
   `ALLOWED_ORIGINS` (comma-separated, defaults to `*`), `KV_PREFIX` (e.g. `khabar:`, to share one Redis database with another app).

**GitHub:** the workflow `.github/workflows/site.yml` crawls the channel every 15 minutes, commits new posts to `main`
(which redeploys Vercel), and publishes a mirror on GitHub Pages: *Settings → Pages → Source: GitHub Actions*.
The mirror uses the Vercel API for comments and chat (repository variable `API_URL` overrides the address).

**Moderation:** delete a comment with
`curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "https://khabar-ai.vercel.app/api/comments?post=<post id>&id=<comment id>"`.

Branding lives in `src/site.ts`; crawler settings (channel, pages per run, …) in `pipeline/config.py`.
