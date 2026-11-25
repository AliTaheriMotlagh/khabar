# Plan: open tasks and notes

One place for everything unfinished. Last checked 2026-11-25 (data through post 6725).
Tick items off here; move anything that becomes a lasting rule into CLAUDE.md.

## Progress (2026-11-25): updates, English edition, explorer, ads, speed

### Why the site stopped updating (fixed in code; one step is yours)
- **The 1-minute cron called a dead address.** README told cron-job.org to call `khabar-ai.vercel.app/api/watch/`; that
  Vercel deployment now answers `402 DEPLOYMENT_DISABLED`. Posts 6716–6724 (16:03→19:50 UTC on 11-24) started no crawl;
  the next was GitHub's schedule at 20:22. **Yours:** in cron-job.org change the URL to
  `https://blog.remixt.app/api/watch/?key=<WATCH_SECRET>` (Cloudflare already has `WATCH_SECRET` and the token: it
  answers 401 without the key).
- **Backup without the cron:** open pages now tick `/api/watch/` (no key) every 3 min while visible; one answer a minute
  is shared through Cloudflare's cache, so the channel/GitHub are asked ≤1×/min per data centre.
- **Publishing waited for the model.** A crawl ran ~10–17 min of AI before its commit and deploy. Now: crawl → commit →
  build → Cloudflare deploy (minutes) → AI headlines (fa + en) → deploy → notify → AI extras → deploy → Pages mirror.
  `scripts/commit-data.sh`, `scripts/publish.sh`. The separate `cloudflare`, `notify` and Vercel `prune` jobs are gone.
- **Cloudflare didn't cache the API.** Vercel's CDN honoured `s-maxage`; Pages Functions don't. Every cloud-voice clip
  was re-synthesized by Azure on every listen and every picture re-fetched. `functions/_router.js` now keeps `s-maxage`
  answers in Cloudflare's cache (ranges served from it).

### Cloudflare stays $0
- Pages Free never bills: past a limit it refuses. Limits that matter: **20,000 files per deployment** (now 9,500 —
  `publish.sh` warns at 18,000), 100,000 Function requests/day (`public/_routes.json` limits Functions to `/api/*`,
  `/rss/top.xml`, `/ads.txt`; static pages never count). **Yours:** don't add a payment method / Workers Paid.
- File budget: each story = page + card.json + Pagefind fragment (fa) + English page ≈ 4 files → ~80 a day → ~130 days
  of room. [ ] Before ~18,000: bundle old card.json files or drop old Pagefind fragments.

### Done
- [x] Timeline filter bar: wraps on desktop (mouse) instead of a sideways strip that widened the page.
- [x] «تأییدنشده» on official news: `src/lib/source.ts sourceKind/settleStatus` — the maker's own account or site is
  «رسمی» (e.g. @Tesla 6680, @neuralink 6670), a newsroom's at least «گزارش» (@Reuters 6669, @business 6631), a lede
  naming «حساب رسمی» too; tests in `tests/source.test.mjs`.
- [x] Speed: off-screen timeline cards skip layout/paint (`content-visibility`), no blur on phones' sticky bars, navigation
  preload in `sw.js`, hover/touch prefetch for Safari/Firefox (Chrome already had speculation rules).
- [x] **English edition** `/en/` (home, pages, story pages, topics, videos, about, explorer, archive, RSS `en/rss.xml`):
  the real source text (tweet, linked article, quote), never Gholam's; hreflang pairs (page + sitemap), og:locale,
  NewsArticle `inLanguage: en` with `workTranslation`, English settings sheet, device English voice for «Listen»,
  header switch remembered (the Persian home opens the English one for a reader who chose it; crawlers always get fa).
  `src/lib/en.ts`. 1,895 of 2,086 stories have English source text; the rest are Persian-only posts.
- [x] English headlines by the model: `pipeline/ai_en.py` (`ai.en`, one short call, ≤80 tokens out) in every crawl and in
  `ai-backfill.yml`; the site falls back to the article's own title or the source's first sentence.
- [x] **Explorer** `/investigate/` + `/en/investigate/`: any company/person/model/topic/words → stories per week (and vs a
  second subject), how it was reported, rumour → official inside one running story, named together, publishers, the
  whole story oldest first. **Archive** `/archive/` + `/en/archive/`: a calendar (Jalali / Gregorian) shaded by news,
  any day's stories, «همین روز در ماه‌های قبل». One file, `/investigate.json` (~680 KB, ~150 KB compressed).
- [x] **Ads**: `server/ads.js` + `/admin/` «تبلیغات» (house banner / any network's snippet in a sandboxed frame / AdSense;
  slots home, story, sidebar, video; per language; `/ads.txt`); views/clicks counted with the presence beat.
  Vercel Hobby forbade ads; Cloudflare's free plan doesn't.
- [x] Banner: `Masthead.astro` on both homes (aurora, live line, today/week/sources/readers, ways in, newest headline);
  a new turning logo mark; a brand-coloured hairline under the header.
- [x] Mehrzad's videos: summaries v2 (`SUMMARY_V` 2 — whole-episode write-up, 8–12 points, chapter descriptions,
  quotes, names → explorer, takeaways, a teaser script used by the teaser video), chapter map bar on episode pages.
  The backfill redoes all 57. **Known gap:** all 57 were summarized from the description only — the runner never got
  subtitles (YouTube refuses it). [ ] Yours, if wanted: upload/allow captions another way (e.g. the channel's own
  YouTube Data API OAuth) — not worked around in code.
