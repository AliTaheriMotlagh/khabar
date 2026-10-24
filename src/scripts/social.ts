// Guest features backed by the /api functions: reactions, comments, live presence & visits, chat, leaderboard.
// If the API is missing or unreachable, these parts stay hidden and the rest of the site works as usual.
import { SITE } from '../site';
import { REACTIONS } from '../lib/reactions';
import { $, $$, compact, esc, fmtNum, guest, hue, initial, myName, relTime, setMyName, store, toast } from './core';
import { award } from './game';

let available = true;
async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!available) throw new Error('offline');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${SITE.api}/api/${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 503 || res.status === 404) available = false;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}
const slowDown = (e: unknown) => (e as { status?: number }).status === 429;

// ---------- live presence & visits ----------
type Live = { online: number; chat: string | null; today?: number; total?: number; views?: number };
const articleId = () => Number($('[data-article]')?.dataset.id) || undefined;

function showLive(d: Live) {
  $$('[data-online]').forEach((el) => (el.textContent = fmtNum(d.online)));
  $$('[data-online-pill], [data-live-card]').forEach((el) => (el.hidden = false));
  if (d.today != null) $$('[data-today]').forEach((el) => (el.textContent = compact(d.today!)));
  if (d.total != null) $$('[data-total]').forEach((el) => (el.textContent = compact(d.total!)));
  if (d.total != null) $$('[data-site-stats]').forEach((el) => (el.hidden = false));
  const id = articleId();
  if (id && d.views) setViews(id, d.views);
  const seenChat = store.get<string | null>('chatSeen', null);
  $$('[data-chat-dot]').forEach((el) => (el.hidden = !d.chat || d.chat === seenChat || chatOpen()));
}

function setViews(id: number, n: number) {
  $$(`[data-views="${id}"]`).forEach((el) => {
    const span = $('span', el);
    if (span) span.textContent = compact(n);
    el.hidden = false;
  });
}

async function beat(view = false) {
  try {
    showLive(await api<Live>('live', { method: 'POST', body: { guest: guest(), post: articleId(), view, name: myName() || undefined } }));
  } catch {}
}
let beatTimer: number | undefined;
function startBeats() {
  clearInterval(beatTimer);
  beatTimer = window.setInterval(() => document.visibilityState === 'visible' && beat(), 75_000);
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && available && beat());

// ---------- reactions, comment counts, view counts (one request per page) ----------
type Engage = Record<string, { r: Record<string, number>; c: number; v: number }>;
const counts: Record<string, Record<string, number>> = {};
const mine = () => store.get<Record<string, string[]>>('reacted', {});

function paintReactions(id: string) {
  const c = counts[id] ?? {};
  const my = mine()[id] ?? [];
  $$(`[data-reactions="${id}"]`).forEach((box) => {
    $$<HTMLButtonElement>('[data-react]', box).forEach((b) => {
      const k = b.dataset.react!;
      b.setAttribute('aria-pressed', String(my.includes(k)));
      const n = $('[data-count]', b);
      if (n) n.textContent = c[k] ? compact(c[k]) : '';
    });
    if (box.classList.contains('mini')) {
      const top = REACTIONS.filter((r) => c[r.key]).sort((a, b) => c[b.key] - c[a.key]).slice(0, 3);
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      $('[data-react-sum]', box)!.innerHTML = top.length ? top.map((r) => `<span>${r.emoji}</span>`).join('') : '<span class="react-add">🙂</span>';
      $('[data-react-total]', box)!.textContent = total ? compact(total) : '';
      box.classList.toggle('mine', my.length > 0);
    }
  });
}

export async function loadEngage(root: ParentNode = document) {
  const ids = [...new Set($$('[data-reactions], [data-ccount], [data-views]', root).map((el) => el.dataset.reactions || el.dataset.ccount || el.dataset.views))]
    .filter(Boolean) as string[];
  if (!ids.length) return;
  ids.forEach(paintReactions);
  try {
    const data = await api<Engage>(`engage?ids=${ids.join(',')}`);
    for (const id of ids) {
      const d = data[id];
      counts[id] = d?.r ?? {};
      paintReactions(id);
      $$(`[data-ccount="${id}"]`).forEach((el) => (el.textContent = d?.c ? fmtNum(d.c) : ''));
      if (d?.v) setViews(Number(id), d.v);
    }
  } catch {}
}

