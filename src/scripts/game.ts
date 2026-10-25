// Gamification without signup: points, levels, badges and daily streaks live in this browser,
// plus "what's new since your last visit" — unread new stories stay marked until they are read.
import { SITE } from '../site';
import { $, $$, BASE, esc, fmtNum, getHistory, guest, hue, initial, myName, setMyName, store, toast, type Entry } from './core';
import { chooseStories, type StoryItem, type StorySet } from '../lib/time';

type Stats = {
  xp: number;
  reads: number;
  reactions: number;
  comments: number;
  chats: number;
  shares: number;
  saves: number;
  catchups: number;
  streak: number;
  best: number;
  lastDay: string;
  tags: string[];
  night: boolean;
  early: boolean;
  badges: string[];
};
const EMPTY: Stats = { xp: 0, reads: 0, reactions: 0, comments: 0, chats: 0, shares: 0, saves: 0, catchups: 0, streak: 0, best: 0, lastDay: '', tags: [], night: false, early: false, badges: [] };
const POINTS = { read: 5, react: 2, comment: 10, chat: 2, share: 5, save: 2, daily: 5, catchup: 15 } as const;
type Action = keyof typeof POINTS;
const COUNTER: Partial<Record<Action, keyof Stats>> = { read: 'reads', react: 'reactions', comment: 'comments', chat: 'chats', share: 'shares', save: 'saves', catchup: 'catchups' };

const LEVELS = [0, 25, 60, 120, 200, 320, 480, 700, 1000, 1400, 2000];
const TITLES = ['تازه‌وارد', 'کنجکاو', 'خواننده', 'پیگیر', 'خبرخوان', 'تحلیل‌گر', 'خبره', 'آینده‌نگر', 'نابغه', 'افسانه', 'اسطوره'];

export const BADGES: { id: string; emoji: string; name: string; desc: string; test: (s: Stats) => boolean }[] = [
  { id: 'first', emoji: '🌱', name: 'شروع', desc: 'اولین خبر را خواندید', test: (s) => s.reads >= 1 },
  { id: 'r10', emoji: '📰', name: 'خبرخوان', desc: '۱۰ خبر خواندید', test: (s) => s.reads >= 10 },
  { id: 'r50', emoji: '📚', name: 'کتاب‌خوار', desc: '۵۰ خبر خواندید', test: (s) => s.reads >= 50 },
  { id: 'r200', emoji: '🧠', name: 'دانای کل', desc: '۲۰۰ خبر خواندید', test: (s) => s.reads >= 200 },
  { id: 's3', emoji: '🔥', name: 'سه روز داغ', desc: '۳ روز پشت‌سرهم آمدید', test: (s) => s.best >= 3 },
  { id: 's7', emoji: '⚡', name: 'یک هفته کامل', desc: '۷ روز پشت‌سرهم آمدید', test: (s) => s.best >= 7 },
  { id: 's30', emoji: '🏆', name: 'وفادار', desc: '۳۰ روز پشت‌سرهم آمدید', test: (s) => s.best >= 30 },
  { id: 'react', emoji: '❤️', name: 'پرانرژی', desc: '۱۰ واکنش دادید', test: (s) => s.reactions >= 10 },
  { id: 'comment', emoji: '💬', name: 'اهل گفتگو', desc: 'اولین نظر را نوشتید', test: (s) => s.comments >= 1 },
  { id: 'chat', emoji: '👋', name: 'خوش‌صحبت', desc: 'در گفتگوی زنده پیام دادید', test: (s) => s.chats >= 1 },
  { id: 'share', emoji: '📣', name: 'سفیر', desc: 'خبری را با دیگران به اشتراک گذاشتید', test: (s) => s.shares >= 1 },
  { id: 'tags', emoji: '🧭', name: 'کاوشگر', desc: 'از ۵ موضوع مختلف خبر خواندید', test: (s) => s.tags.length >= 5 },
  { id: 'catchup', emoji: '✅', name: 'همیشه به‌روز', desc: 'همه‌ی خبرهای تازه را خواندید', test: (s) => s.catchups >= 1 },
  { id: 'night', emoji: '🦉', name: 'شب‌زنده‌دار', desc: 'بعد از نیمه‌شب خبر خواندید', test: (s) => s.night },
  { id: 'early', emoji: '🌅', name: 'سحرخیز', desc: 'پیش از ساعت ۷ صبح خبر خواندید', test: (s) => s.early },
];

const stats = (): Stats => ({ ...EMPTY, ...store.get<Partial<Stats>>('game', {}) });
const save = (s: Stats) => store.set('game', s);

