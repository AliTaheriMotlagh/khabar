// The week's most read (src/pages/week): /api/stats' `top.week`, each story's picture, topic and first lines from its
// card.json. Pictures go through media.ts like everywhere else (fallback addresses in data-alt).
import { SITE } from '../site';
import { $, BASE, compact, esc, fmtNum } from './core';
import { watchMedia } from './media';

type Top = { id: number; views: number };
type Card = { id: number; title: string; href: string; tag: string | null; cover: string | null; coverAlt: string | null; body?: string[]; why?: string | null };

const card = (id: number): Promise<Card | null> => fetch(`${BASE}/p/${id}/card.json`).then((r) => (r.ok ? r.json() : null), () => null);
const excerpt = (c: Card) => {
  const t = (c.body ?? []).find((p) => p && p !== c.title) ?? c.why ?? '';
  return t.length > 220 ? `${t.slice(0, 220).replace(/\s+\S*$/, '')}…` : t;
};

export async function initWeek() {
  const list = $('[data-wk-list]')!;
  let top: Top[];
  try {
    const res = await fetch(`${SITE.api}/api/stats/`);
    if (!res.ok) throw new Error(String(res.status));
    top = (await res.json()).top.week;
  } catch {
    list.innerHTML = '';
    list.removeAttribute('aria-busy');
    $('[data-wk-off]')!.hidden = false;
    return;
  }
  const cards = await Promise.all(top.map((t) => card(t.id)));
  const rows = top.map((t, i) => [t, cards[i]] as const).filter(([, c]) => c);
  list.removeAttribute('aria-busy');
  $('[data-wk-empty]')!.hidden = rows.length > 0;
  list.innerHTML = rows
    .map(
      ([t, c], k) => `<li class="wk-item">
        <a href="${esc(c!.href)}">
          <span class="wk-rank" aria-label="رتبه‌ی ${fmtNum(k + 1)}">${fmtNum(k + 1)}</span>
          ${c!.cover ? `<img src="${esc(c!.cover)}" ${c!.coverAlt ? `data-alt="${esc(c!.coverAlt)}"` : ''} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
          <span class="wk-body">
            ${c!.tag ? `<small class="kicker">${esc(c!.tag)}</small>` : ''}
            <b>${esc(c!.title)}</b>
            ${excerpt(c!) ? `<span class="wk-excerpt" dir="auto">${esc(excerpt(c!))}</span>` : ''}
            <small class="wk-views">${compact(t.views)} بازدید این هفته</small>
          </span>
        </a>
      </li>`,
    )
    .join('');
  watchMedia(list);
}
