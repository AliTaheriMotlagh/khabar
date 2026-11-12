// The week's most read (src/pages/week): /api/stats' `top.week`, each story's picture, topic and first lines from its
// card.json. Pictures go through media.ts like everywhere else (fallback addresses in data-alt).
import { SITE } from '../site';
import { $, BASE, compact, esc, fmtNum } from './core';
import { watchMedia } from './media';
import { player, type QItem } from './listen';
import { canListen, listenOr } from './voice-offer';

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
  listen(rows.map(([, c]) => c!));
}

/** The week's most read, read aloud one after another by the site's player (src/scripts/listen.ts): each headline, then
 *  its text. It goes on while the reader browses. */
function listen(cards: Card[]) {
  const box = $('[data-wk-listen]');
  if (!box || !cards.length) return;
  const items: QItem[] = cards.map((c) => ({ id: c.id, t: c.title, h: c.href, c: c.cover ?? undefined }));
  const p = player();
  $('[data-wk-meta]', box)!.textContent = `${fmtNum(items.length)} خبر، از پربازدیدترین · خبرها پشت سر هم خوانده می‌شوند`;
  canListen().then((ok) => (box.hidden = !ok));
  const label = $('[data-wk-label]', box)!;
  const off = p.subscribe((s) => {
    const state = s.key === 'week' ? s.state : 'idle';
    box.dataset.state = state;
    label.textContent = state === 'playing' || state === 'loading' ? 'مکث' : state === 'paused' ? 'ادامه' : 'پخش';
  });
  addEventListener('pagehide', off);
  const play = () => (p.key === 'week' ? p.toggle() : p.playQueue({ key: 'week', title: 'پربازدیدهای هفته', href: location.pathname, unit: 'خبر' }, items));
  const btn = $('[data-wk-play]', box)!;
  btn.addEventListener('pointerdown', () => p.ready(), { once: true });
  btn.addEventListener('click', () => (p.key === 'week' ? play() : listenOr(play)));
}
