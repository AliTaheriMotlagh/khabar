// The owner's page (src/pages/admin): signs in with ADMIN_TOKEN (kept for this tab, or on this device if asked), shows
// /api/admin, and moderates comments — hide, show again, dismiss the reports, delete.
import { SITE } from '../site';
import { $, BASE, compact, esc, fmtNum, relTime, toast } from './core';

type Comment = { id: string; name: string; text: string; at: string; quote?: string; re?: string };
type Data = {
  totals: Record<'visits' | 'online' | 'subscribers' | 'reported', number>;
  hours: { today: number[]; yesterday: number[] };
  sources: { source: string; visits: number }[];
  reports: { post: number; id: string; reports: number; hidden: boolean; comment: Comment | null }[];
  recent: (Comment & { post: number })[];
  crawl?: { token: 'ok' | 'missing' | 'unauthorized' | 'error'; status?: number; expires?: string | null; lastSuccess?: string | null; failing?: number; lastFailure?: string | null };
  readers?: { day: string; readers: number }[];
  events?: { days: number; counts: Record<string, number>; today: Record<string, number> };
  tts?: { free: number; month: string; chars: number; clips: number; last: { month: string; chars: number } };
  push?: { modes: Record<string, number>; sent7: number };
  top?: { today: { id: number; views: number }[]; week: { id: number; views: number }[] } | null;
  engagement?: { comments: number; reactions: { reaction: string; count: number }[]; mostCommented: { id: number; count: number }[]; mostReacted: { id: number; count: number }[] };
  flags?: { post: number; id: string; why: string; at: string; comment: Comment | null }[];
};
type Content = {
  stories: number; titled: number; failed: number; models: Record<string, number>; types: Record<string, number>;
  has?: Record<string, number>; posts?: number; listed?: number; newest?: { id: number; date: string } | null;
  days?: { day: string; listed: number; hidden: number }[]; hidden?: { id: number; date: string; why: string; title: string }[];
  videos?: number; videoSummaries?: number; glossary?: number; entities?: number;
  numbers?: { id: number; title: string; numbers: string[] }[];
};

const EVENT_NAMES: Record<string, string> = {
  listen: 'گوش دادن به یک خبر', playlist: 'پادکست امروز', 'week-listen': 'گوش دادن به پربازدیدهای هفته', today: 'باز کردن استوری‌ها',
  share: 'اشتراک‌گذاری', save: 'ذخیره', 'video-made-v': 'ساخت ویدیو (عمودی)', 'video-made-h': 'ساخت ویدیو (افقی)', 'video-made-s': 'ساخت ویدیو (مربع)',
  'video-shared': 'فرستادن ویدیو', brief60: '«۶۰ ثانیه خبر امروز»', 'quiz-right': 'پاسخ درست به پرسش', 'quiz-wrong': 'پاسخ نادرست به پرسش',
  'push-on': 'روشن کردن اعلان', install: 'نصب اپ', term: 'باز کردن توضیح یک اصطلاح', simple: 'باز کردن «به زبان ساده»',
};
const MODES: Record<string, string> = { all: 'همه‌ی خبرها', topics: 'موضوع‌های دنبال‌شده', daily: 'فقط خلاصه‌ی روزانه' };
const REACT: Record<string, string> = { like: '👍', love: '❤️', fire: '🔥', wow: '😮', haha: '😂', sad: '😢' };
const HAS: Record<string, string> = {
  extras: 'تحلیل کامل (اهمیت، نام‌ها، اصطلاح‌ها…)', importance: 'درجه‌ی اهمیت', entities: 'نام آدم‌ها و شرکت‌ها', terms: 'اصطلاح‌های توضیح‌داده‌شده',
  simple: '«به زبان ساده»', quiz: 'پرسش', video: 'متن ویدیوی کوتاه', translated: 'ترجمه‌ی خودکار (بدون غلام)', related: 'خبرهای مرتبط با معنا',
  status: 'رسمی / گزارش / شایعه', models: 'مدل‌ها و امتیازها', events: 'رویداد تاریخ‌دار', thread: 'در یک پرونده (ماجرا)',
};

