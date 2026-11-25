#!/usr/bin/env bash
# Commits data/ and pushes it to main (site.yml). Prints "changed=true|false" for $GITHUB_OUTPUT.
# A push to main can land mid-run: rebase onto it and try again instead of losing the crawl. A failed rebase is aborted
# before the next try, or every later attempt fails on "unmerged files". Still conflicting after four tries: another
# run committed the same posts, so they are on main already and the next crawl picks up anything left (a warning). A
# push that fails without a conflict (permissions, …) fails the step.
set -u
msg="${1:-data: crawl $(date -u +%Y-%m-%dT%H:%MZ)}"
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898283+github-actions[bot]@users.noreply.github.com'
git add data
if git diff --cached --quiet; then echo 'nothing new' >&2; echo changed=false; exit 0; fi
git commit -qm "$msg"
for attempt in 1 2 3 4; do
  conflict=
  if git pull --rebase -q origin main || { conflict=1; false; }; then
    git push -q origin HEAD:main && { echo changed=true; exit 0; }
  fi
  git rebase --abort 2>/dev/null || true
  sleep $((attempt * 5))
done
[ -n "$conflict" ] || exit 1
echo "::warning::this crawl conflicts with posts already on main; leaving it to the next run" >&2
echo changed=false
