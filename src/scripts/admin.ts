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
};

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

  $('[data-adm-recent-empty]')!.hidden = d.recent.length > 0;
  $('[data-adm-recent]')!.innerHTML = d.recent.map((c) => commentRow(c, c.post, c.re ? '<span class="adm-flag soft">پاسخ</span>' : '', [btn('hide', 'پنهان کردن'), btn('delete', 'حذف', true)])).join('');
}

async function load() {
  const data = await api<Data>();
  $('[data-adm-login]')!.hidden = true;
  $('[data-adm]')!.hidden = false;
  $('[data-adm-tools]')!.hidden = false;
  render(data);
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
      toast(action === 'delete' ? 'حذف شد' : action === 'hide' ? 'پنهان شد' : action === 'unhide' ? 'دوباره نمایش داده می‌شود' : 'از فهرست گزارش‌ها برداشته شد');
      await load();
    } catch (err) {
      b.disabled = false;
      toast(why(err));
    }
  });
  token = read();
  if (token) load().catch((err) => signedOut((err as { status?: number }).status === 401 ? 'رمز ذخیره‌شده دیگر درست نیست.' : why(err)));
}
