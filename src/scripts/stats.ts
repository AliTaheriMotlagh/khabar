// The visits page (src/pages/stats/index.astro): readers per day for the last week as bars, and the most viewed
// stories today, this week and of all time — from /api/stats (cached 10 minutes), titles from each story's card.json.
import { SITE } from '../site';
import { $, $$, BASE, compact, esc, fmtNum } from './core';
import { TZ } from '../lib/time';

type Top = { id: number; views: number };
type Stats = { days: { day: string; readers: number }[]; top: Record<'today' | 'week' | 'all', Top[]> };
type Card = { title: string; href: string; thumb?: string };

const cards = new Map<number, Promise<Card | null>>();
const card = (id: number) => {
  if (!cards.has(id)) cards.set(id, fetch(`${BASE}/p/${id}/card.json`).then((r) => (r.ok ? r.json() : null), () => null));
  return cards.get(id)!;
};

// Noon on the day, so the weekday is right in Tehran whatever the viewer's zone.
const weekday = (d: string) => new Intl.DateTimeFormat('fa-IR', { weekday: 'long', timeZone: TZ }).format(new Date(`${d}T12:00:00+03:30`));
const date = (d: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long', timeZone: TZ }).format(new Date(`${d}T12:00:00+03:30`));

function chart(days: Stats['days']) {
  const box = $('[data-st-chart]')!;
  const max = Math.max(1, ...days.map((d) => d.readers));
  const best = days.reduce((b, d) => (d.readers > b.readers ? d : b), days[0]);
  const last = days.length - 1;
  // Oldest first: in this right-to-left page the week runs from right to left, today at the far left.
  box.innerHTML = days
    .map((d, i) => {
      const today = i === last;
      const label = `${today ? 'امروز (تا این لحظه)' : weekday(d.day)} ${date(d.day)}: ${fmtNum(d.readers)} خواننده`;
      // Selective labels: the busiest day and today.
      const shown = d === best || today;
      return `<div class="st-col${today ? ' today' : ''}" tabindex="0" role="img" aria-label="${esc(label)}">
        <span class="st-tip" aria-hidden="true">${esc(label)}</span>
        <span class="st-val" aria-hidden="true">${shown ? compact(d.readers) : ''}</span>
        <span class="st-bar" style="height:${Math.max(d.readers ? 2 : 0, (d.readers / max) * 100)}%" aria-hidden="true"></span>
        <span class="st-day" aria-hidden="true">${today ? 'امروز' : weekday(d.day)}</span>
      </div>`;
    })
    .join('');
  $('[data-st-table]')!.innerHTML = days
    .map((d, i) => `<tr><td>${esc(i === last ? 'امروز' : weekday(d.day))} ${esc(date(d.day))}</td><td>${fmtNum(d.readers)}</td></tr>`)
    .join('');
}

async function list(top: Top[]) {
  const ol = $('[data-st-top]')!;
  $('[data-st-empty]')!.hidden = top.length > 0;
  const got = await Promise.all(top.map((t) => card(t.id)));
  const max = Math.max(1, ...top.map((t) => t.views));
  ol.innerHTML = top
    .map((t, i) => [t, got[i]] as const)
    .filter(([, c]) => c)
    .map(
      ([t, c]) => `<li><a href="${esc(c!.href)}">
        ${c!.thumb ? `<img src="${esc(c!.thumb)}" alt="" width="48" height="48" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
        <span class="st-title">${esc(c!.title)}</span>
        <span class="st-views"><b>${compact(t.views)}</b> بازدید<i style="width:${(t.views / max) * 100}%"></i></span>
      </a></li>`,
    )
    .join('');
}

export async function initStats() {
  let data: Stats;
  try {
    const res = await fetch(`${SITE.api}/api/stats/`);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    $('[data-st-off]')!.hidden = false;
    $$('[data-st-yesterday], [data-st-avg]').forEach((el) => (el.textContent = '—'));
    return;
  }
  const days = data.days;
  $('[data-st-yesterday]')!.textContent = compact(days.at(-2)?.readers ?? 0);
  // The whole days only: today isn't over.
  const whole = days.slice(0, -1).filter((d) => d.readers);
  $('[data-st-avg]')!.textContent = whole.length ? compact(Math.round(whole.reduce((s, d) => s + d.readers, 0) / whole.length)) : '—';
  chart(days);
  const range = $('[data-st-range]')!;
  const show = () => list(data.top[($<HTMLInputElement>('input:checked', range)?.value ?? 'today') as keyof Stats['top']] ?? []);
  range.addEventListener('change', show);
  show();
}
