// The explorer (/investigate/, /en/investigate/) and the day archive (/archive/, /en/archive/), in both languages,
// from one file (/investigate.json). The explorer follows a company, person, model, topic or any words through every
// story: how often week by week (and against a second subject), how it was reported — the first rumour, the first
// report, when it became official —, who else is named with it, who published it, and the whole story oldest first.
// The archive opens any day (a calendar shaded by how much happened) and "on this day" in earlier months.
import { BASE, esc, track } from './core';

type Raw = { t: string[]; te: string[]; e: [string, string, string, string][]; s: [number, number, string, string, number[], number[], number, number, string, number][] };
type Story = { id: number; at: number; fa: string; en: string; topics: number[]; ents: number[]; status: number; imp: number; who: string; thread: number };
type Subject = { kind: 'ent' | 'topic' | 'text'; key: number | string; label: string };

const EN = document.documentElement.lang === 'en';
const T = EN
  ? {
      stories: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'story' : 'stories'}`,
      first: 'First seen', last: 'Latest', peak: 'Busiest week', weekly: 'Stories per week', how: 'How it was reported',
      status: ['', 'Official', 'Reported', 'Unconfirmed'], together: 'Often named together', sources: 'Who published it',
      timeline: 'The whole story, oldest first', newest: 'Newest first', oldest: 'Oldest first', none: 'Nothing in the archive matches that yet.',
      path: (a: string, b: string, d: number) => `Unconfirmed ${a} → official ${b}${d ? ` (${d} day${d === 1 ? '' : 's'} later)` : ' (the same day)'}:`,
      path2: (a: string) => `First reported ${a}.`, trending: 'Rising this week', most: 'Most covered of all time', vs: 'Compare with',
      week: (d: string) => `week of ${d}`, clear: 'Clear', placeholder: 'A company, person, model, topic or any words…', go: 'Explore',
      day: (n: number) => `${n} ${n === 1 ? 'story' : 'stories'} that day`, onThisDay: 'On this day in earlier months', pick: 'Pick a day',
      newer: 'Next month', older: 'Previous month', thread: 'part of a running story',
    }
  : {
      stories: (n: number) => `${n.toLocaleString('fa-IR')} خبر`,
      first: 'اولین خبر', last: 'تازه‌ترین', peak: 'شلوغ‌ترین هفته', weekly: 'تعداد خبر در هر هفته', how: 'چطور گزارش شد',
      status: ['', 'رسمی', 'به گزارش رسانه‌ها', 'تأییدنشده'], together: 'معمولاً با این‌ها می‌آید', sources: 'منتشرکننده‌ها',
      timeline: 'کل ماجرا، از اول تا امروز', newest: 'تازه‌ترین اول', oldest: 'قدیمی‌ترین اول', none: 'هنوز در آرشیو چیزی با این مشخصات نیست.',
      path: (a: string, b: string, d: number) => `تأییدنشده ${a} ← رسمی ${b}${d ? ` (${d.toLocaleString('fa-IR')} روز بعد)` : ' (همان روز)'}:`,
      path2: (a: string) => `اولین گزارش: ${a}.`, trending: 'داغ‌شده در این هفته', most: 'پرخبرترین‌ها در کل آرشیو', vs: 'مقایسه با',
      week: (d: string) => `هفته‌ی ${d}`, clear: 'پاک کردن', placeholder: 'شرکت، آدم، مدل، موضوع یا هر کلمه‌ای…', go: 'کاوش',
      day: (n: number) => `${n.toLocaleString('fa-IR')} خبر در این روز`, onThisDay: 'همین روز در ماه‌های قبل', pick: 'یک روز را انتخاب کنید',
      newer: 'ماه بعد', older: 'ماه قبل', thread: 'بخشی از یک ماجرای دنباله‌دار',
    };
const TZ = 'Asia/Tehran';
const dayFmt = new Intl.DateTimeFormat(EN ? 'en-US' : 'fa-IR-u-ca-persian', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const fmtDay = (ms: number) => dayFmt.format(new Date(ms));
const dayKey = (ms: number) => keyFmt.format(new Date(ms));
const href = (s: Story) => `${BASE}/${EN && s.en ? 'en/' : ''}p/${s.id}/`;
const title = (s: Story) => (EN && s.en ? s.en : s.fa);

let data: { raw: Raw; stories: Story[] } | null = null;
async function load() {
  if (data) return data;
  const raw: Raw = await fetch(`${BASE}/investigate.json`).then((r) => r.json());
  const stories = raw.s
    .map(([id, min, fa, en, topics, ents, status, imp, who, thread]) => ({ id, at: min * 60000, fa, en, topics, ents, status, imp, who, thread }))
    .filter((s) => !EN || s.en)
    .sort((a, b) => a.at - b.at);
  return (data = { raw, stories });
}

const entName = (raw: Raw, i: number) => (EN ? raw.e[i][1] : raw.e[i][2] || raw.e[i][1]);
const topicName = (raw: Raw, i: number) => (EN ? raw.te[i] : raw.t[i]);
const norm = (s: string) => s.toLowerCase().replace(/[‌\s]+/g, ' ').replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک').trim();

function resolve(raw: Raw, q: string): Subject | null {
  const n = norm(q);
  if (!n) return null;
  const e = raw.e.findIndex((x) => norm(x[1]) === n || norm(x[2]) === n || x[0] === n);
  if (e >= 0) return { kind: 'ent', key: e, label: entName(raw, e) };
  const t = raw.t.findIndex((x, i) => norm(x) === n || norm(raw.te[i]) === n);
  if (t >= 0) return { kind: 'topic', key: t, label: topicName(raw, t) };
  return { kind: 'text', key: n, label: q.trim() };
}
const matches = (s: Story, sub: Subject) =>
  sub.kind === 'ent' ? s.ents.includes(sub.key as number) : sub.kind === 'topic' ? s.topics.includes(sub.key as number) : norm(`${s.fa} ${s.en} ${s.who}`).includes(sub.key as string);

const WEEK = 7 * 864e5;
const weekOf = (ms: number) => Math.floor((ms + 3 * 864e5) / WEEK); // weeks start on Saturday in Tehran… close enough: Monday-based count

function chart(series: { label: string; list: Story[]; cls: string }[], from: number, to: number) {
  const w0 = weekOf(from);
  const n = Math.max(1, weekOf(to) - w0 + 1);
  const counts = series.map((s) => {
    const c = new Array(n).fill(0);
    for (const x of s.list) c[weekOf(x.at) - w0]++;
    return c;
  });
  const max = Math.max(1, ...counts.flat());
  const W = 640, H = 120, bw = W / n;
  const bars = counts
    .map((c, si) =>
      c
        .map((v, i) => {
          if (!v) return '';
          const h = Math.max(2, (v / max) * (H - 14));
          const x = i * bw + (series.length > 1 ? (si * bw) / 2 : 0);
          const when = fmtDay((w0 + i) * WEEK - 3 * 864e5);
          return `<rect class="${series[si].cls}" x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw / series.length - 1).toFixed(1)}" height="${h.toFixed(1)}" data-week="${w0 + i}"><title>${esc(series[si].label)} · ${esc(T.week(when))}: ${v}</title></rect>`;
        })
        .join(''),
    )
    .join('');
  const legend = series.length > 1 ? `<p class="iv-legend">${series.map((s) => `<span class="${s.cls}">■ ${esc(s.label)} (${s.list.length})</span>`).join(' ')}</p>` : '';
  return `<figure class="iv-chart"><figcaption>${T.weekly}</figcaption><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${T.weekly}">${bars}</svg><div class="iv-axis"><span>${fmtDay(from)}</span><span>${fmtDay(to)}</span></div>${legend}</figure>`;
}

