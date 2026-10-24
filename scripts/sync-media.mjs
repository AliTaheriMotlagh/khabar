// Copy the media store (orphan "media" branch checkout) into public/media so Astro serves it. Runs before dev/build.
// On Vercel only main is cloned, so the media branch is fetched here (set GITHUB_TOKEN in Vercel for a private repo).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const src = path.resolve(process.env.MEDIA_DIR || 'media-store');
const dest = path.resolve('public/media');

if (!fs.existsSync(src) && process.env.VERCEL && process.env.VERCEL_GIT_PROVIDER === 'github') {
  const repo = `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`;
  const auth = process.env.GITHUB_TOKEN ? `x-access-token:${process.env.GITHUB_TOKEN}@` : '';
  try {
    execFileSync('git', ['clone', '--depth', '1', '--branch', 'media', '--single-branch', `https://${auth}github.com/${repo}.git`, src], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch {
    console.log(`could not fetch the media branch of ${repo}; building without media`);
  }
}

fs.rmSync(dest, { recursive: true, force: true });
if (fs.existsSync(src)) {
  fs.cpSync(src, dest, { recursive: true, filter: (p) => path.basename(p) !== '.git' });
  console.log(`media synced from ${path.relative(process.cwd(), src) || src}`);
} else {
  console.log('no media store found, skipping media sync');
}
