// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The primary site is https://alitaherimotlagh.vercel.app (see src/site.ts). The GitHub Pages workflow builds a mirror
// with SITE_URL / BASE_PATH (e.g. https://you.github.io + /khabar); canonical URLs still point at the primary site.
export default defineConfig({
  site: process.env.SITE_URL || 'https://alitaherimotlagh.vercel.app',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [sitemap({ filter: (page) => !/\/(saved|search|me|offline)\/$/.test(page) })],
});
