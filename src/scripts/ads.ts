// The small ad slot (server/ads.js, set from /admin/ «تبلیغات»). A page marks where one may go (`[data-ad="home"]`…,
// components/AdSlot.astro, hidden); this fills it when the owner turned that slot on, only once it comes near the
// screen, and never moves anything above the reader's place. One config request per visit (kept 30 minutes in
// sessionStorage, and shared at the edge for 5), views and clicks counted with the presence beat (`ad-view`/`ad-click`).
import { $$, esc, track } from './core';
import { SITE } from '../site';

type AdConfig = {
  enabled: boolean;
  provider?: 'house' | 'adsense' | 'html';
  label?: string;
  labelEn?: string;
  slots?: string[];
  langs?: string[];
  house?: { title: string; text: string; cta: string; image: string; href: string };
  adsense?: { client: string; slot: string };
  html?: string;
  height?: number;
};

const KEY = 'khabar:ads';
const TTL = 30 * 60_000;

async function config(): Promise<AdConfig> {
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (kept && Date.now() - kept.at < TTL) return kept.c;
  } catch {}
  const c: AdConfig = await fetch(`${SITE.api}/api/ads/`).then((r) => (r.ok ? r.json() : { enabled: false }), () => ({ enabled: false }));
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), c }));
  } catch {}
  return c;
}

let adsense = false;
function loadAdsense(client: string) {
  if (adsense) return;
  adsense = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.append(s);
}

function render(el: HTMLElement, c: AdConfig, en: boolean) {
  const label = esc((en ? c.labelEn : c.label) || (en ? 'Sponsored' : 'تبلیغ'));
  if (c.provider === 'house' && c.house) {
    const h = c.house;
    el.innerHTML = `<span class="ad-label">${label}</span>
      <a class="ad-house" href="${esc(h.href)}" target="_blank" rel="sponsored noopener" dir="auto">
        ${h.image ? `<img src="${esc(h.image)}" alt="" loading="lazy" decoding="async" />` : ''}
        <span class="ad-body"><b>${esc(h.title)}</b>${h.text ? `<span>${esc(h.text)}</span>` : ''}</span>
        ${h.cta ? `<span class="ad-cta">${esc(h.cta)}</span>` : ''}
      </a>`;
    el.querySelector('a')?.addEventListener('click', () => track('ad-click'));
  } else if (c.provider === 'adsense' && c.adsense) {
    el.innerHTML = `<span class="ad-label">${label}</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(c.adsense.client)}" data-ad-slot="${esc(c.adsense.slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    loadAdsense(c.adsense.client);
    const w = window as Window & { adsbygoogle?: unknown[] };
    (w.adsbygoogle = w.adsbygoogle || []).push({});
  } else if (c.provider === 'html' && c.html) {
    // Another network's snippet runs in its own sandboxed frame: no access to this page, its storage or its cookies.
    const frame = document.createElement('iframe');
    frame.className = 'ad-frame';
    frame.title = label;
    frame.loading = 'lazy';
    frame.height = String(c.height ?? 120);
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;overflow:hidden;font-family:system-ui}</style>${c.html}`;
    el.innerHTML = `<span class="ad-label">${label}</span>`;
    el.append(frame);
    frame.addEventListener('focus', () => track('ad-click'));
  } else return;
  el.hidden = false;
  el.classList.add('is-on');
  track('ad-view');
}

export async function initAds() {
  const slots = $$('[data-ad]');
  if (!slots.length) return;
  const c = await config();
  if (!c.enabled) return;
  const en = document.documentElement.lang === 'en';
  if (c.langs && !c.langs.includes(en ? 'en' : 'fa')) return;
  const on = slots.filter((el) => c.slots?.includes(el.dataset.ad ?? ''));
  if (!on.length) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        render(e.target as HTMLElement, c, en);
      }
    },
    { rootMargin: '600px 0px' },
  );
  // A hidden element is never "intersecting": observe it unhidden but empty (no height).
  on.forEach((el) => {
    el.hidden = false;
    io.observe(el);
  });
}
