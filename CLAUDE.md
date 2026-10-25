# khabar — Persian news site from the @dlmehr Telegram channel

Primary site: https://khabar-ai.vercel.app (canonical). GitHub Pages builds a mirror. Channel owner: Mehrzad Samadi (https://mehrzad.ai/).

## How it fits together
- `pipeline/` (Python, httpx + bs4): crawls `t.me/s/dlmehr`, takes **Gholam's first comment** (the Persian translation, posted by a bot named «غلام», signed «داش غلام») from the post's discussion widget, reads linked tweets (api.fxtwitter.com) / pages, writes `data/posts/<id>.json`. Media is **never downloaded** — posts keep original URLs (Telegram CDN URLs are signed, refreshed on every crawl).
- `src/` (Astro 7, static): `lib/posts.ts` shapes raw posts (`kind`: story | digest | brief; English digests are hidden). Components in `src/components/`, pages in `src/pages/`, one stylesheet `src/styles/global.css` (tokens at the top, light/dark).
- `src/scripts/`: `core.ts` (storage, helpers) · `media.ts` (loading placeholder, retry, fallback for broken images/videos) · `game.ts` (points, badges, streaks, "new since last visit") · `social.ts` (API client) · `peek.ts` (long-press story preview, fed by `p/<id>/card.json`) · `speech.ts` (read aloud: device Persian voice, else `/api/tts`) · `reader.ts` (listen, speed, text size/spacing, reading mode, time left, resume position, quote sharing) · `player.ts` (`/today/`: stories as an auto-playing vertical video; four sets — `?s=new` since last visit, `?s=unseen`, today (default), `?s=all` — picked by `pickStories` in `game.ts` from the 3 days the page carries; sound = the video's own audio, else narration; preloads the next scenes and drops far-away videos; watching marks a story `seen`) · `app.ts` (boot, settings, offline, load-more, header/tab bar that hide on scroll down).
- `api/` (Vercel Functions, plain ESM JS, no deps): comments, react, engage, live (presence/visits), chat, leaders, tts (Azure Speech, Persian MP3 per paragraph of a story's card.json; 501 without `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION`). Storage = Upstash Redis REST (`KV_REST_API_URL`/`KV_REST_API_TOKEN`); `_lib.js` has an in-memory store for tests. Files starting with `_` are not routes.
- `.github/workflows/site.yml`: crawl every 20 min → commit `data/` → build → deploy Pages (build/deploy skipped when the crawl found nothing new). Vercel redeploys on each push to main.

## Commands
- `npm run build` (astro + pagefind) · `npm run serve` (built site + API with in-memory store, port 4322)
- `npm test` (API, node:test) · `.venv/bin/python -m pytest -q pipeline/tests`
- Screenshots / UI checks: `playwright` is a devDependency (`npx playwright install chromium webkit` for its browsers; or launch with `executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`). Run against `npm run serve`.
- `npx astro check` (types) · `.venv/bin/python -m pipeline.run` (crawl; `PAGES=10` to backfill, `--refresh` to re-derive articles)
- Crawl into a scratch dir instead of `data/`: `DATA_DIR=/abs/path .venv/bin/python -m pipeline.run`

## Gotchas
- Telegram comment HTML has a hidden reply template with a *truncated* copy of the text — always read `.js-message_text` (see `telegram._own_text`).
- X video CDN returns 403 with a foreign Referer → site-wide `<meta name="referrer" content="no-referrer">`; outbound links to t.me/mehrzad.ai use `referrerpolicy="origin"`.
- `post.cover` is always a still image (video → poster); use `sized()` for pbs.twimg.com sizes.
- iOS has no Persian TTS voice, and only starts audio inside a tap: `Speaker.start()`/`resume()` must not await before playing.
- Safari sizes a height-less column flexbox from `flex-basis`: `flex: 1` (basis 0%) collapses it — use `flex: 1 1 auto` (see `.peek-scroll`).
- `data-today` / `data-total` / `data-online` are filled by `social.ts` with live counts site-wide: don't reuse those attribute names for anything else.
- Upstash free tier is ~500K commands/month: keep API calls batched (`engage` = one pipeline per page) and CDN-cacheable.

## Working efficiently here
- Don't read `data/posts/*.json` wholesale (60+ files); grep or read one. Don't read `package-lock.json`, `dist/`, `node_modules/`.
- When checking a build, tail the log (`npm run build 2>&1 | tail`), don't dump it.