export function level(xp: number) {
  let i = LEVELS.findIndex((t) => xp < t);
  if (i === -1) i = LEVELS.length;
  const lo = LEVELS[i - 1] ?? 0;
  const hi = LEVELS[i] ?? lo + 1000;
  return { n: i, title: TITLES[Math.min(i - 1, TITLES.length - 1)], progress: Math.min(1, (xp - lo) / (hi - lo)), toNext: hi - xp };
}

function burst() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div');
  el.className = 'burst';
  el.innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * 26}deg;--h:${(i * 47) % 360}"></i>`).join('');
  document.body.append(el);
  setTimeout(() => el.remove(), 1200);
}

/** Add points for an action. Only milestones speak up: level-ups and new badges, never each point. */
export function award(action: Action, extra?: { tags?: string[] }) {
  const s = stats();
  const before = level(s.xp).n;
  s.xp += POINTS[action];
  const counter = COUNTER[action];
  if (counter) (s[counter] as number) += 1;
  if (action === 'read') {
    for (const t of extra?.tags ?? []) if (t && !s.tags.includes(t)) s.tags.push(t);
    const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(new Date()));
    if (h < 4) s.night = true;
    if (h >= 4 && h < 7) s.early = true;
  }
  const fresh = BADGES.filter((b) => !s.badges.includes(b.id) && b.test(s));
  s.badges.push(...fresh.map((b) => b.id));
  save(s);
  const after = level(s.xp);
  if (fresh.length) {
    toast(`${fresh[0].emoji} نشان تازه: «${fresh[0].name}» — ${fresh[0].desc}`, 'reward');
    burst();
  } else if (after.n > before) {
    toast(`🎉 رسیدید به سطح ${fmtNum(after.n)}: ${after.title}`, 'reward');
    burst();
  }
  renderMe();
}

/** Once a day: keep the streak going and give the daily bonus. */
function checkIn() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
  const s = stats();
  if (s.lastDay === today) return;
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date(Date.now() - 864e5));
  s.streak = s.lastDay === yesterday ? s.streak + 1 : 1;
  s.best = Math.max(s.best, s.streak);
  const first = !s.lastDay;
  s.lastDay = today;
  save(s);
  if (first) return;
  setTimeout(() => {
    award('daily');
    if (s.streak > 1) toast(`🔥 ${fmtNum(s.streak)} روز پشت‌سرهم`, 'reward');
  }, 1500);
}

// ---------- the reader's identity in the UI ----------
export function renderMe() {
  const s = stats();
  const lv = level(s.xp);
  const name = myName() || 'مهمان';
  const color = hue(myName() || guest());
  $$('[data-my-avatar]').forEach((el) => {
    el.textContent = initial(myName() || '؟');
    el.style.setProperty('--h', String(color));
  });
  $$('[data-my-name]').forEach((el) => (el.textContent = name));
  $$('[data-my-level]').forEach((el) => (el.textContent = fmtNum(lv.n)));
  $$('[data-my-level-badge]').forEach((el) => (el.textContent = fmtNum(lv.n)));
  $$('[data-my-title]').forEach((el) => (el.textContent = lv.title));
  $$('[data-my-streak]').forEach((el) => (el.textContent = fmtNum(s.streak)));
  $$('[data-my-xp]').forEach((el) => (el.style.width = `${Math.round(lv.progress * 100)}%`));
  $$('[data-my-next]').forEach((el) => (el.textContent = `${fmtNum(s.xp)} امتیاز · ${fmtNum(lv.toNext)} امتیاز تا سطح بعد`));
}

export function renderProfile() {
  const s = stats();
  const grid = $('[data-my-stats]');
  if (grid) {
    const items: [string, number, string][] = [
      ['📰', s.reads, 'خبر خوانده'],
      ['🔥', s.best, 'بیشترین روز پشت‌سرهم'],
      ['❤️', s.reactions, 'واکنش'],
      ['💬', s.comments, 'نظر'],
      ['👋', s.chats, 'پیام گفتگو'],
      ['🧭', s.tags.length, 'موضوع'],
    ];
    grid.innerHTML = items.map(([e, n, l]) => `<div class="stat"><span>${e}</span><b>${fmtNum(n)}</b><small>${l}</small></div>`).join('');
  }
  const badges = $('[data-my-badges]');
  if (badges) {
    badges.innerHTML = BADGES.map((b) => {
      const on = s.badges.includes(b.id);
      return `<div class="badge-card${on ? ' on' : ''}" title="${esc(b.desc)}"><span>${on ? b.emoji : '🔒'}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`;
    }).join('');
  }
  const form = $<HTMLFormElement>('[data-name-form]');
  if (form) {
    const input = form.elements.namedItem('name') as HTMLInputElement;
    input.value = myName();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      setMyName(input.value);
      toast('نام شما ذخیره شد');
    });
  }
}
document.addEventListener('me-change', renderMe);