const chip = (status: number) => (status ? `<span class="status ${['', 'is-official', 'is-report', 'is-rumor'][status]}">${T.status[status]}</span>` : '');
const row = (s: Story) =>
  `<li><time>${fmtDay(s.at)}</time>${chip(s.status)}<a href="${href(s)}">${esc(title(s))}</a>${s.who ? `<small>${esc(s.who)}</small>` : ''}</li>`;

function report(raw: Raw, list: Story[], sub: Subject, vs: { sub: Subject; list: Story[] } | null, all: Story[]) {
  if (!list.length) return `<p class="iv-empty">${T.none}</p>`;
  const first = list[0], last = list.at(-1)!;
  const weeks = new Map<number, number>();
  for (const s of list) weeks.set(weekOf(s.at), (weeks.get(weekOf(s.at)) ?? 0) + 1);
  const [pw, pc] = [...weeks].sort((a, b) => b[1] - a[1])[0];
  const by = [0, 0, 0, 0];
  for (const s of list) by[s.status]++;
  const known = by[1] + by[2] + by[3] || 1;
  // A rumour that later became official: only inside one running story (a thread, data/related.json), where the
  // later official story is about the same news — across a whole company it would pair unrelated stories.
  const threads = new Map<number, Story[]>();
  for (const s of list) if (s.thread) threads.set(s.thread, [...(threads.get(s.thread) ?? []), s]);
  const confirmed = [...threads.values()]
    .map((t) => {
      const rumor = t.find((s) => s.status === 3);
      const official = rumor && t.find((s) => s.status === 1 && s.at > rumor.at);
      return rumor && official ? { rumor, official } : null;
    })
    .filter((x): x is { rumor: Story; official: Story } => !!x)
    .slice(-3);
  const reported = list.find((s) => s.status === 2);
  const days = (a: number, b: number) => Math.round((b - a) / 864e5);
  const path = confirmed.length
    ? confirmed.map(({ rumor, official }) => `<li>${T.path(`<a href="${href(rumor)}">${fmtDay(rumor.at)}</a>`, `<a href="${href(official)}">${fmtDay(official.at)}</a>`, days(rumor.at, official.at))} <small>${esc(title(rumor))}</small></li>`).join('')
    : reported
      ? `<li>${T.path2(`<a href="${href(reported)}">${fmtDay(reported.at)}</a>`)}</li>`
      : '';
  const co = new Map<string, number>();
  for (const s of list) {
    for (const e of s.ents) if (!(sub.kind === 'ent' && e === sub.key)) co.set(`e${e}`, (co.get(`e${e}`) ?? 0) + 1);
    for (const t of s.topics) if (!(sub.kind === 'topic' && t === sub.key)) co.set(`t${t}`, (co.get(`t${t}`) ?? 0) + 1);
  }
  // One chip per name (a topic and a company can share it: «OpenAI»), never the subject itself.
  const byLabel = new Map<string, number>();
  for (const [k, n] of co) {
    const label = k[0] === 'e' ? entName(raw, Number(k.slice(1))) : topicName(raw, Number(k.slice(1)));
    if (norm(label) === norm(sub.label)) continue;
    byLabel.set(label, Math.max(byLabel.get(label) ?? 0, n));
  }
  const together = [...byLabel].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, n]) => `<button type="button" class="chip" data-iv-q="${esc(label)}">${esc(label)} <small>${n}</small></button>`);
  const pubs = new Map<string, number>();
  for (const s of list) if (s.who) pubs.set(s.who, (pubs.get(s.who) ?? 0) + 1);
  const from = Math.min(first.at, vs?.list[0]?.at ?? Infinity);
  const to = Math.max(last.at, vs?.list.at(-1)?.at ?? 0, all.at(-1)?.at ?? 0);
  return `
    <div class="iv-stats">
      <div><b>${T.stories(list.length)}</b><small>${esc(sub.label)}</small></div>
      <div><b>${fmtDay(first.at)}</b><small>${T.first}</small></div>
      <div><b>${fmtDay(last.at)}</b><small>${T.last}</small></div>
      <div><b>${T.stories(pc)}</b><small>${T.peak}: ${fmtDay(pw * WEEK - 3 * 864e5)}</small></div>
    </div>
    ${chart([{ label: sub.label, list, cls: 'iv-a' }, ...(vs ? [{ label: vs.sub.label, list: vs.list, cls: 'iv-b' }] : [])], from, to)}
    <section class="iv-sec"><h2>${T.how}</h2>
      <div class="iv-bar">${[1, 2, 3].map((k) => (by[k] ? `<span class="iv-s${k}" style="flex:${by[k]}" title="${T.status[k]}: ${by[k]}">${T.status[k]} ${Math.round((by[k] / known) * 100)}%</span>` : '')).join('')}</div>
      ${path ? `<ul class="iv-path">${path}</ul>` : ''}
    </section>
    ${together.length ? `<section class="iv-sec"><h2>${T.together}</h2><div class="chips wrap">${together.join('')}</div></section>` : ''}
    ${pubs.size ? `<section class="iv-sec"><h2>${T.sources}</h2><ol class="iv-pubs">${[...pubs].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, n]) => `<li><span>${esc(w)}</span><b>${n}</b></li>`).join('')}</ol></section>` : ''}
    <section class="iv-sec"><h2>${T.timeline}</h2>
      <div class="seg iv-order"><label><input type="radio" name="iv-order" value="old" checked /><span>${T.oldest}</span></label><label><input type="radio" name="iv-order" value="new" /><span>${T.newest}</span></label></div>
      <ol class="iv-list" data-iv-list>${list.map(row).join('')}</ol>
    </section>`;
}

