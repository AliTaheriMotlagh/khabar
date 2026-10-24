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
- Reading tools on each story: listen aloud, text size and line spacing, a focus mode, time left, “continue where you left off”, sharing a selected quote. Long-press any story link to preview it.
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
3. Persian voice for "listen" and the daily player's narration on iPhone/iPad (they ship no Persian voice): create a free
   *Azure AI Speech* resource (F0 tier, 500K characters a month) and set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`
   (e.g. `westeurope`); optionally `TTS_VOICE` (default `fa-IR-DilaraNeural`, or `fa-IR-FaridNeural`). Each paragraph is
   synthesized once and then served from the CDN. Without it, devices that have a Persian voice (Android, most desktops) still listen.

**GitHub:** the workflow `.github/workflows/site.yml` crawls the channel every hour, commits new posts to `main`
(which redeploys Vercel), and publishes a mirror on GitHub Pages: *Settings → Pages → Source: GitHub Actions*.
The mirror uses the Vercel API for comments and chat (repository variable `API_URL` overrides the address).

GitHub's own schedule is best effort and can run late or skip an hour. For an exact cadence, trigger the workflow
from a free external cron (e.g. cron-job.org, hourly) with a fine-grained token that has *Actions: Read and write*
on this repo only, and delete the `schedule:` block in `site.yml` so the two don't both fire:
`curl -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -d '{"ref":"main"}' https://api.github.com/repos/<owner>/<repo>/actions/workflows/site.yml/dispatches`

**Moderation:** delete a comment with
`curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "https://khabar-ai.vercel.app/api/comments/?post=<post id>&id=<comment id>"`.

Branding lives in `src/site.ts`; crawler settings (channel, pages per run, …) in `pipeline/config.py`.
