#!/usr/bin/env bash
# Builds the primary site (https://blog.remixt.app) and uploads it to Cloudflare Pages (wrangler.toml): a direct upload
# — no Cloudflare Git build, so the free plan's 500 builds a month don't apply, and only changed files are sent.
# Cloudflare's free plan never bills: past its limits (20,000 files a site, 100,000 function requests a day) it refuses,
# it doesn't charge. A no-op without CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
set -eu
npm run build
files=$(find dist -type f | wc -l)
echo "dist: $files files (Cloudflare Pages free: 20,000)"
[ "$files" -lt 18000 ] || echo "::warning::dist has $files files; Cloudflare Pages' free plan refuses a site over 20,000 (PLAN.md, file budget)"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then echo "::notice::Cloudflare not configured; not deployed"; exit 0; fi
for i in 1 2 3; do
  npx -y wrangler@4 pages deploy --project-name="${CLOUDFLARE_PROJECT:-khabar}" --branch=main --commit-dirty=true && exit 0
  sleep $((i * 20))
done
exit 1