function overview(raw: Raw, all: Story[]) {
  const now = all.at(-1)?.at ?? Date.now();
  const recent = new Map<number, number>(), before = new Map<number, number>(), total = new Map<number, number>();
  for (const s of all) {
    for (const e of s.ents) {
      total.set(e, (total.get(e) ?? 0) + 1);
      if (now - s.at < WEEK) recent.set(e, (recent.get(e) ?? 0) + 1);
      else if (now - s.at < 2 * WEEK) before.set(e, (before.get(e) ?? 0) + 1);
    }
  }
  const rising = [...recent].map(([e, n]) => [e, n - (before.get(e) ?? 0), n] as const).filter((x) => x[2] >= 2).sort((a, b) => b[1] - a[1] || b[2] - a[2]).slice(0, 12);
  const most = [...total].sort((a, b) => b[1] - a[1]).slice(0, 18);
  const btn = (e: number, n: number, d?: number) => `<button type="button" class="chip" data-iv-q="${esc(entName(raw, e))}">${esc(entName(raw, e))} <small>${n}${d && d > 0 ? ` ▲${d}` : ''}</small></button>`;
  return `
    ${chart([{ label: T.stories(all.length), list: all, cls: 'iv-a' }], all[0]?.at ?? now, now)}
    <section class="iv-sec"><h2>${T.trending}</h2><div class="chips wrap">${rising.map(([e, d, n]) => btn(e, n, d)).join('')}</div></section>
    <section class="iv-sec"><h2>${T.most}</h2><div class="chips wrap">${most.map(([e, n]) => btn(e, n)).join('')}</div></section>`;
}

