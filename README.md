# فیوچر فوکوس — Future Focus

A Persian news site built automatically from the Telegram channel [@dlmehr](https://t.me/dlmehr) by [Mehrzad Samadi](https://mehrzad.ai/).
Live at **https://blog.remixt.app** (Cloudflare Pages; English edition at /en/). The old Vercel deployment is disabled.

Every channel post becomes a news story. The Persian text is Gholam's first comment under the post (the translation);
images and videos are shown straight from the source, and every story links to its original tweet or article.

**Features**
- **News:** a timeline grouped by Tehran day, a lead story, a full or short view, the daily «۲۴ ساعت» summary and a
  weekly recap. One filter bar on the home page combines the story's *type* (tool/product, research, tutorial, opinion,
  Mehrzad's videos — written by the AI) with its *topic* (company or field — keyword rules) and «موضوع‌های من».
- **AI on the runner (free):** Qwen3.5-9B writes a Persian headline, a short line and a type for every story, plus
  importance, the people/companies it names (/who/), terms explained (/glossary/), «به زبان ساده», a quiz, a video
  script and a share caption; embeddings give related stories and same-news clusters. Every answer is checked and
  falls back to the rules (`pipeline/ai.py`, `pipeline/ai_more.py`).
- **Sources in any language:** each story shows its tweet or article with the publisher's name (Bloomberg, Nikkei,
  36Kr…), the article a tweet cites, the source's language (Chinese, Japanese, Russian, French…), clean short links
  without tracking parameters, and a one-tap Persian translation (`src/lib/source.ts`). Avatars and logos are never
  used as a story's picture.
- **Listening:** «گوش دادن» on every story, a daily podcast of the day's stories, the week's top stories, Instagram-like
  stories (/today/) with narration. The reader picks what is read: the whole text, the headline, the headline and first
  paragraph, or the headline and the last part («چرا مهمه؟»). Voices: the device's Persian voice, Azure (optional),
  or one of 12 on-device Persian voices (downloaded once); English names are read in Persian letters; each word lights
  up as it is said.
- **Video:** a shareable news video (vertical/landscape/square, ≤60 s) made on the phone from any story, a 60-second
  summary of the day, and teasers for Mehrzad's YouTube episodes (/videos/).
- **Guests, no signup:** reactions, comments with replies, live chat, “online now” and visit counters; points, levels,
  badges, streaks and a weekly leaderboard on /me/; history and saved stories (with offline audio).
- **Notifications (Web Push):** all news, followed topics/people only, or the daily summary; the story's picture
  large under the text and small beside it (Android, Windows, desktop Chrome — iOS only shows the app's icon).
- **App-like:** installable, offline reading, light/dark themes, text size and spacing, focus mode, long-press preview.
- **SEO and feeds:** canonical URLs, Open Graph/Twitter cards, NewsArticle/ItemList/BreadcrumbList structured data,
  sitemap + Google News sitemap, IndexNow, `llms.txt`, RSS for everything, each topic, the news, daily summaries and
  videos (/feeds/), search (Pagefind).

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

**Cloudflare Pages (primary, https://blog.remixt.app):** `wrangler.toml`; the workflow builds and uploads the site
with `scripts/publish.sh` (`wrangler pages deploy`, no Cloudflare Git builds). GitHub → Settings → Secrets → Actions:
`CLOUDFLARE_API_TOKEN` (*Cloudflare Pages: Edit*), `CLOUDFLARE_ACCOUNT_ID` (or a variable); `CLOUDFLARE_PROJECT`
(variable, default `khabar`). The API (`server/`) runs as Pages Functions (`functions/`). In the Pages project →
Settings → Variables and Secrets:
1. Upstash Redis (free) `KV_REST_API_URL` and `KV_REST_API_TOKEN`: comments, reactions, chat and counters. Without them
   the site works and those features stay hidden.
2. Optional: `ADMIN_TOKEN` (lets you delete any comment), `HASH_SALT` (any random string), `ALLOWED_ORIGINS`
   (comma-separated, defaults to `*`), `KV_PREFIX` (e.g. `khabar:`, to share one Redis database with another app).
3. Persian voice for "listen" and the daily player's narration on iPhone/iPad (they ship no Persian voice): create a free
   *Azure AI Speech* resource (F0 tier, 500K characters a month) and set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`
   (e.g. `westeurope`); optionally `TTS_VOICE` (default `fa-IR-DilaraNeural`, or `fa-IR-FaridNeural`). Each paragraph is
   synthesized once and then served from Cloudflare's cache. Without it, devices that have a Persian voice (Android, most desktops) still listen.
4. "Update from the channel" button (↻ in the header): create a fine-grained GitHub token with *Actions: Read and write*
   on this repo only and set it as `GITHUB_DISPATCH_TOKEN`. A tap starts the crawl workflow, unless one is queued, running
   or finished in the last 3 minutes (`SYNC_COOLDOWN`); the page then shows "news arrived" once the new build is live.
   Without the token the button stays hidden. `GITHUB_REPO` (owner/name) overrides the repo (default `AliTaheriMotlagh/khabar`).

**GitHub:** the workflow `.github/workflows/site.yml` crawls the channel, commits new posts to `main`, publishes them to
Cloudflare, then the model's headlines and extras, and a mirror on GitHub Pages: *Settings → Pages → Source: GitHub
Actions*. A crawl with nothing new stops after the commit step. The mirror uses the primary site's API for comments and
chat (repository variable `API_URL` overrides the address).

GitHub's own schedule is best effort: runs come late or not at all, sometimes for hours. To put each post on the site
within a few minutes, **`/api/watch/`** is called every minute by a Cloudflare Worker with a cron trigger
(`workers/watch/`, free; deploy once with `npx wrangler@4 deploy -c workers/watch/wrangler.toml`). Open pages also tick
it while visible, and any external cron can call `https://blog.remixt.app/api/watch/?key=<WATCH_SECRET>`. Without the
key the answer is shared for 50 s per data centre, so the channel and GitHub are asked about once a minute however
many callers there are. It reads the channel's page and starts a crawl only when there is news: a post newer than the
newest crawl once Gholam has commented on it (he answers within ~30 s; after 3 minutes it goes without, as the daily
digests do — `WATCH_GRACE`), his comment on a post from the last hour (`WATCH_MINUTES`) that came after the newest
crawl, or a post that crawl held back for him once the hold is over. A failed crawl is retried after 20 minutes
(`WATCH_RETRY`). Needs `GITHUB_DISPATCH_TOKEN` (above) and `WATCH_SECRET` (any long random string) in Cloudflare;
501 without them. No Redis. Keep the `schedule:` block as a fallback: data runs never overlap, and one with nothing new
takes well under a minute.

**Moderation:** `/admin/` with `ADMIN_TOKEN` (reported and recent comments, visits by hour, traffic sources), or
`curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "https://blog.remixt.app/api/comments/?post=<post id>&id=<comment id>"`.

**Notifications:** `node scripts/vapid.mjs` prints `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and
`PUSH_SECRET` for Cloudflare; put the same `PUSH_SECRET` in GitHub → Settings → Secrets → Actions.

**Cloudflare limits (free, it never bills — past a limit it refuses):** 20,000 files per deployment (`publish.sh` warns
at 18,000), 100,000 Function requests a day (`public/_routes.json` keeps static pages off the Functions).
The old Vercel deployment (khabar-ai.vercel.app) is disabled; `api/router.js`, `vercel.json` and the `prune` workflow
are left from it.

Branding lives in `src/site.ts`; crawler settings (channel, pages per run, …) in `pipeline/config.py`.