async function react(btn: HTMLButtonElement) {
  const box = btn.closest<HTMLElement>('[data-reactions]')!;
  const id = box.dataset.reactions!;
  const key = btn.dataset.react!;
  const all = mine();
  const list = all[id] ?? [];
  const on = !list.includes(key);
  all[id] = on ? [...list, key] : list.filter((k) => k !== key);
  store.set('reacted', all);
  counts[id] = { ...(counts[id] ?? {}), [key]: Math.max(0, (counts[id]?.[key] ?? 0) + (on ? 1 : -1)) };
  paintReactions(id);
  if (on) {
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
    award('react');
  }
  box.querySelector('[data-react-toggle]')?.setAttribute('aria-expanded', 'false');
  box.classList.remove('open');
  try {
    const { count } = await api<{ count: number }>('react', { method: 'POST', body: { post: id, guest: guest(), reaction: key, on } });
    counts[id][key] = count;
    paintReactions(id);
  } catch (e) {
    if (slowDown(e)) toast('کمی آهسته‌تر 🙂');
  }
}

// ---------- comments ----------
type Comment = { id: string; name: string; text: string; at: string };
const myComments = () => store.get<string[]>('myComments', []);

function avatarHtml(name: string) {
  return `<span class="avatar" style="--h:${hue(name)}" aria-hidden="true">${esc(initial(name))}</span>`;
}
function commentHtml(c: Comment) {
  const mineC = myComments().includes(c.id);
  return `<li class="comment${mineC ? ' mine' : ''}" data-cid="${esc(c.id)}">
    ${avatarHtml(c.name)}
    <div class="c-body">
      <div class="c-head"><b>${esc(c.name)}</b><time datetime="${esc(c.at)}">${esc(relTime(c.at))}</time>
        ${mineC ? '<button class="c-del" type="button" data-del-comment aria-label="حذف نظر من">حذف</button>' : ''}</div>
      <p dir="auto">${esc(c.text)}</p>
    </div>
  </li>`;
}

function initComments() {
  const box = $('[data-comments]');
  if (!box) return;
  const post = box.dataset.comments!;
  const list = $('[data-comment-list]', box)!;
  const empty = $('[data-comments-empty]', box)!;
  const off = $('[data-comments-off]', box)!;
  const form = $<HTMLFormElement>('[data-comment-form]', box)!;
  const count = $('[data-comments-count]', box)!;
  const nameInput = form.elements.namedItem('name') as HTMLInputElement;
  nameInput.value = myName();
  let items: Comment[] = [];

  const render = () => {
    list.innerHTML = items.map(commentHtml).join('');
    empty.hidden = items.length > 0;
    count.textContent = items.length ? fmtNum(items.length) : '';
  };
  const load = async () => {
    try {
      items = (await api<{ comments: Comment[] }>(`comments?post=${post}`)).comments;
      render();
    } catch {
      off.hidden = false;
      form.hidden = true;
    }
  };
  // Load when the reader gets near the comments (saves a request for quick readers).
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      load();
    }
  }, { rootMargin: '600px' }).observe(box);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const btn = $<HTMLButtonElement>('button[type=submit]', form)!;
    btn.disabled = true;
    try {
      if (nameInput.value.trim() !== myName()) setMyName(nameInput.value);
      const { comment } = await api<{ comment: Comment | null }>('comments', {
        method: 'POST',
        body: { post, guest: guest(), name: myName(), text: data.get('text'), website: data.get('website') },
      });
      if (comment) {
        store.set('myComments', [...myComments(), comment.id].slice(-500));
        items.unshift(comment);
        render();
        award('comment');
      }
      form.reset();
      nameInput.value = myName();
    } catch (err) {
      toast(slowDown(err) ? 'چند لحظه صبر کنید و دوباره بفرستید' : 'نظر ارسال نشد؛ دوباره امتحان کنید');
    } finally {
      btn.disabled = false;
    }
  });

  list.addEventListener('click', async (e) => {
    const del = (e.target as Element).closest('[data-del-comment]');
    if (!del || !confirm('این نظر حذف شود؟')) return;
    const id = del.closest<HTMLElement>('[data-cid]')!.dataset.cid!;
    try {
      await api(`comments?post=${post}&id=${encodeURIComponent(id)}`, { method: 'DELETE', body: { guest: guest() } });
      items = items.filter((c) => c.id !== id);
      render();
    } catch {
      toast('حذف نشد');
    }
  });
}

// ---------- live chat ----------
type Message = Comment & { c: number };
const chatDialog = () => $<HTMLDialogElement>('#chat');
const chatOpen = () => !!chatDialog()?.open;
let chatTimer: number | undefined;
let quietPolls = 0;
const myMessages = () => store.get<string[]>('myMessages', []);