export async function initInvestigate() {
  const root = document.querySelector<HTMLElement>('[data-investigate]');
  if (!root) return;
  const out = root.querySelector<HTMLElement>('[data-iv-out]')!;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const q = form.querySelector<HTMLInputElement>('[name=q]')!;
  const vs = form.querySelector<HTMLInputElement>('[name=vs]')!;
  const { raw, stories } = await load().catch(() => ({ raw: null, stories: [] as Story[] }));
  if (!raw) return;
  const list = root.querySelector<HTMLDataListElement>('datalist');
  if (list) {
    const counts = new Map<number, number>();
    for (const s of stories) for (const e of s.ents) counts.set(e, (counts.get(e) ?? 0) + 1);
    const names = [...counts].filter((x) => x[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 400).map(([e]) => entName(raw, e));
    list.innerHTML = [...names, ...raw.t.map((_, i) => topicName(raw, i))].map((n) => `<option value="${esc(n)}"></option>`).join('');
  }
  const show = () => {
    const sub = resolve(raw, q.value);
    const other = resolve(raw, vs.value);
    const params = new URLSearchParams();
    if (q.value.trim()) params.set('q', q.value.trim());
    if (vs.value.trim()) params.set('vs', vs.value.trim());
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
    if (!sub) return void (out.innerHTML = overview(raw, stories));
    track('investigate');
    const mine = stories.filter((s) => matches(s, sub));
    out.innerHTML = report(raw, mine, sub, other ? { sub: other, list: stories.filter((s) => matches(s, other)) } : null, stories);
    document.title = `${sub.label}${other ? ` / ${other.label}` : ''} — ${document.title.split(' — ').at(-1)}`;
  };
  form.addEventListener('submit', (e) => (e.preventDefault(), show()));
  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-iv-q]');
    if (b) {
      q.value = b.dataset.ivQ ?? '';
      vs.value = '';
      show();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if ((e.target as Element).closest('[data-iv-clear]')) {
      q.value = vs.value = '';
      show();
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name !== 'iv-order') return;
    const ol = root.querySelector('[data-iv-list]');
    if (ol) ol.append(...[...ol.children].reverse());
  });
  const p = new URLSearchParams(location.search);
  q.value = p.get('q') ?? '';
  vs.value = p.get('vs') ?? '';
  show();
}

