// Notifications of new stories (api/push.js, handled by public/sw.js). The reader turns them on in the settings sheet,
// or from a card on the home page that only shows once they've come back a few times — never a permission prompt on
// arrival. Three kinds: every story, the topics they follow (src/scripts/follow.ts), or only the daily summary. The
// browser's subscription is the truth; `push` in storage remembers the kind. Hidden where the browser can't do it, or
// while the server has no keys (501). iPhones and iPads get notifications only from the site added to the home screen.
import { SITE } from '../site';
import { $, $$, BASE, guest, store, toast } from './core';
import { getFollows } from './follow';

type Mode = 'all' | 'topics' | 'daily';
type Saved = { mode: Mode } | null;
const ASK_KEY = 'notify-ask'; // when the home card was last dismissed
const ASK_AGAIN = 30 * 864e5;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && isSecureContext;
const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

let key: string | null = null;
const api = (body: unknown) =>
  fetch(`${SITE.api}/api/push/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

async function registration() {
  return (await navigator.serviceWorker.getRegistration(`${BASE}/`)) ?? navigator.serviceWorker.register(`${BASE}/sw.js`);
}
async function current(): Promise<PushSubscription | null> {
  try {
    return (await (await registration()).pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}
const saved = () => store.get<Saved>('push', null);

/** Tells the server what this reader wants now (kind and topics). */
async function sync(sub: PushSubscription, mode: Mode) {
  await api({ action: 'subscribe', guest: guest(), sub: sub.toJSON(), mode, topics: getFollows() });
  store.set('push', { mode });
}

/** From a tap: asks for permission (first, before anything else waits), subscribes, and saves the kind. */
async function enable(mode: Mode) {
  const asked = Notification.requestPermission();
  const permission = await asked;
  if (permission !== 'granted') {
    paint();
    return toast(permission === 'denied' ? 'اعلان‌ها در مرورگر بسته شده‌اند؛ از تنظیمات سایت در مرورگر بازشان کنید' : 'اعلان روشن نشد');
  }
  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key! }));
    await sync(sub, mode);
    toast(mode === 'daily' ? 'هر روز خلاصه‌ی خبرها را با اعلان می‌گیرید' : mode === 'topics' ? 'خبرهای موضوع‌هایی که دنبال می‌کنید را با اعلان می‌گیرید' : 'هر خبر تازه را با اعلان می‌گیرید', 'reward');
  } catch {
    toast('اعلان روشن نشد؛ کمی بعد دوباره امتحان کنید');
  }
  paint();
}

async function disable() {
  const sub = await current();
  store.set('push', null);
  if (sub) {
    api({ action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  toast('اعلان‌ها خاموش شد');
  paint();
}

// ---------- the settings section and the home card ----------
async function paint() {
  const box = $('[data-notify]');
  if (!box) return;
  const sub = await current();
  const on = !!sub && Notification.permission === 'granted';
  const mode = saved()?.mode ?? 'all';
  const toggle = $<HTMLButtonElement>('[data-notify-toggle]', box)!;
  toggle.setAttribute('aria-pressed', String(on));
  toggle.textContent = on ? 'خاموش کردن' : 'روشن کردن';
  toggle.classList.toggle('primary', !on);
  $('[data-notify-modes]', box)!.hidden = !on;
  const radio = $<HTMLInputElement>(`input[name="notify-mode"][value="${mode}"]`, box);
  if (radio) radio.checked = true;
  const note = $('[data-notify-note]', box)!;
  note.textContent =
    Notification.permission === 'denied'
      ? 'اعلان‌ها برای این سایت در مرورگر بسته شده‌اند. از تنظیمات سایت در مرورگر اجازه بدهید، بعد اینجا روشنشان کنید.'
      : on && mode === 'topics' && !getFollows().length
        ? 'هنوز موضوعی دنبال نمی‌کنید، پس اعلانی نمی‌رسد؛ از صفحه‌ی موضوع‌ها چند تا انتخاب کنید.'
        : on
          ? ''
          : 'خبر تازه که رسید، همان لحظه خبرتان می‌کنیم — حتی وقتی سایت باز نیست.';
  $('[data-notify-status]', box)!.textContent = on ? (mode === 'daily' ? 'فقط خلاصه‌ی روزانه' : mode === 'topics' ? 'فقط موضوع‌های من' : 'همه‌ی خبرهای تازه') : 'خاموش';
  if (on) $$('[data-notify-ask]').forEach((c) => (c.hidden = true));
}

/** The home card: after a few stories read, not when already on, refused, or dismissed lately. */
function maybeAsk() {
  const card = $('[data-notify-ask]');
  if (!card || Notification.permission !== 'default') return;
  const reads = store.get<{ reads?: number }>('game', {}).reads ?? 0;
  if (reads < 3 || Date.now() - store.get<number>(ASK_KEY, 0) < ASK_AGAIN) return;
  current().then((sub) => {
    if (sub) return;
    card.hidden = false;
    $('[data-notify-yes]', card)!.addEventListener('click', () => {
      card.hidden = true;
      enable('all');
    });
    $('[data-notify-no]', card)!.addEventListener('click', () => {
      card.hidden = true;
      store.set(ASK_KEY, Date.now());
    });
  });
}

let resync: number | undefined;
export async function initNotify() {
  const box = $('[data-notify]');
  if (!supported()) {
    // iPhone in Safari: notifications come once the site is on the home screen.
    if (box && ios() && !standalone()) {
      box.hidden = false;
      $('[data-notify-toggle]', box)!.hidden = true;
      $('[data-notify-note]', box)!.textContent = 'در آیفون و آیپد، اول سایت را با «Share ← Add to Home Screen» به صفحه‌ی اصلی اضافه کنید و از همان‌جا باز کنید؛ بعد اینجا اعلان را روشن کنید.';
    }
    return;
  }
  try {
    const res = await fetch(`${SITE.api}/api/push/`);
    if (!res.ok) return; // the server has no keys: no notifications to offer
    key = (await res.json()).key;
  } catch {
    return;
  }
  if (box) {
    box.hidden = false;
    // Decided from what is painted, without waiting: Safari only asks for permission straight from the tap.
    $('[data-notify-toggle]', box)!.addEventListener('click', (e) => {
      if ((e.currentTarget as HTMLElement).getAttribute('aria-pressed') === 'true') return void disable();
      const mode = ($<HTMLInputElement>('input[name="notify-mode"]:checked', box)?.value as Mode) || 'all';
      enable(mode);
    });
    $('[data-notify-modes]', box)!.addEventListener('change', async (e) => {
      const mode = (e.target as HTMLInputElement).value as Mode;
      const sub = await current();
      if (!sub) return;
      try {
        await sync(sub, mode);
        toast('تنظیم اعلان‌ها ذخیره شد');
      } catch {
        toast('ذخیره نشد؛ دوباره امتحان کنید');
      }
      paint();
    });
  }
  // Followed topics changed: the server needs them for «فقط موضوع‌های من».
  document.addEventListener('follows-change', () => {
    clearTimeout(resync);
    resync = window.setTimeout(async () => {
      const sub = await current();
      const s = saved();
      if (sub && s) sync(sub, s.mode).catch(() => {});
      paint();
    }, 1500);
  });
  $$('[data-open-settings]').forEach((b) => b.addEventListener('click', paint));
  paint();
  maybeAsk();
}
