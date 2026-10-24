// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE_URL / BASE_PATH are set by the GitHub Pages workflow (e.g. https://you.github.io + /khabar).
// On Vercel the site is served from the root of the project's production domain.
const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export default defineConfig({
  site: process.env.SITE_URL || (vercel ? `https://${vercel}` : 'http://localhost:4321'),
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [sitemap({ filter: (page) => !/\/(saved|search)\/$/.test(page) })],
});
