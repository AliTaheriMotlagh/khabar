import type { APIContext } from 'astro';
import { url } from '../lib/posts';

export function GET({ site }: APIContext) {
  const sitemap = new URL(url('sitemap-index.xml'), site).href;
  return new Response(`User-agent: *\nAllow: /\nDisallow: ${url('saved/')}\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