- [x] Voices: «-ation» → «یشن», a voiced plural s → «ز» (teams, kings…); the lexicon (model's spellings) still wins.
- [x] Fixed `tests/lines.test.mjs` (compared a page without the lexicon against card.json with it).

### Still open
- [ ] Persian homographs / ezafe for the on-device voices (needs a Persian G2P or diacritics in the lexicon; listen to
  20 stories per voice first and list the words that go wrong).
- [ ] After the backfill: check `/en/` headlines by eye (20 stories) and `/videos/` v2 summaries.
- [ ] Old README/onboarding still mention `khabar-ai.vercel.app` in places that only matter to the dead deployment.

## Progress (2026-11-18)

- **Fixed: 10 failed runs in a row** (2026-11-17 18:56 → 11-18 01:16): post 6595 linked X's login wall, whose generic
  picture (abs.twimg.com) reached the RSS feed and failed `tests/site.test.mjs`, so Pages and notifications stopped for
  ~9 h (Vercel kept serving). Fixed at the source (enrich skips X login walls; `feedPicture` never emits an unrelayable
  filtered-CDN address; `PLACEHOLDER`/`WALL_TITLE`), and `notify` no longer depends on the Pages tests.
- [x] P0-1 (6543 listed: YouTube-only posts get a Persian headline/line; oEmbed for YouTube links)
- [x] P0-2 (checkout `ref: main`; rebase aborted between tries; a conflict is a warning, a push failure still fails)
- [ ] P0-3 **yours**: regenerate the token. Code follow-up done: /admin/ shows the token's expiry (GitHub header), failing runs.
- [x] P0-4 (all actions on Node 24: checkout v7, setup-python v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5)
- [x] P1-B: Qwen3.5-9B on the runner in every crawl (headline, short, type); golden set 39 posts; `ai-eval.yml`,
  `ai-backfill.yml` (first 400-post run dispatched 2026-11-18 ~03:50 UTC; ~1,400 left after it → dispatch again).
  Bake-off: 9B 38/39 headlines pass, type 30/39, ~21–30 s/post; 4B ~27 s/post and flipped a meaning (6605), cancelled
  at 28/39. **AI topics not used** (precision 49% vs rules 72%). Type filter chips on the home timeline; short lines in
  multi-story pushes; /admin/ AI coverage (`/ai.json`).
  Open (optional, the site doesn't use `ai.topics`): improve topics (prompt without few-shot bias toward آنتروپیک, «only
  if named in the text»), re-eval, then maybe `ai.topics` where the rules found none — a prompt change bumps `PROMPT_V`
  and redoes every headline, so not while the backfill runs. `ai.short`: done where space is short (the /today/ end
  screen's recap tiles, notifications, /week/, /glossary/; the rail is one circle now, the peek has room for the
  headline). Open question 3 (headline everywhere): done as yes.
- [x] P1-A: `data/videos.json` (56 videos, ep. 1–51 + lives, via yt-dlp on the runner), `/videos/`, episode pages,
  home card 48 h, red rail circle 7 days, `rss/videos.xml`, push kind `video` in every mode, header/footer links.
  Open: category shelves (needs a video AI call: title + description → category, Persian summary for ep. 1–41);
  a new episode found by yt-dlp before Telegram is listed on /videos/ but not on the home card (newVideo uses dates only — fine).
- [~] P1-D: story page (gliding pill, muted rest via `::highlight`, tap a word), listen bar caption, setting.
  Open: /today/ player captions, brief items lit inline, labeled timing fixtures + median/p90 test, Playwright test in CI.
- [x] P1-C (done below, 2026-11-18 evening: vertical/short video, share caption, «۶۰ ثانیه خبر امروز», episode teasers, made/shared counters)
- [x] P2 (all twelve items: done below, 2026-11-18 evening)

## Progress (2026-11-18, evening): P1-C, P1-D, P2, SEO, admin — code done, not committed yet

- [x] **SEO**: sitemap with `lastmod` + story pictures; `CollectionPage`/`ItemList`/`BreadcrumbList` on lists, topics, videos,
  /who/; `speakable`, `wordCount`, `mentions` on stories; video `Clip` chapters; descriptions ≤158 chars (social cards keep
  300); `rel=prev/next`; `/llms.txt`; robots skips JSON files; **IndexNow** (Bing/Yandex…) from `scripts/notify.mjs`, key
  `public/a2e8b0f2….txt` = `SITE.indexNowKey`; Google's verification file `public/google9dca6b8d6eae63d6.html`; optional
  `PUBLIC_GOOGLE_SITE_VERIFICATION` / `PUBLIC_BING_SITE_VERIFICATION` env meta tags. `tests/seo.test.mjs`.
- [x] **Admin**: readers 30 days, top today/week, usage events (`ev:<day>`, sent with the presence beat: no extra requests),
  Azure TTS characters vs the free 500K with month-end pace, push by mode, comments/reactions, the build's content report
  (`/ai.json`: posts per day, hidden posts and why, AI coverage per field), automatic comment flags.
- [x] **P2-1** translation fallback (`ai_more.py` story, «ترجمه‌ی خودکار») · **P2-2** spoken names (`data/lexicon.json`,
  acronyms/numbers spelled in code, `server/_say.js` shared by the cloud voice and the browser, word highlight mapped back)
  · **P2-3** video summaries from subtitles + shelves · **P2-4** related + same-news clusters (`pipeline/related.py`,
  Qwen3-Embedding-0.6B, `data/related.json` seeded locally for 1,825 stories; CLUSTER_SIM 0.86 tuned by eye) · **P2-5**
  glossary (/glossary/, tap a term) · **P2-6** /who/ pages · **P2-7** podcast host lines · **P2-8** importance (hero,
  «مهم»، «مهم‌ترین اول» order) · **P2-9** «به زبان ساده» · **P2-10** quiz + «کنجکاو» badge · **P2-11** weekly recap
  (`weekly.yml`, push kind `weekly`) · **P2-12** comment checks (needs `KV_REST_API_URL`/`KV_REST_API_TOKEN` as GitHub secrets).
- [x] **P1-C** vertical/landscape/square, short ≤60 s from `ai.x.video`, no long intro, source credit, share caption + copy,
  made videos kept in Cache Storage `video-v1`, «۶۰ ثانیه خبر امروز», episode teasers, made/shared counters.
- [x] **P1-D** /today/ captions, brief words lit, median/p90 regression test (made-up clips).
- [x] ~~dispatch `ai-backfill`~~: the 2026-11-18 21:12 run died on a model timeout (before `chat`'s 2× retry and
  `server_gone`); re-dispatched 2026-11-19 00:08 UTC (run 44426528494, chains itself). 242/2,120 headlines, 17 extras done then.
- [x] ~~`ai_more` quality by eye~~ (2026-11-19, the 17 posts that had `ai.x`, 6612–6630): fluent Persian, sensible
  importance, quiz and share lines; one slip — 6625's «به زبان ساده» calls Alexandr Wang «طراح معروف» (invented role).
  Look again at ~20 older posts once the backfill has done a few hundred.
- [x] ~~build time~~: 18 s locally with the formatter cache (2026-11-19) — nothing more to do.
- [ ] Real hand-labeled timing clips (P1-D, needs a person). ~~Playwright tests~~, ~~follow on /who/~~ (done).

## Progress (2026-11-18, night)

- [x] **Video maker, the wait**: the sheet plays a silent preview of the video itself (text paced) while the voice is
  made, then shows the real frames as they're encoded; four steps, a ring, time left. «ادامه در پس‌زمینه» / ✕ / Escape /
  a tap beside it keep it going in a floating frame (`[data-vs-pill]`, its live frame in a progress ring); a toast and
  the frame say when it's ready. Only «لغو» stops it. One video at a time.
- [x] **Video maker, the look**: the picture on screen blurred behind everything (every shape), the panel's shadow,
  pictures far from the panel's shape shown whole over their blur (charts, slides) instead of cropped, black letterbox
  bars trimmed (YouTube thumbnails), the said word pops, text auto-sized (up to 1.7×) to fill its room, short headlines
  larger, a headline with no picture centered. Vertical = reel: story-like progress at the top, text inside Instagram's
  safe zone, names and source in the lower band. Bitrate 2.2/1.9/1.4 Mbps (v/s/h), capped at ~25 MB for long videos
  (a 45-s reel ≈ 12 MB, the 5-min full summary ≈ 25 MB).
- [x] **Teasers for every YouTube video**: episodes without a summary get one from what's known (number, length,
  chapters, title); a «تیزر» button on every card of /videos/ and the hero, «خلاصه» → `#summary` when there is one.