/** A story's title for a list, from its small card.json (cached by the browser); the id when it can't be read. */
const titles = new Map<number, string>();
async function titleOf(id: number): Promise<string> {
  if (titles.has(id)) return titles.get(id)!;
  const t = await fetch(`${BASE}/p/${id}/card.json`).then((r) => (r.ok ? r.json() : null)).then((c) => c?.title as string | undefined, () => undefined);
  titles.set(id, t ?? `خبر ${fmtNum(id)}`);
  return titles.get(id)!;
}
async function topList(el: HTMLElement | null, rows: { id: number; n: number }[], unit: string) {
  if (!el) return;
  if (!rows.length) return void (el.innerHTML = '<li class="muted">هنوز چیزی نیست.</li>');
  const names = await Promise.all(rows.map((r) => titleOf(r.id)));
  el.innerHTML = rows.map((r, i) => `<li><a href="${BASE}/p/${r.id}/">${esc(names[i])}</a><b>${fmtNum(r.n)} ${unit}</b></li>`).join('');
}
/** Bars, one per day, the last one marked (the same look as /stats/). */
function dayBars(el: HTMLElement | null, rows: { label: string; n: number; extra?: number }[], unit: string) {
  if (!el) return;
  const max = Math.max(1, ...rows.map((r) => r.n + (r.extra ?? 0)));
  el.innerHTML = rows
    .map((r, i) => {
      const label = `${r.label}: ${fmtNum(r.n)} ${unit}${r.extra ? ` (+${fmtNum(r.extra)} پنهان)` : ''}`;
      return `<div class="st-col${i === rows.length - 1 ? ' today' : ''}" tabindex="0" role="img" aria-label="${esc(label)}">
        <span class="st-tip" aria-hidden="true">${esc(label)}</span>
        <span class="st-val" aria-hidden="true">${i === rows.length - 1 || r.n === max ? compact(r.n) : ''}</span>
        <span class="st-bar" style="height:${Math.max(r.n ? 2 : 0, (r.n / max) * 100)}%" aria-hidden="true"></span>
        <span class="st-day" aria-hidden="true">${i % Math.ceil(rows.length / 8) === 0 || i === rows.length - 1 ? esc(r.label) : ''}</span>
      </div>`;
    })
    .join('');
}
const dayLabel = (d: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const rowsHtml = (list: [string, number, string?][]) => {
  const top = Math.max(1, ...list.map(([, n]) => n));
  return list.map(([name, n, note]) => `<li><span>${esc(name)}${note ? ` <small class="muted">${esc(note)}</small>` : ''}</span><b>${fmtNum(n)}</b><i style="width:${(n / top) * 100}%"></i></li>`).join('');
};

function renderMore(d: Data) {
  dayBars($('[data-adm-days]'), (d.readers ?? []).map((r) => ({ label: dayLabel(r.day), n: r.readers })), 'خواننده');
  void topList($('[data-adm-top="today"]'), (d.top?.today ?? []).map((r) => ({ id: r.id, n: r.views })), 'بازدید');
  void topList($('[data-adm-top="week"]'), (d.top?.week ?? []).map((r) => ({ id: r.id, n: r.views })), 'بازدید');

  const ev = Object.entries(d.events?.counts ?? {}).sort((a, b) => b[1] - a[1]);
  $('[data-adm-events-empty]')!.hidden = ev.length > 0;
  $('[data-adm-events]')!.innerHTML = rowsHtml(ev.map(([k, n]) => [EVENT_NAMES[k] ?? k, n, d.events?.today[k] ? `امروز ${fmtNum(d.events.today[k])}` : undefined]));

  const t = d.tts;
  const box = $('[data-adm-tts]')!;
  if (t) {
    // The month so far, and where it ends at this pace (Azure F0 stops at the quota; S0 would bill).
    const now = new Date();
    const dayOf = now.getUTCDate();
    const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const pace = Math.round((t.chars / Math.max(1, dayOf)) * days);
    const share = Math.min(100, (t.chars / t.free) * 100);
    box.classList.toggle('bad', pace > t.free * 0.9);
    box.innerHTML = `<div class="adm-meter-head"><span>صدای ابری (Azure): ${fmtNum(t.chars)} از ${compact(t.free)} نویسه‌ی رایگان این ماه · ${fmtNum(t.clips)} تکه</span><b>${fmtNum(Math.round(share))}٪</b></div>
      <span class="adm-bar"><i style="width:${share}%"></i><i class="pace" style="width:${Math.min(100, (pace / t.free) * 100)}%"></i></span>
      <small class="muted">با این روند تا آخر ماه حدود ${compact(pace)} نویسه${pace > t.free ? ' — بیش از سهمیه‌ی رایگان!' : ''} · ماه پیش ${compact(t.last.chars)}</small>`;
  } else box.innerHTML = '';
  const modes = Object.entries(d.push?.modes ?? {});
  $('[data-adm-push]')!.innerHTML = d.push
    ? `اعلان‌ها: ${modes.length ? modes.map(([m, n]) => `${esc(MODES[m] ?? m)} <b>${fmtNum(n)}</b>`).join('، ') : 'هنوز مشترکی نیست'} · ${fmtNum(d.push.sent7)} خبر در ۷ روز اعلان شد`
    : '';

  const e = d.engagement;
  if (e) {
    $('[data-adm-engage]')!.innerHTML = `کل نظرها <b>${fmtNum(e.comments)}</b> · واکنش‌ها: ${e.reactions.map((r) => `${REACT[r.reaction] ?? r.reaction} ${fmtNum(r.count)}`).join('  ')}`;
    void topList($('[data-adm-most="comments"]'), e.mostCommented.map((r) => ({ id: r.id, n: r.count })), 'نظر');
    void topList($('[data-adm-most="reactions"]'), e.mostReacted.map((r) => ({ id: r.id, n: r.count })), 'واکنش');
  }

  const flags = d.flags ?? [];
  $('[data-adm-flags-box]')!.hidden = !flags.length;
  $('[data-adm-flags]')!.innerHTML = flags
    .map((f) => (f.comment ? commentRow(f.comment, f.post, `<span class="adm-flag">${esc(f.why)}</span>`, [btn('hide', 'پنهان کردن'), btn('unflag', 'مشکلی ندارد'), btn('delete', 'حذف', true)]) : ''))
    .join('');
}

function renderContent(a: Content) {
  dayBars($('[data-adm-posts]'), (a.days ?? []).map((r) => ({ label: dayLabel(r.day), n: r.listed, extra: r.hidden })), 'خبر');
  const rows: [string, number, string?][] = [
    ['خبرها با تیتر هوش مصنوعی', a.titled, `از ${fmtNum(a.stories)}${a.failed ? ` · ${fmtNum(a.failed)} ناموفق` : ''}`],
    ...Object.entries(a.has ?? {}).map(([k, n]): [string, number] => [HAS[k] ?? k, n]),
    ['اصطلاح‌های واژه‌نامه', a.glossary ?? 0],
    ['آدم‌ها و شرکت‌ها', a.entities ?? 0],
    ['ویدیوهای مهرزاد', a.videos ?? 0, a.videoSummaries ? `${fmtNum(a.videoSummaries)} با خلاصه‌ی کامل` : undefined],
  ];
  $('[data-adm-content]')!.innerHTML = rowsHtml(rows);
  const hidden = a.hidden ?? [];
  $('[data-adm-hidden-box]')!.hidden = !hidden.length;
  $('[data-adm-hidden]')!.innerHTML = hidden.map((h) => `<li><a href="${BASE}/p/${h.id}/">${fmtNum(h.id)}</a> · ${esc(h.why)} · <span dir="auto">${esc(h.title)}</span></li>`).join('');
  const nums = a.numbers ?? [];
  $('[data-adm-numbers-box]')!.hidden = !nums.length;
  $('[data-adm-numbers]')!.innerHTML = nums
    .map((c) => `<li><a href="${BASE}/p/${c.id}/">${fmtNum(c.id)}</a> · <b dir="ltr">${c.numbers.map((n) => esc(n)).join('، ')}</b> · <span dir="auto">${esc(c.title)}</span></li>`)
    .join('');
}

const DAY = 864e5;
/** The crawl's health in one line, red when the owner has something to do. */
function health(c: Data['crawl']): { bad: boolean; html: string } | null {
  if (!c) return null;
  const left = c.expires ? Math.floor((Date.parse(c.expires) - Date.now()) / DAY) : null;
  const expiry = left === null ? '' : left < 0 ? ' · توکن گیت‌هاب منقضی شده' : ` · توکن گیت‌هاب ${fmtNum(left)} روز دیگر منقضی می‌شود`;
  if (c.token === 'missing') return { bad: true, html: 'GITHUB_DISPATCH_TOKEN روی Vercel نیست: خبرها فقط با زمان‌بندی گیت‌هاب (هر چند ساعت) می‌رسند.' };
  if (c.token === 'unauthorized') return { bad: true, html: `گیت‌هاب توکن را نپذیرفت (${fmtNum(c.status ?? 0)})${expiry}: GITHUB_DISPATCH_TOKEN را در گیت‌هاب تازه کنید و روی Vercel بگذارید.` };
  if (c.token === 'error') return { bad: true, html: `گیت‌هاب جواب نداد (${fmtNum(c.status ?? 0)}).` };
  const failing = c.failing ?? 0;
  const runs = failing >= 2 ? ` · <a href="${esc(c.lastFailure ?? '')}" target="_blank" rel="noopener">${fmtNum(failing)} اجرای پشت‌سرهم ناموفق</a>` : '';
  const last = c.lastSuccess ? `آخرین به‌روزرسانی موفق: ${esc(relTime(c.lastSuccess))}` : 'هنوز اجرای موفقی نیست';
  return { bad: failing >= 2 || (left !== null && left < 14), html: last + runs + expiry };
}

const KEY = 'khabar:admin';
const SOURCES: Record<string, string> = { telegram: 'تلگرام', google: 'گوگل', x: 'X (توییتر)', instagram: 'اینستاگرام', search: 'موتورهای جستجو', rss: 'خبرخوان', direct: 'مستقیم (بدون ارجاع)', other: 'سایر' };

let token = '';
const read = () => {
  try {
    return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
};
function keep(t: string, remember: boolean) {
  try {
    sessionStorage.setItem(KEY, t);
    if (remember) localStorage.setItem(KEY, t);
  } catch {}
}
function forget() {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch {}
}

async function api<T>(init?: { method: string; body: unknown }): Promise<T> {
  const res = await fetch(`${SITE.api}/api/admin/`, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init && { 'Content-Type': 'application/json' }) },
    body: init ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
  return res.json();
}

const postLink = (post: number) => `${BASE}/p/${post}/#comments`;
function commentRow(c: Comment, post: number, extra: string, actions: string[]) {
  return `<li class="adm-c" data-post="${post}" data-cid="${esc(c.id)}">
    <div class="adm-c-head"><b>${esc(c.name)}</b><time datetime="${esc(c.at)}">${esc(relTime(c.at))}</time>${extra}<a href="${postLink(post)}">خبر ${fmtNum(post)}</a></div>
    ${c.quote ? `<blockquote dir="auto">${esc(c.quote)}</blockquote>` : ''}
    <p dir="auto">${esc(c.text)}</p>
    <div class="adm-c-actions">${actions.join('')}</div>
  </li>`;
}
const btn = (action: string, label: string, danger = false) => `<button class="btn sm${danger ? ' danger' : ''}" type="button" data-adm-act="${action}">${label}</button>`;

function render(d: Data) {
  for (const [k, v] of Object.entries(d.totals)) $(`[data-adm-t="${k}"]`)!.textContent = compact(v);
  const h = health(d.crawl);
  const box = $('[data-adm-health]')!;
  box.hidden = !h;
  box.classList.toggle('bad', !!h?.bad);
  box.innerHTML = h?.html ?? '';

  // New visits by hour: one series, today's bars, the busiest hour and the current one labelled.
  const now = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const max = Math.max(1, ...d.hours.today);
  const best = d.hours.today.indexOf(Math.max(...d.hours.today));
  $('[data-adm-hours]')!.innerHTML = d.hours.today
    .map((n, h) => {
      const label = `ساعت ${fmtNum(h)} تا ${fmtNum(h + 1)}: ${fmtNum(n)} بازدید تازه`;
      return `<div class="st-col${h === now ? ' today' : ''}${h > now ? ' later' : ''}" tabindex="0" role="img" aria-label="${esc(label)}">
        <span class="st-tip" aria-hidden="true">${esc(label)}</span>
        <span class="st-val" aria-hidden="true">${(h === best && n) || h === now ? compact(n) : ''}</span>
        <span class="st-bar" style="height:${Math.max(n ? 2 : 0, (n / max) * 100)}%" aria-hidden="true"></span>
        <span class="st-day" aria-hidden="true">${h % 3 === 0 ? fmtNum(h) : ''}</span>
      </div>`;
    })
    .join('');
  $('[data-adm-hours-table]')!.innerHTML = d.hours.today.map((n, h) => `<tr><td>${fmtNum(h)}</td><td>${fmtNum(n)}</td><td>${fmtNum(d.hours.yesterday[h])}</td></tr>`).join('');

  const top = Math.max(1, ...d.sources.map((s) => s.visits));
  $('[data-adm-sources-empty]')!.hidden = d.sources.length > 0;
  $('[data-adm-sources]')!.innerHTML = d.sources
    .map((s) => `<li><span>${esc(SOURCES[s.source] ?? s.source)}</span><b>${fmtNum(s.visits)}</b><i style="width:${(s.visits / top) * 100}%"></i></li>`)
    .join('');

  $('[data-adm-reports-empty]')!.hidden = d.reports.length > 0;
  $('[data-adm-reports]')!.innerHTML = d.reports
    .map((r) =>
      r.comment
        ? commentRow(r.comment, r.post, `<span class="adm-flag">${fmtNum(r.reports)} گزارش${r.hidden ? ' · پنهان' : ''}</span>`, [
            r.hidden ? btn('unhide', 'نمایش دوباره') : btn('hide', 'پنهان کردن'),
            btn('dismiss', 'گزارش‌ها مهم نیست'),
            btn('delete', 'حذف', true),
          ])
        : `<li class="adm-c" data-post="${r.post}" data-cid="${esc(r.id)}"><p class="muted">این نظر دیگر نیست.</p><div class="adm-c-actions">${btn('dismiss', 'پاک کردن از فهرست')}</div></li>`,
    )
    .join('');

  renderMore(d);
  $('[data-adm-recent-empty]')!.hidden = d.recent.length > 0;
  $('[data-adm-recent]')!.innerHTML = d.recent.map((c) => commentRow(c, c.post, c.re ? '<span class="adm-flag soft">پاسخ</span>' : '', [btn('hide', 'پنهان کردن'), btn('delete', 'حذف', true)])).join('');
}

/** The AI headlines of this build (/ai.json, pipeline/ai.py): how many stories have one, the model, what failed. */
async function aiLine() {
  const box = $('[data-adm-ai]');
  if (!box) return;
  try {
    const a = (await (await fetch(`${BASE}/ai.json`, { cache: 'no-store' })).json()) as Content;
    const models = Object.entries(a.models).map(([m, n]) => `${esc(m)}: ${fmtNum(n)}`).join('، ');
    const newest = a.newest ? ` · تازه‌ترین خبر این نسخه: <a href="${BASE}/p/${a.newest.id}/">${fmtNum(a.newest.id)}</a> (${esc(relTime(a.newest.date))})` : '';
    box.innerHTML = `تیتر هوش مصنوعی: <b>${fmtNum(a.titled)}</b> از ${fmtNum(a.stories)} خبر${a.failed ? ` · ${fmtNum(a.failed)} ناموفق (تیتر قاعده‌ای)` : ''}${models ? ` · ${models}` : ''}${newest}`;
    box.hidden = false;
    renderContent(a);
  } catch {
    box.hidden = true;
  }
}

async function load() {
  const data = await api<Data>();
  $('[data-adm-login]')!.hidden = true;
  $('[data-adm]')!.hidden = false;
  $('[data-adm-tools]')!.hidden = false;
  render(data);
  void aiLine();
}

function signedOut(msg = '') {
  token = '';
  $('[data-adm-login]')!.hidden = false;
  $('[data-adm]')!.hidden = true;
  $('[data-adm-tools]')!.hidden = true;
  $('[data-adm-msg]')!.textContent = msg;
}

const why = (e: unknown) => {
  const s = (e as { status?: number }).status;
  return s === 401 ? 'رمز درست نیست.' : s === 429 ? 'تلاش‌های ناموفق زیاد بود؛ یک ساعت دیگر امتحان کنید.' : s === 501 ? 'ADMIN_TOKEN روی سرور تنظیم نشده.' : 'اتصال برقرار نشد؛ دوباره امتحان کنید.';
};

export async function initAdmin() {
  const form = $<HTMLFormElement>('[data-adm-login]')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    token = String(data.get('token') ?? '').trim();
    try {
      await load();
      keep(token, data.get('remember') === 'on');
      form.reset();
    } catch (err) {
      signedOut(why(err));
    }
  });
  $('[data-adm-logout]')!.addEventListener('click', () => (forget(), signedOut()));
  $('[data-adm-refresh]')!.addEventListener('click', () => load().catch((err) => toast(why(err))));
  document.addEventListener('click', async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-adm-act]');
    if (!b) return;
    const li = b.closest<HTMLElement>('[data-cid]')!;
    const action = b.dataset.admAct!;
    if (action === 'delete' && !confirm('این نظر برای همیشه حذف شود؟')) return;
    b.disabled = true;
    try {
      await api({ method: 'POST', body: { action, post: Number(li.dataset.post), id: li.dataset.cid } });
      toast(action === 'delete' ? 'حذف شد' : action === 'hide' ? 'پنهان شد' : action === 'unhide' ? 'دوباره نمایش داده می‌شود' : action === 'unflag' ? 'از فهرست بررسی خودکار برداشته شد' : 'از فهرست گزارش‌ها برداشته شد');
      await load();
    } catch (err) {
      b.disabled = false;
      toast(why(err));
    }
  });
  token = read();
  if (token) load().catch((err) => signedOut((err as { status?: number }).status === 401 ? 'رمز ذخیره‌شده دیگر درست نیست.' : why(err)));
}