function renderChat(messages: Message[]) {
  const list = $('[data-chat-list]')!;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const own = myMessages();
  list.innerHTML = messages.length
    ? [...messages]
        .reverse()
        .map(
          (m) => `<li class="msg${own.includes(m.id) ? ' mine' : ''}">
            <span class="avatar" style="--h:${m.c}" aria-hidden="true">${esc(initial(m.name))}</span>
            <div><b style="--h:${m.c}">${esc(m.name)}</b><p dir="auto">${esc(m.text)}</p><time datetime="${esc(m.at)}">${esc(relTime(m.at))}</time></div>
          </li>`,
        )
        .join('')
    : '<li class="chat-empty">هنوز پیامی نیست. سلام کنید! 👋</li>';
  if (atBottom || own.includes(messages[0]?.id)) list.scrollTop = list.scrollHeight;
  if (messages[0]) {
    store.set('chatSeen', messages[0].id);
    $$('[data-chat-dot]').forEach((el) => (el.hidden = true));
  }
}

async function pollChat() {
  clearTimeout(chatTimer);
  if (!chatOpen()) return;
  try {
    const { messages } = await api<{ messages: Message[] }>('chat');
    quietPolls = messages[0]?.id === store.get('chatSeen', null) ? quietPolls + 1 : 0;
    renderChat(messages);
    $('[data-chat-off]')!.hidden = true;
  } catch {
    $('[data-chat-off]')!.hidden = false;
  }
  // Fast while the room is busy, slower when nothing happens (keeps the free tier comfortable).
  chatTimer = window.setTimeout(pollChat, quietPolls > 12 ? 20_000 : 5_000);
}

function initChat() {
  const dialog = chatDialog();
  if (!dialog) return;
  const form = $<HTMLFormElement>('[data-chat-form]', dialog)!;
  const nameInput = form.elements.namedItem('name') as HTMLInputElement;
  $$('[data-open-chat]').forEach((b) =>
    b.addEventListener('click', () => {
      nameInput.value = myName();
      nameInput.hidden = !!myName();
      dialog.showModal();
      quietPolls = 0;
      pollChat();
      setTimeout(() => (form.elements.namedItem('text') as HTMLInputElement).focus(), 50);
    }),
  );
  dialog.addEventListener('close', () => clearTimeout(chatTimer));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    if (nameInput.value.trim() && nameInput.value.trim() !== myName()) setMyName(nameInput.value);
    const textInput = form.elements.namedItem('text') as HTMLInputElement;
    try {
      const { message } = await api<{ message: Message | null }>('chat', {
        method: 'POST',
        body: { guest: guest(), name: myName(), text: data.get('text'), website: data.get('website') },
      });
      textInput.value = '';
      nameInput.hidden = !!myName();
      if (message) {
        store.set('myMessages', [...myMessages(), message.id].slice(-300));
        award('chat');
        quietPolls = 0;
        pollChat();
      }
    } catch (err) {
      toast(slowDown(err) ? 'کمی آهسته‌تر؛ چند ثانیه صبر کنید' : 'پیام ارسال نشد');
    }
  });
}

// ---------- weekly leaderboard ----------
async function loadLeaders() {
  const boxes = $$('[data-leaders]');
  if (!boxes.length) return;
  try {
    const { week } = await api<{ week: { name: string; points: number }[] }>('leaders');
    if (!week.length) return;
    const medals = ['🥇', '🥈', '🥉'];
    const html = week
      .map((l, i) => `<li>${medals[i] ?? `<span class="rank">${fmtNum(i + 1)}</span>`} ${avatarHtml(l.name)}<b>${esc(l.name)}</b><span>${fmtNum(l.points)}</span></li>`)
      .join('');
    boxes.forEach((b) => {
      $('[data-leaders-list]', b)!.innerHTML = html;
      b.hidden = false;
    });
  } catch {}
}

// ---------- wiring ----------
document.addEventListener('click', (e) => {
  const t = e.target as Element;
  const btn = t.closest<HTMLButtonElement>('[data-react]');
  if (btn) return void react(btn);
  const toggle = t.closest<HTMLButtonElement>('[data-react-toggle]');
  $$('.reactions.mini.open').forEach((b) => b !== toggle?.parentElement && (b.classList.remove('open'), $('[data-react-toggle]', b)?.setAttribute('aria-expanded', 'false')));
  if (toggle) {
    const box = toggle.parentElement!;
    const open = box.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  }
});

export function initSocial() {
  initComments();
  initChat();
  loadEngage();
  loadLeaders();
  beat(true).then(() => available && startBeats());
}