- [x] **Notification pictures**: `recent.json` `image` (the relay on the primary domain, never a filtered CDN) →
  `scripts/notify.mjs` → `/api/push` (https only) → `sw.js` `image` (Android/Windows); monochrome `badge-96.png`.
- [x] **Follow on /who/ pages**: follows hold `who:<slug>` beside topics; story cards and `recent.json` carry them, so
  the home's «موضوع‌های من» and topic-mode notifications follow people and companies too.
- [x] **Cilla Mini voices** (https://huggingface.co/mehdi-hf/cilla-mini, CC BY-NC 4.0, credited in the voice sheet):
  three speakers (پریسا, سیلا ۱, سیلا ۲) sharing one 112 MB model, from the model's public demo Space
  (`spaces/mehdi-hf/cilla-mini-demo`, pinned commit, same SHA-256 as the gated repo's file; hf-mirror.com as fallback),
  downloaded by the existing worker (parts, resume, checked). Runs on `phonon-tts` 0.7.1 (npm, MIT/Apache, pinned,
  bundled: its worker + WASM are served by the site) — `src/scripts/cilla.ts`, with the model's own Persian front end
  (`src/vendor/cilla/`). One CPU thread (cross-origin isolation would block other hosts' pictures). No HF token needed.
- [x] **English words in Persian letters** for the browser's voices (`server/_latin.js` via `sayLine(…, latin)`): the
  lexicon first, then ~250 known names, acronyms by letters, versions/domains/dollars, spelling rules; one word → one
  word (highlight intact); the cloud voice still reads English itself and its clip addresses don't change (`cloudOf`).
  Open: once the runner writes `data/lexicon.json`, compare its spellings with these rules on 50 names.

## Progress (2026-11-19): UI/UX pass

- [x] **Reactions**: the count vanished after a reload (engage is CDN-cached ~2 min) and quick taps could reach the
  server out of order. Now one request at a time per button, undone with a toast on failure, own counts kept 3 min.
- [x] **Covers**: ~250 stories used the tweet author's 200-px avatar (X/FxTwitter link previews) as their picture —
  stretched on the page, in social cards and in notifications; arXiv's logo on 16 more. Dropped (`posts.ts`).
- [x] **Notifications**: the story's picture is also the `icon` (seen while collapsed on Android/desktop). iOS Web Push
  shows neither picture — a platform limit.
- [x] **Sources**: publisher names, language label, translate link, cited article, clean short links (`src/lib/source.ts`).
- [x] **Listen setting**: whole text / headline / headline + first paragraph / headline + last part.
- [x] **Home filter bar**: type and topic chips in one labelled row; **/me/** in tabs, history paged, earned badges first.
- [x] **/who/ data**: 14 Persian spellings fixed by hand, GPU/disease/concept hidden; accent-safe slugs in the pipeline.
- [ ] Re-check entity spellings after the backfill adds more (the 9B model misspells rare names); consider a
  hand-kept override list if it keeps happening.

## Progress (2026-11-19, night): P3 — more from the model, all free

Decided: **no Sonnet.** GitHub Models (the free route people mean by "LLM on GitHub") was retired on 2026-07-30; the
Anthropic API is paid; Claude Code's GitHub Action would spend the owner's own subscription. Qwen on the runner stays.

- [x] **P3-1 Threads** («پیگیری ماجرا»): `related.py` finds them (47 threads / 203 stories on the archive, e.g. Jensen
  Huang's fall 9, Anthropic's IPO, Qwen4, Fable 5.2, Kimi K3.1); `pipeline/threads.py` names them; story page timeline,
  home «پرونده‌های داغ», the newest story's card links to its thread.
- [x] **P3-2 Model tracker** `/models/`: models and benchmark scores from the stories, each checked against the text;
  maker by family name; maker filter chips; facts card on the story page.
- [x] **P3-3 Status + number check**: رسمی / به گزارش رسانه‌ها / تأییدنشده on stories (rumours on cards too); Gholam's
  numbers the source doesn't have, listed on /admin/.
- [x] **P3-4 Topic intros**: weekly «این روزها» on topic pages (`weekly.yml`).
- [x] **P3-5 Calendar** `/calendar/` + subscribable `/calendar.ics` (listed on /feeds/).
- [x] **Uniform stories**: every story has a «چرا مهمه؟» — Gholam's, else the model's one line, labelled.
- Not done, on purpose: search by meaning in the browser (a 25–30 MB model download fails too often for readers in
  Iran — Pagefind stays); a personal brief (the home's «موضوع‌های من» already is one); Instagram carousels (later, on
  the video maker's renderer).
- [ ] After the push: `ai-backfill` redoes extras for v2 (status/models/events) with the headlines; check `/models/` and
  `/calendar/` by eye once ~200 posts have them; run `ai-eval` for the topics.

## Progress (2026-11-19, later): Gholam's text always, the model for everything around it

The rule: **the story is always Gholam's translation** (his greeting dropped); the model writes what the site needs around
it, and translates only when Gholam never commented (`ai.story`, «ترجمه‌ی خودکار», replaced as soon as he does).

| Part of the site | Comes from |
|---|---|
| Story text, «چرا مهمه؟» / «حرف آخر» | Gholam (`gholam.text` → `shape.split_gholam`); `ai.story` only without him |
| Headline, short line, type | model (`ai.title`/`short`/`type`); Gholam's first sentence until the backfill reaches the post |
| Topics / sections | model since `PROMPT_V` 2, grounded (`ai.grounded`); keyword rules when it names none |
| English names for the voices | model (`ai.speech` → `data/lexicon.json`), then `server/_latin.js` rules |
| Related / same news | embeddings (`pipeline/related.py`) |
| Mehrzad's video summaries, glossary, /who/, quiz, simple, importance, daily/weekly | model (`ai_more`, `videos.py --summarize`, `daily.py`) |

- [x] **Topics from the model** (2026-11-19): prompt v2 defines each topic and limits «کسب‌وکار» to money news; answers keep
  only topics the text names. Replayed on the last eval's answers: precision 49% → 83% (76% with the rules' fallback),
  recall 79%, section 29/39 (rules 25/39). The bump redoes every headline (the backfill does it).
- [x] **Hold for Gholam** (2026-11-19): a new post without his comment stays off the site 10 min
  (`GHOLAM_HOLD_MINUTES`), so a crawl that runs in his ~16 s never publishes (and pushes) the English source; `watch`
  starts one more crawl when the hold ends. Gholam's reply is split at 3,900 characters by his bot; his longest so far is
  1,455, so only the first comment is read.
- [x] ~~run `ai-eval` for v2~~ (2026-11-19 01:39 UTC, on the runner): topics precision 77% (rules 72%), section 29/39
  (rules 25/39) → the model's topics stay. Headline rules 36/39, type 29/39 (v1: 38/39, 30/39), 30 s/post.

## Progress (2026-11-19, morning): the backfill got stuck

- Run 44426528494 did 100 headlines (47 min), then ran `ai_more` for 100 posts (~2 min each: ~4 h) with Python's
  output buffered (an empty log), was killed at 340 min before its commit: nothing kept, no chain. Data then: 38/2,124
  posts with v2 headlines, 214 v1 (redone for v2), 19 with extras.
- [x] Fixed `ai-backfill.yml`: `PYTHONUNBUFFERED`, **headlines for every post first**, then extras; each step gets ≤50 min
  (`AI_BUDGET`/`AI_MORE_BUDGET` from the deadline) and a hard `timeout`, then commits («data: AI backfill, …»); Vercel's
  `ignoreCommand` skips those commits (the next crawl commit deploys them: ≤100 deploys a day on Hobby). Re-dispatched.
  Expected: headlines ≈ 16 h of runner time (~4 chained runs), extras ≈ 60–70 h more.

## Progress (2026-11-18, late): production hardening

- [x] **Why the 18:27 run failed**: the /videos/ order test read every link on the page; once the runner summarized 7
  episodes their category shelves came first. The test now checks the hero + the full grids, and each shelf newest
  first. Story 6621 (a bare tweet, Gholam's comment empty) had `wordCount: 0`: a story without text counts its headline.
- [x] **Workflow**: three tries for the crawl / pip / npm; data runs with failing site tests stay green, hold the
  mirror back and keep one `site-health` issue (closes itself); code pushes also run the browser smoke test (`e2e`).
- [x] **One-time sync of every post**: `ai-backfill.yml` stops starting chunks at 290 min and dispatches its next run
  until nothing is pending (1,606 headlines, 3,071 extras, 49 episode summaries left on 2026-11-18); a run with no
  progress stops the chain. **To do: dispatch it once after this is pushed** (Actions → ai-backfill → Run workflow).
- [x] Playwright video test + UI test in CI (`tests/e2e/smoke.mjs`, 23 checks).

## Status snapshot (2026-11-17)

- The live site matches `data/`: `build.json` says latest 6580, and every crawled post since 6525 is on the site, except the 4 below.
- Crawled but not shown:
  - 6540, 6553, 6579: English 24-hour digests, hidden on purpose.
  - **6543: Mehrzad's own video «51. Beni: Camera Robot [Persian]»** (https://youtu.be/7GNR3Ue7QFU), hidden because Gholam never commented on it. → P0-1
- Ids missing from `data/` since 6300: 6352, 6491, 6492, 6516, 6534. These are probably posts deleted on the channel or service messages. I couldn't confirm because t.me is filtered from the dev machine; check them in Telegram.
- Workflow: 1 failure in the last 40 runs (2026-11-16, run 43918500283 → see P0-2). The rest succeeded.
- **Scheduled crawls are not every 20 min.** GitHub actually fired them every 3–5 h over the last two days. Fresh posts depend almost entirely on `/api/watch` → `GITHUB_DISPATCH_TOKEN` (→ P0-3).
- The repo is **public**, so Actions minutes are unlimited on the standard runner (4 vCPU, 16 GB RAM, ~14 GB disk). Actions cache: 10 GB limit, 115 MB used. This is what makes P1-B (Qwen on the runner) free.

---

## Free plans only: guard rails (every item in this plan must stay at $0)

**Rule:** no billing account, no card-backed tier, and no "pay as you go" switch anywhere. If a feature only works by paying, it's dropped or gets a free fallback. Check the limits below again when setting a feature up (checked 2026-11-17).

| Service (plan) | Free limit | Use today | What this plan adds | Guard |
|---|---|---|---|---|
| **GitHub Actions** (public repo) | standard runners free, unlimited minutes | ~17 crawls/day with commits, ~1 min each | Qwen: ~30 min/day at most; backfill a few hours once | **Keep the repo public** (private = 2,000 min/month, Qwen would use them up). Only `ubuntu-latest`, **never "larger runners"** (paid). |
| **GitHub Actions cache** | 10 GB/repo; entries unused for 7 days are evicted | 115 MB | one Qwen model (4B ≈ 2.5 GB **or** 8B ≈ 5 GB) + embedding model ≈ 0.6 GB + llama.cpp | **Never raise the repo's cache size limit** (storage past 10 GB is billed). Cache only the chosen model; bake-off candidates are downloaded uncached in a manual run. |
| **GitHub repo / Pages** | Pages site ≤ 1 GB, ~100 GB/month bandwidth (soft) | `dist` 223 MB, repo 389 MB | small JSON files (`lexicon`, `glossary`, `entities`, `daily`, `weekly`, `videos.json`) | Video subtitles and embedding vectors are **not** committed (cache/temporary). Watch `dist` size as new page types arrive. |
| **Vercel Hobby** | 100 build h/month, 1M function invocations, 100 GB Fast Data Transfer, 12 functions, ~100 deploys/day, deployment storage 10 GB; **non-commercial use only** | ~17 deploys/day, 1 function (`api/router.js`), pruned to 4 deployments | new pages: `/videos/`, episode pages, `/who/`, `/glossary/` | AI fields are written **in the same commit as the crawl**, so no extra deploys. The backfill is a few large commits, not hundreds. No new files in `api/`. Thumbnails via `/api/img` at `w=320` on shelves. **No ads or sponsorships** while on Hobby. |
| **Upstash Redis** (free) | ~500K commands/month (CLAUDE.md), 256 MB | engage/live/comments/push | comment checks: 1 read per run (~500/month); video made/shared counters | Counters go **inside the existing `engage` pipeline**; nothing new per page view. |
| **Azure Speech** (F0) | 0.5M neural TTS characters/month | clips cached at the CDN for a year, so each paragraph is charged once when first heard | spoken versions (P2-2), podcast host lines (P2-7), weekly recap (P2-11), videos with the cloud voice (P1-C) | **Check that the Speech resource's pricing tier is F0** (F0 stops at the quota; S0 bills). Spoken versions apply to **new posts only**, since changed text = new clips. On quota errors, `/api/tts` should fall back to the on-device voice (check today's behavior). Look at Azure's "Synthesized characters" metric monthly. |
| **Hugging Face** downloads | free, anonymous | voice models | Qwen GGUF + embedding model | Pinned revision + SHA-256; downloaded at most once per cache eviction. |
| **YouTube via `yt-dlp`** | free, no key | – | channel list, metadata, subtitles | YouTube sometimes blocks cloud IPs. **Free fallbacks:** the channel's RSS feed (`/feeds/videos.xml?channel_id=…`, newest 15, every run), then a YouTube Data API key (free 10K units/day; a Google Cloud project without billing). |
| **LLM APIs** (alternatives only) | GitHub Models free tier; Gemini/Groq free keys | – | only if local Qwen's Persian isn't good enough | Free tiers only, **never add billing**. Local Qwen on the runner stays the default. |
| Web Push, wsrv.nl, fxtwitter, cron-job.org | free | used | new-video push type | No change. |

**Still to verify:**
- Azure tier = F0.
- Whether a new Vercel deploy empties the CDN cache of `/api/tts` clips. If it does, every deploy (~17/day) re-synthesizes clips people replay, and Azure use could be several times what's needed. Compare the Azure metric with listens in `/admin/`.

---

## P0: fix first (small, concrete)

### P0-1. Mehrzad's videos are dropped when Gholam doesn't comment
- Cause: `src/lib/posts.ts` makes a post without `gholam` a `brief`, and a brief is only listed if its text is ≥50% Persian. A bare YouTube link isn't, so it's hidden.
- Fix: a YouTube post is always listed. Without Gholam, use the preview's title + description + thumbnail (i.ytimg.com, already allowed by `/api/img`). Later, P1-B writes a Persian summary for it.
- Test: 6543 appears on the home page and at `/p/6543/`.

### P0-2. Workflow fails when a queued run starts late
- What happened: run created 17:27, queued **74 min**, started 18:41. `actions/checkout@v4` with no `ref` checks out the SHA from *trigger time*. The run then re-crawled posts that later runs had already committed, which caused an add/add conflict on `data/posts/6559–6564.json`.
- Second bug: the retry loop in `site.yml` (`git pull --rebase … && git push`) never runs `git rebase --abort`, so attempts 2 and 3 fail on "unmerged files" and can't recover.
- Fix: `actions/checkout@v4` with `ref: main` in the build job; `git rebase --abort 2>/dev/null || true` before each retry.
- No data was lost: the next run picked the posts up.

### P0-3. Regenerate the GitHub token (the email)
- GitHub emailed to say a token needs regenerating. On 2026-11-17 ~16:00 UTC `/api/sync` still read GitHub fine, so the token is **expiring soon, not dead yet**. Renew it before the date in the email.
- Most likely `GITHUB_DISPATCH_TOKEN` (Vercel env). It's used by `/api/watch` (crawl as soon as the channel posts) and `/api/sync` (reader-triggered crawl). If it dies, new posts wait for the 3–5 h schedule.
- Steps (only you can do these):
  1. GitHub → Settings → Developer settings → Personal access tokens → the token named in the email → **Regenerate** (or a new fine-grained one: this repo only, *Actions: Read and write*, *Metadata: Read*, expiry 1 year).
  2. Vercel → khabar → Settings → Environment Variables → `GITHUB_DISPATCH_TOKEN` (Production) → paste the new value → Redeploy.
  3. Check: `curl https://khabar-ai.vercel.app/api/sync/` returns `{"running":…,"last":…}`, not an error.
  4. Put a calendar reminder 2 weeks before the new expiry.
- If the email instead names `VERCEL_TOKEN`'s GitHub side or a "token exposed" alert: revoke first, then replace.
- Follow-up (code): `/admin/` shows "last crawl" time and turns red when watch/sync get 401 from GitHub, so expiry is seen before readers notice.

### P0-4. Housekeeping
- Actions warn that Node 20 is deprecated: bump `actions/checkout@v4` → v5 and `actions/setup-python@v5` → v6 (and check `setup-node`).

---

## P1-B. Titles and categories by a free LLM: Qwen on GitHub's runner (do this before P1-A/P1-C; both reuse it)

### Why
- Titles are Gholam's first sentence: on the last 48 stories they average **163 characters**, 36 of 48 are over 120, and they're chatty («یه خبر امنیتی مهم درومده؛ به گزارش…»).
- Categories are keyword rules (`shape.TOPICS`, 32 topics): they miss context, and 3 recent stories have no tag.

### Approach: Qwen runs inside the workflow, model kept in the GitHub Actions cache
- **Free, no API key, no quota:** the repo is public, so runner minutes cost nothing. The model file is downloaded once from Hugging Face and then restored from `actions/cache` on every run (~20–40 s).
- **Engine:** `llama.cpp`'s `llama-server`, a pinned release binary for ubuntu-x64. It speaks the OpenAI API on `127.0.0.1:8080` and supports **JSON-schema-constrained output**, so the answer is always valid JSON. Topics are an enum of the 32 TOPICS, so the model can't invent a topic.
- **Model: a bake-off on the golden set (below), pick the best that fits the time budget:**

  | Candidate | File (Q4_K_M) | Expected speed on 4 vCPU (verify) |
  |---|---|---|
  | Qwen3-4B-Instruct-2507 | ~2.5 GB | ~20–40 s per post |
  | Qwen3-8B (non-thinking) | ~5 GB | ~45–90 s per post |
  | the newest small Qwen instruct at setup time | | |

  Pin the HF repo revision + SHA-256, the same discipline as the voices in `src/lib/voices.ts`. Cache key = the model's hash.
- **One script, three backends:** `pipeline/ai.py` reads `AI_URL` / `AI_MODEL`:
  - the runner's llama-server (default);
  - Ollama on the Mac (bigger Qwen, fast on Apple silicon) for the big backfill;
  - GitHub Models / another API as a quality upgrade if small Qwen's Persian disappoints.

### What the model returns (one call per post)
```json
{
  "title":  "Persian news headline, 40–90 chars, no «رفیق/ببین/سلام», keeps the main company/person",
  "short":  "≤45 chars, for story circles, push notifications, the rail",
  "topics": ["≤3, from the 32 TOPICS enum, most relevant first = the section"],
  "type":   "خبر | ابزار و محصول | پژوهش و مقاله | آموزش | نظر و تحلیل | ویدیوی مهرزاد",
  "video":  {"hook": "one line", "points": ["3 short points"], "why": "one line"},
  "share":  "2-line caption + 2–3 hashtags, for sharing the video/story"
}
```
- **Input:** Gholam's text (first ~1,500 characters), the source's English title, link domains, and the keyword tags as a hint. For a YouTube post with no Gholam: the video title + description.
- **Prompt:** a Persian system prompt with the style rules, plus ~5 real posts with hand-written ideal answers (few-shot).
- **`type` is the new category axis**, next to topics. It enables filters like «فقط ابزارها» (tools only) or «فقط مقاله‌ها» (papers only), and picks out Mehrzad's videos.

### Guard rails (the site never gets worse than today)
- Validation: title 25–95 chars, ≥60% Persian letters, no greeting words, and contains a name from the source if the source has one; topics ⊂ TOPICS. A failure retries once (temperature 0.2), then falls back to the current rules.
- Stored in the post: `"ai": {…, "model": "<name+quant>", "v": <prompt version>, "src": <hash of the input>}`. The model re-runs only when the input or the prompt version changes, so each post costs one call, ever, and is kept in git.
- **Time budget:** new posts are done inside the crawl job, newest first, max ~5 min per run; any leftover is done next run. The crawl/deploy never fails because of the LLM (`continue-on-error`, rules as fallback).
- **Backfill** of ~2,000 older posts: a manual workflow `ai-backfill.yml` (~300 posts per run, under the 6 h job limit), or one evening on the Mac with Ollama.

### On the site
- `posts.ts`: `title = ai.title ?? rules`; Gholam's first sentence becomes the lede under it. `tags = ai.topics ?? rules`; `ai.type` drives a new filter chip row.
- `ai.short` goes to the stories rail, push text and peek cards; feeds and JSON-LD use the AI title.
- `/admin/`: how many posts have an AI title vs the fallback, and which model.

### Quality check
- Golden set: ~40 real posts in `pipeline/tests/golden/` with hand-checked titles/topics/type.
- `python -m pipeline.ai --eval` prints topic precision/recall vs the keyword rules, title-rule pass rate, and seconds per post.
- Run it for the bake-off and on every prompt/model change; review 20 titles by eye before switching the site over.

---

## P1-A. Mehrzad's YouTube channel: its own section

Channel: **https://www.youtube.com/@mehrzad.samadi**

### Source of truth: `data/videos.json`
- A daily step in the workflow runs `yt-dlp --flat-playlist -J https://www.youtube.com/@mehrzad.samadi/videos` and `…/streams`. GitHub's runners can reach YouTube; the dev machine can't. Free, and no API key.
- Then full metadata for new ids only: title, number («NN. … [Persian]»), date, duration, thumbnail, description, chapters (description timestamps), links in the description (papers, GitHub).
- Each video is matched to its Telegram post (by YouTube id in the post's links), which brings Gholam's Persian summary.
- P1-B gives every video a Persian title, summary points and a category, also for episodes 1–41, which predate the crawl.
- What's in the data today: episodes 42–51 (posts 4538, 5022, 5166, 5272, 5614, 5809, 6108≈48, 6236, 6384, 6543) and «Live 1» (4891).

### On the site
- `/videos/`: the newest episode as a large hero, then shelves by category (sideways rows: thumbnail, episode number, duration, Persian title), then all episodes by number. Added to the tab bar/menu.
- Per-episode page: Persian summary, chapters, links from the description, related site news by shared topics, «تماشا در یوتیوب» button.
  - YouTube is filtered in Iran, so no embed by default: the summary is the value. The thumbnail goes through `/api/img`.
- Categories (a closed enum in the P1-B call, adjust freely): «مقاله‌خوانی» (papers), «تکنیک‌های مدل» (model techniques), «ایجنت و ابزار» (agents & tools), «رباتیک» (robotics), «گفتگو و مهمان» (interviews), «لایو» (live), «مهارت و مسیر شغلی» (skills & career).

### A new video is special, not just another story
- Home: a distinct wide card «ویدیوی تازه مهرزاد» with a red accent, pinned at the top for 48 h.
- Its own circle at the front of the stories rail.
- Push: its own notification type, also sent in "daily" mode.
- Feed `rss/videos.xml`, listed on `/feeds/`.
- Never hidden for lack of Gholam (P0-1).
- A new episode found by yt-dlp before Mehrzad posts it on Telegram still appears, from YouTube's data.

---

## P1-C. The news video maker: better and more useful

Today (`src/scripts/video.ts`): landscape 1280×720 only, reads up to 2,400 characters of Gholam's text (≈2–3 min), and opens with a 2.8 s logo intro. That's long for sharing, and the wrong shape for where people share in Iran (Instagram stories/reels, Telegram, WhatsApp status: all vertical).

1. **Vertical 9:16 (1080×1920) as the default on phones**, with landscape and square as options in the sheet («عمودی / افقی / مربع»).
   - Vertical layout: headline on top, picture in the middle third, captions large below.
   - The drawing code is already in one `painter()`; give it a layout per shape.
2. **Short by default, ≤60 s:** a hook, 3 points and «چرا مهمه؟», from P1-B's `ai.video`. «نسخه کامل» keeps today's full read.
3. **Hook in the first second:** the short title over the picture from frame 1. The logo becomes a corner watermark plus the closing card; drop the 2.8 s intro.
4. **Credibility on screen:** "Source: TechCrunch · 26 Aban" (from the post's links and date) on the first scene and the closing card.
5. **Ready to post:**
   - P1-B's `share` caption is copied with the file (`navigator.share` text) and shown with a «کپی متن» (copy text) button.
   - The first frame works as a cover, so Telegram and Instagram show a good preview.
6. **Instant again:** keep a made video in Cache Storage by (post, shape, voice), so sharing it twice doesn't rebuild it; show «ساخته شده» (made).
7. **New kinds of video:**
   - **«۶۰ ثانیه خبر امروز»** (today in 60 seconds): one tap from the home brief, vertical, the 24-hour summary's top 5 items.
   - **Teaser for each new Mehrzad episode:** thumbnail, 3 Persian points, «تماشا در یوتیوب @mehrzad.samadi».
8. **Know if it's used:** count "made" and "shared" per format in the existing `engage` pipeline (no extra Redis calls), shown in `/admin/`.
- Keep: on-device only, iOS gesture rules, the MediaRecorder fallback (CLAUDE.md "Gotchas").
- Test with Playwright: one vertical and one landscape file, checking frame size, duration ≤ 65 s and that it has sound.

---

## P1-D. Word-by-word highlighting while the news is read aloud, everywhere

### Today
- The story page lights the **whole paragraph** (`.is-speaking` in `reader.ts`), and the morning brief lights the whole list item.
- The /today/ player, the playlist, the week's top and the listen bar show no text at all.
- Word timing exists only in the video maker (`src/lib/align.ts` on the clip's sound).

### 1. Timings: one module for every voice (`src/scripts/words.ts`)
For each spoken line it gives `Span[]` (word → start/end in the clip), plus `wordAt(t)` by binary search.

| Voice | How words are timed |
|---|---|
| Cloud `/api/tts`, remote, offline-saved clips | fetch the clip → `decodeAudioData` → `align()`; cached by clip URL (memory + `sessionStorage`), so it's done once per paragraph |
| On-device voice (sherpa worker) | the worker already has the PCM: run `align()` in the worker and send the spans with the clip |
| Device voice (`speechSynthesis`) | `boundary` events (`charIndex`) where the browser fires them. Otherwise an estimate: `align.ts` weights × this voice's speed (learned from earlier utterances' lengths), reset at each sentence start, so errors never build up |

- Playback clock: `audio.currentTime` (already rate-aware), read in a `requestAnimationFrame` loop only while playing and the tab is visible. The DOM changes **only when the word changes**.
- Lead of ~60 ms (the highlight lands just before the sound, which feels in sync); tuned per engine.

### 2. Look: designed, not just a yellow box
- **A gliding pill:** one absolutely positioned element per text block, moved with `transform`/`width` to the current word's `Range.getClientRects()`. It slides smoothly from word to word (~120 ms ease-out), and on a line break it fades out and in rather than sliding across the line. Soft `--accent-soft` fill, rounded, a faint glow in dark mode; RTL-correct, including English words inside Persian lines (bidi rects).
- **Read-along ink:** in the paragraph being read, words already said are full ink and words still to come are slightly muted. Done with the **CSS Custom Highlight API** (`CSS.highlights` + `::highlight(tts-ahead)`), so **no spans in the page's HTML**. That keeps per-page markup lean, as CLAUDE.md requires, since it's multiplied by every post.
- The paragraph tint stays, softer, as context.
- `prefers-reduced-motion`: no glide or fade, the pill just jumps.
- The new colors become tokens at the top of `global.css`, in light and dark.
- Fallback for browsers without the Highlight API: wrap only the paragraph being read in word spans at runtime, and unwrap it after.
- Follows the reader's text size/spacing settings and reading mode: positions are recomputed on `ResizeObserver` / font load / settings change.

### 3. Where it shows
1. **Story page:** headline and text. **Tap a word to jump there** (seeks the clip to that word's start; today tap jumps to the paragraph). Auto-scroll keeps the current line in a comfortable band, still only when the reader hasn't scrolled in the last 5 s.
2. **Home morning brief:** word highlight inside the item being read.
3. **Listen bar (`ListenBar.astro`), on every page and in the shell frame:** a one-line live caption of the sentence being said, with the current word lit. This covers the playlist, the week's top and the brief when their text isn't on screen.
4. **/today/ player:** with «روایت» on, a 2-line caption at the bottom of the scene, Instagram-caption style, word lit, over a soft gradient for legibility on any picture.
5. **Shell frame:** the top window plays and the framed page highlights. Use the same relayed-documents path `speech.ts` already uses (`relatedDocs()`).
6. **Video (P1-C):** shares the same timings module, so the video's lit words and the page's match.

### 4. Accuracy and checks
- A labeled set: ~10 short clips per voice family (cloud + each on-device family) with hand-marked word starts in `tests/fixtures/`.
- `tests/align.test.mjs` asserts median error < 80 ms and p90 < 150 ms. Tune `align.ts` weights against it.
- Playwright (Chrome + WebKit, against `npm run serve`): start listening on a story, check that the pill moves across ≥10 words in order, the tap-a-word jump works, no layout shift, and dark mode.
- Real iOS Safari (Simulator, see CLAUDE.md): the highlight follows after a lock-screen pause/resume.
- Setting «هایلایت کلمه‌ها» (highlight words), on by default, in the reader settings.
- `aria-live` is not used for words (screen readers would read every word twice).

---

## P2. More from Qwen (builds on P1-B's runner setup)

**Limit:** the model runs only while the workflow runs (batch, ~30 s per post), never as a server. So: nothing real-time (chat replies, answering readers). Everything below is worked out once and saved in `data/`.

### How the work is split (so the time per post stays known)
| Call | When | What it returns |
|---|---|---|
| **A. Core** (P1-B's call, extended) | every new post | title, short, topics, type, video, share **+ importance, entities, terms, simple, quiz** (items 5, 6, 8, 9, 10) |
| **B. Speech** | posts with Latin letters/digits | only the replacements, not a rewritten text (item 2) |
| **C. Translate** | only when Gholam has no usable comment | a Persian story (item 1) |
| **D. Embeddings** | every new post | a vector (Qwen3-Embedding-0.6B, ~0.2 s) (item 4) |
| **E. Daily / weekly** | the 04:12 UTC run / once a week | podcast host lines, weekly recap (items 7, 11) |
| **F. Comments** | every run, new comments only | a flag (item 12) |

### 1. Translation when Gholam is silent or fails
- When `usable_gholam()` is None after `GHOLAM_POLL_HOURS`, or right away for a YouTube post: Qwen writes a Persian story (lede + 2–4 paragraphs + «چرا مهمه؟») from the tweet, article or video description.
- Stored as `ai.story`, shown with the label «ترجمه خودکار» (automatic translation). If Gholam comments later, his text replaces it.
- Ends the "post hidden for lack of a translation" problem (episode 51) for good. The `brief` kind stays only for posts with nothing to translate.

### 2. A spoken version for the voices
- Call B returns `[{from, to}]` replacements only, e.g. `GPT-5` → «جی‌پی‌تی پنج», `$2.5B` → «دو و نیم میلیارد دلار», `Anthropic` → «آنتروپیک», `SWE-bench` → «اس‌دبلیو‌ای بنچ».
- A shared lexicon `data/lexicon.json` keeps every answer, so each term is asked once ever and pronounced the same everywhere. Deterministic code handles plain numbers and dates (no model needed).
- card.json gets `spoken` lines next to the shown lines. `/api/tts`, the on-device voice and the device voice say `spoken`, and the page shows the original.
- Word highlighting (P1-D) maps spoken words back to shown words through the replacements: one shown word can be several spoken ones.
- Check: listen to 20 stories per voice before and after; `tests/` covers the mapping.

### 3. Full summaries of Mehrzad's videos from their subtitles
- `yt-dlp --write-auto-subs --sub-langs fa,en --skip-download` for new episodes. The subtitles go in `data/videos/<id>.vtt`, or are dropped after use to save space.
- Qwen, in chunks of the transcript: a Persian summary, 5–8 key points, and Persian chapter titles with times (or translated description chapters when they exist).
- The episode page (P1-A) shows them, and «تماشا از اینجا» (watch from here) links open YouTube at each chapter's time.

### 4. Real "related news" + duplicates grouped
- Qwen3-Embedding-0.6B (GGUF, `llama-server --embedding`, cached like the main model).
- Vectors live in the Actions cache, not in git; they're cheap to rebuild if evicted.
- Saved in each post: `ai.related` (top 5 ids by meaning, recent first) and `ai.cluster` (posts within ~48 h that are very similar, e.g. 6558/6559/6572 from OpenAI).
- Site: a cluster shows as one story with «به‌روزرسانی‌ها» (updates) under it in the timeline, and the others stay reachable. `related()` in `posts.ts` uses `ai.related`, falling back to tag overlap.
- Tune the similarity threshold on real pairs; a wrong merge is worse than none.

### 5. Jargon explained
- Call A returns `terms`: technical words in the story, each with a one-line Persian explanation.
- Shared glossary `data/glossary.json`: the first good explanation wins, and is editable by hand.
- Story page: the term gets a dotted underline (at runtime, from card.json, not in the HTML) and a tap opens a small card.
- `/glossary/` page lists all terms A–Z / الفبا, each with its stories.

### 6. People and companies pages
- Call A returns `entities`: `{name_en, name_fa, kind: person|company|model|product}`.
- `data/entities.json` fixes one Persian spelling per entity, and is editable.
- `/who/<slug>/` pages: everything about OpenAI, Altman, Qwen…, with a follow button reusing `follow.ts`.
- Can later replace part of the hand-kept TOPICS keyword lists.

### 7. Podcast host lines for the daily playlist
- In the morning run: a short intro («صبح بخیر، امروز ۱۲ خبر داریم؛ از…», "good morning, we have 12 stories today…"), one-sentence links between stories, and an outro.
- Stored in `data/daily/<day>.json`. `playlist.ts` speaks them between the stories, with the same voice.

### 8. "Most important today"
- Call A returns `importance` 1–5 with a fixed rubric: big lab release / policy / large money = high; opinion or small tool = low.
- Home: the day's top story as the hero, and a «حتماً بخوانید» (must read) badge on 4–5.
- The /today/ stories can offer the order «مهم‌ترین اول» (most important first) next to newest/oldest.

### 9. «به زبان ساده» (in simple words)
- Call A returns `simple`: 2 plain sentences, only for stories it rates technical (else null).
- A small collapsible box under the lede.

### 10. A quiz question per story
- Call A returns `quiz`: `{q, options[3], answer}` from the story's own text.
- At the end of a story page: one tap answers, +points in `game.ts` (local, like today's points), plus a «کنجکاو» (curious) badge for 10 correct.
- No server calls (Upstash budget).

### 11. A Persian weekly recap
- Weekly workflow (Friday morning Tehran): from the week's top-viewed (`card.json`, `_stats.js`) + most important stories, Qwen writes «هفته‌ای که گذشت» (the week that was), ~8 items.
- Stored in `data/weekly/<week>.json`, shown at the top of `/week/`, sent as a push in "daily" and "all" modes, and readable aloud.

### 12. Comment checks
- Each run reads comments added since the last check (one Upstash call), and Qwen flags insults, spam and off-topic.
- Flags go to `/admin/` as «بررسی خودکار» (automatic check). It never hides a comment by itself: the owner decides, as with reports.
- Needs `KV_REST_API_URL` / `KV_REST_API_TOKEN` as GitHub secrets (read + flag only).

### Time budget (verify in the P1-B bake-off)
- A bigger core call (~250 output tokens) is about +15–25 s per post on a 4B model; speech replacements are usually a few seconds; translation (rare) is ~1 min; embeddings are negligible.
- At ~20 posts/day that's well under 30 min/day of free runner time.
- The per-run 5 min cap still holds: leftovers go to the next run, newest first.

---

## Order of work
1. **P0-1 + P0-2 + P0-4:** one small PR (video #51 visible, workflow fixes).
2. **P0-3:** you regenerate the token in GitHub and Vercel (before the date in the email).
3. **P1-B:** `pipeline/ai.py` + llama-server + cache in the workflow, golden set + bake-off, then switch titles/topics/type on the site, then backfill.
4. **P1-A:** `data/videos.json` from @mehrzad.samadi, `/videos/`, new-video treatment.
5. **P1-D:** word timings module + gliding highlight on the story page first, then the listen bar caption, /today/ captions, the brief. Independent of P1-B, so it can run in parallel.
6. **P1-C:** vertical + short video, share caption, «۶۰ ثانیه خبر امروز», episode teasers (reuses P1-B text and P1-D timings).
7. **P2, in this order:**
   - **First:** 1 (translation fallback), 2 (spoken version), 4 (related + duplicates). Biggest effect, cheapest.
   - **Then:** 3 (video summaries, with P1-A), 8 (importance), 5 (glossary), 6 (entity pages).
   - **Last:** 7 (podcast host lines), 9 (in simple words), 10 (quiz), 11 (weekly recap), 12 (comment checks).

## Open questions
- Which token does the GitHub email name, and its expiry date? (Assumed: `GITHUB_DISPATCH_TOKEN`.)
- `type` and video categories: OK with the proposed lists?
- Should AI titles replace Gholam's first sentence everywhere, or only on cards/feeds while the story page keeps his sentence as the headline?