// ---------- the day archive ----------
export async function initArchive() {
  const root = document.querySelector<HTMLElement>('[data-archive]');
  if (!root) return;
  const { stories } = await load().catch(() => ({ stories: [] as Story[] }));
  if (!stories.length) return;
  const byDay = new Map<string, Story[]>();
  for (const s of stories) {
    const k = dayKey(s.at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(s);
  }
  // Months in the reader's calendar: Persian (Jalali) months on the Persian page, Gregorian on the English one.
  const monthFmt = new Intl.DateTimeFormat(EN ? 'en-US' : 'fa-IR-u-ca-persian', { timeZone: TZ, month: 'long', year: 'numeric' });
  const partFmt = new Intl.DateTimeFormat(EN ? 'en-US-u-ca-gregory-nu-latn' : 'fa-IR-u-ca-persian-nu-latn', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' });
  const parts = (ms: number) => {
    const o: Record<string, number> = {};
    for (const p of partFmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
    return o as { year: number; month: number; day: number };
  };
  const firstMs = stories[0].at, lastMs = stories.at(-1)!.at;
  const months: { key: string; label: string; days: { key: string; ms: number; d: number; wd: number }[] }[] = [];
  for (let ms = Date.parse(`${dayKey(firstMs)}T12:00:00+03:30`); ms <= lastMs + 864e5; ms += 864e5) {
    const p = parts(ms);
    const key = `${p.year}-${p.month}`;
    if (months.at(-1)?.key !== key) months.push({ key, label: monthFmt.format(new Date(ms)), days: [] });
    // Weeks start on Saturday on the Persian page, Sunday on the English one.
    const wd = (new Date(ms).getUTCDay() + (EN ? 0 : 1)) % 7;
    months.at(-1)!.days.push({ key: dayKey(ms), ms, d: p.day, wd });
  }
  const max = Math.max(...[...byDay.values()].map((l) => l.length));
  const grid = root.querySelector<HTMLElement>('[data-ar-grid]')!;
  const label = root.querySelector<HTMLElement>('[data-ar-month]')!;
  const out = root.querySelector<HTMLElement>('[data-ar-out]')!;
  const prev = root.querySelector<HTMLButtonElement>('[data-ar-prev]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-ar-next]')!;
  let m = months.length - 1;
  let picked = new URLSearchParams(location.search).get('d') ?? dayKey(lastMs);
  const at = months.findIndex((x) => x.days.some((d) => d.key === picked));
  if (at >= 0) m = at;
  const drawMonth = () => {
    const mo = months[m];
    label.textContent = mo.label;
    prev.disabled = m === 0;
    next.disabled = m === months.length - 1;
    const pad = mo.days[0].wd;
    grid.innerHTML =
      '<span class="ar-pad"></span>'.repeat(pad) +
      mo.days
        .map((d) => {
          const n = byDay.get(d.key)?.length ?? 0;
          const heat = n ? Math.ceil((n / max) * 4) : 0;
          return `<button type="button" class="ar-day h${heat}${d.key === picked ? ' is-picked' : ''}" data-ar-day="${d.key}" ${n ? '' : 'disabled'} aria-label="${fmtDay(d.ms)}: ${n}"><b>${EN ? d.d : d.d.toLocaleString('fa-IR')}</b>${n ? `<small>${EN ? n : n.toLocaleString('fa-IR')}</small>` : ''}</button>`;
        })
        .join('');
  };
  const drawDay = () => {
    const list = byDay.get(picked) ?? [];
    const ms = Date.parse(`${picked}T12:00:00+03:30`);
    const p = parts(ms);
    // The same day of the month in earlier months (the calendar's own day number).
    const earlier = months
      .slice(0, months.findIndex((x) => x.days.some((d) => d.key === picked)))
      .reverse()
      .map((mo) => mo.days.find((d) => d.d === p.day))
      .filter((d): d is NonNullable<typeof d> => !!d && !!byDay.get(d.key)?.length)
      .slice(0, 6);
    out.innerHTML = `
      <h2>${fmtDay(ms)} · ${T.day(list.length)}</h2>
      <ol class="iv-list">${[...list].reverse().map(row).join('') || `<li>${T.none}</li>`}</ol>
      ${earlier.length ? `<section class="iv-sec"><h2>${T.onThisDay}</h2>${earlier.map((d) => {
        const top = [...(byDay.get(d.key) ?? [])].sort((a, b) => b.imp - a.imp).slice(0, 3);
        return `<h3><button type="button" class="linkish" data-ar-day="${d.key}">${fmtDay(d.ms)}</button></h3><ol class="iv-list">${top.map(row).join('')}</ol>`;
      }).join('')}</section>` : ''}`;
    history.replaceState(null, '', `${location.pathname}?d=${picked}`);
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ar-day]');
    if (!b) return;
    picked = b.dataset.arDay!;
    m = months.findIndex((x) => x.days.some((d) => d.key === picked));
    drawMonth();
    drawDay();
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  prev.addEventListener('click', () => (m = Math.max(0, m - 1), drawMonth()));
  next.addEventListener('click', () => (m = Math.min(months.length - 1, m + 1), drawMonth()));
  drawMonth();
  drawDay();
}
