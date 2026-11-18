# Onboarding: khabar (فیوچر فوکوس)

A Persian AI-news site built from the Telegram channel @dlmehr. It is static (Astro), with one Vercel function for the
API, a Python crawler, and a small LLM that runs inside GitHub Actions. Everything stays on free plans (see PLAN.md).

## First hour
1. `npm ci` and `python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt pytest`.
2. `npm run build` (about a minute), then `npm run serve` → http://localhost:4322. The API runs with an in-memory store.
3. `npm test` and `.venv/bin/python -m pytest -q pipeline/tests`. `npx astro check` must report 0 errors.
4. Read `CLAUDE.md` (the map and the gotchas) and `PLAN.md` (what's open).

## How data flows
`t.me/s/dlmehr` → `pipeline/run.py` → `data/posts/<id>.json` → AI on the runner (`ai.py`, `ai_more.py`, `related.py`,
`daily.py`, `videos.py --summarize`, `comments.py`) → commit → Vercel redeploys + GitHub Pages mirror → `notify` (push +
IndexNow). Shared files the AI grows (`data/glossary.json`, `entities.json`, `lexicon.json`) are **editable by hand**: a fix
there applies to every page on the next build.

## Rules that keep it working
- Never add files to `api/` (Vercel Hobby: 12 functions). Add `server/<name>.js` and register it in `api/router.js`.
- Per-page markup is multiplied by ~2,000 posts: put extras in `card.json` and add them at runtime (see `extras.ts`).
- iOS: audio must start inside the tap. Nothing on the path from a tap to `play()` may await.
- `/api/tts` never speaks text from the request: only from the site's own JSON files.
- The model never fails a run. Every answer is validated, stamped with a version and an input hash, and has a fallback.
- Upstash ~500K commands/month: counters ride on existing calls (`ev` with the presence beat, `engage` batched).

## Secrets and settings (all free)
Vercel: `KV_REST_API_URL/TOKEN`, `AZURE_SPEECH_KEY/REGION` (F0 tier), `GITHUB_DISPATCH_TOKEN`, `VAPID_*`, `PUSH_SECRET`,
`ADMIN_TOKEN`, `WATCH_SECRET`, optional `PUBLIC_GOOGLE_SITE_VERIFICATION`, `PUBLIC_BING_SITE_VERIFICATION`.
GitHub: `PUSH_SECRET`, `VERCEL_TOKEN`, `KV_REST_API_URL/TOKEN` (comment checks); vars `VERCEL_TEAM_ID`, `API_URL`.

## Search engines (one-time)
1. Google Search Console → add property `https://khabar-ai.vercel.app/` (URL prefix) → verify with the HTML file already at
   `/google9dca6b8d6eae63d6.html` (deploy first).
2. Sitemaps → submit `sitemap-index.xml` and `news-sitemap.xml`.
3. URL inspection → request indexing for `/`, `/videos/`, `/glossary/`.
4. Bing Webmaster Tools → import from Google Search Console (IndexNow is already wired; new stories are pushed to Bing/Yandex).
5. Check weekly: Pages report (not indexed reasons), Core Web Vitals, Enhancements (Breadcrumbs, Videos).