// ---------- reading ----------
/** Called on an article page: history, points (first read only) and clearing its "new" mark. */
export function recordRead(entry: Entry, tags: string[]) {
  const history = getHistory().filter((h) => h.id !== entry.id);
  const first = !store.get<number[]>('read', []).includes(entry.id);
  history.unshift({ ...entry, at: Date.now() });
  store.set('history', history.slice(0, 300));
  if (first) {
    store.set('read', [...store.get<number[]>('read', []), entry.id].slice(-3000));
    award('read', { tags });
  }
  clearNew(entry.id);
}

// ---------- seen in the player ----------
/** A story watched in the player leaves the "unread" story and loses its "new" mark; only opening it counts as a read. */
export function markSeen(id: number) {
  const seen = store.get<number[]>('seen', []);
  if (!seen.includes(id)) store.set('seen', [...seen, id].slice(-500));
  clearNew(id);
}
/** Not opened and not watched in the player. */
export function unreadTest() {
  const done = new Set([...store.get<number[]>('read', []), ...store.get<number[]>('seen', [])]);
  return (id: number) => !done.has(id);
}

// ---------- the four stories (home rail → /today/?s=…, sets defined in src/lib/time.ts) ----------
export { STORY_SETS, storySet, type StoryItem, type StorySet } from '../lib/time';
/** The stories a set plays for this reader, newest first, out of the recent ones the page carries. */
export const pickStories = <T extends StoryItem>(set: StorySet, items: T[], now = Date.now()) =>
  chooseStories(set, items, { now, unread: unreadTest(), pending: new Set(store.get<number[]>('pending', [])) });

// ---------- new since the last visit ----------
type Catchup = { total: number; done: number };

function clearNew(id: number) {
  const pending = store.get<number[]>('pending', []);
  if (!pending.includes(id)) return;
  store.set('pending', pending.filter((p) => p !== id));
  const c = store.get<Catchup>('catchup', { total: 0, done: 0 });
  if (c.total) {
    c.done = Math.min(c.total, c.done + 1);
    store.set('catchup', c);
    if (c.done === c.total) {
      store.set('catchup', { total: 0, done: 0 });
      setTimeout(() => award('catchup'), 600);
    }
  }
}

/** Marks unread new stories on the page and remembers what was seen. */
export function markNew() {
  const items = $$('[data-tl] .tl-item[data-id], .lead-main[data-id]');
  if (!items.length) return;
  const ids = items.map((el) => Number(el.dataset.id));
  const maxId = Math.max(...ids);
  const lastSeen = store.get<number>('lastSeen', 0);
  const read = new Set(store.get<number[]>('read', []));

  let pending = store.get<number[]>('pending', []);
  if (lastSeen) {
    const fresh = ids.filter((id) => id > lastSeen && !read.has(id) && !pending.includes(id));
    if (fresh.length) {
      const c = store.get<Catchup>('catchup', { total: 0, done: 0 });
      store.set('catchup', { total: c.total - c.done + fresh.length, done: 0 });
    }
    pending = [...new Set([...pending, ...fresh])].filter((id) => !read.has(id)).slice(-150);
    store.set('pending', pending);
  }

  for (const el of items) {
    const id = Number(el.dataset.id);
    const isNew = pending.includes(id);
    el.classList.toggle('is-new', isNew);
    el.classList.toggle('is-read', read.has(id));
    const head = $('.story-head', el);
    if (isNew && head && !$('.new-badge', head)) head.insertAdjacentHTML('afterbegin', '<span class="new-badge">تازه</span>');
    const seen = $('[data-seen]', el);
    if (seen) seen.hidden = !read.has(id);
  }

  // "You've seen everything below this line" divider on the timeline.
  if (lastSeen && !$('#new-divider')) {
    const firstOld = $$('[data-tl] .tl-item[data-id]').find((el) => Number(el.dataset.id) <= lastSeen);
    if (firstOld && firstOld !== $('[data-tl] .tl-item[data-id]')) {
      firstOld.insertAdjacentHTML('beforebegin', '<li class="new-divider" id="new-divider" role="separator"><span>تا اینجا تازه بود · از اینجا را قبلاً دیده‌اید</span></li>');
    }
  }

  // Tab title and home tab show how many new stories are waiting.
  const base = document.title.replace(/^\(\S+\)\s/, '');
  document.title = pending.length ? `(${fmtNum(pending.length)}) ${base}` : base;
  if (location.pathname.replace(/\/$/, '') === BASE) {
    if (maxId > lastSeen) setTimeout(() => store.set('lastSeen', Math.max(maxId, store.get<number>('lastSeen', 0))), 3000);
  }
}

checkIn();
renderMe();
