// Guest features backed by the /api functions: reactions, comments, live presence & visits, chat, leaderboard.
// If the API is missing or unreachable, these parts stay hidden and the rest of the site works as usual.
import { SITE } from '../site';
import { $, $$, compact, esc, fmtNum, guest, hue, initial, myName, relTime, setMyName, store, toast } from './core';
import { award } from './game';

let available = true;
async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!available) throw new Error('offline');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    // Functions live at /api/<name>/ (trailingSlash): without the slash every call pays a 308 redirect,
    // and a redirected CORS preflight fails outright on the GitHub Pages mirror.
    const res = await fetch(`${SITE.api}/api/${path.replace(/^[\w-]+/, '$&/')}`, {
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
// What you send shows at once (an outbox), and stays until the room's list carries it: that list is shared through
// the CDN for a couple of seconds, so the poll right after sending may not have it yet.
type Message = Comment & { c: number };
type Outgoing = Message & { sending?: boolean };
const chatDialog = () => $<HTMLDialogElement>('#chat');
const chatOpen = () => !!chatDialog()?.open;
let chatTimer: number | undefined;
let quietPolls = 0;
let room: Message[] | null = null; // newest first, as the API sends it
let outbox: Outgoing[] = [];
const myMessages = () => store.get<string[]>('myMessages', []);

function msgHtml(m: Outgoing, own: boolean) {
  return `<li class="msg${own ? ' mine' : ''}${m.sending ? ' sending' : ''}">
    <span class="avatar" style="--h:${m.c}" aria-hidden="true">${esc(initial(m.name))}</span>
    <div><b style="--h:${m.c}">${esc(m.name)}</b><p dir="auto">${esc(m.text)}</p><time datetime="${esc(m.at)}">${m.sending ? 'در حال ارسال…' : esc(relTime(m.at))}</time></div>
  </li>`;
}

function renderChat(stick = false) {
  const list = $('[data-chat-list]')!;
  const atBottom = stick || list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const own = myMessages();
  const ids = new Set((room ?? []).map((m) => m.id));
  outbox = outbox.filter((m) => !ids.has(m.id));
  const all = [...outbox, ...(room ?? [])];
  list.innerHTML = room === null && !outbox.length
    ? '<li class="chat-empty">در حال بارگذاری…</li>'
    : all.length
      ? [...all].reverse().map((m) => msgHtml(m, own.includes(m.id) || !!(m as Outgoing).sending)).join('')
      : '<li class="chat-empty">هنوز پیامی نیست. بدون ثبت‌نام سلام کنید 👋</li>';
  if (atBottom) list.scrollTop = list.scrollHeight;
  if (room?.[0]) {
    store.set('chatSeen', room[0].id);
    $$('[data-chat-dot]').forEach((el) => (el.hidden = true));
  }
}

async function pollChat() {
  clearTimeout(chatTimer);
  if (!chatOpen()) return;
  try {
    const { messages } = await api<{ messages: Message[] }>('chat');
    quietPolls = messages[0]?.id === room?.[0]?.id ? quietPolls + 1 : 0;
    room = messages;
    renderChat();
    $('[data-chat-off]')!.hidden = true;
  } catch {
    $('[data-chat-off]')!.hidden = false;
  }
  // Fast while the room is busy or a message of yours is on its way, slower when nothing happens.
  chatTimer = window.setTimeout(pollChat, outbox.length ? 2_500 : quietPolls > 12 ? 20_000 : 5_000);
}

function initChat() {
  const dialog = chatDialog();
  if (!dialog) return;
  const form = $<HTMLFormElement>('[data-chat-form]', dialog)!;
  const nameInput = form.elements.namedItem('name') as HTMLInputElement;
  const textInput = form.elements.namedItem('text') as HTMLInputElement;
  // Phones: the keyboard covers the bottom of the screen without resizing the page (iOS), so the chat fits itself to
  // the part still visible and the message box stays right above the keyboard.
  const list = $('[data-chat-list]', dialog)!;
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    dialog.style.height = `${vv.height}px`;
    dialog.style.top = `${vv.offsetTop}px`;
    if (atBottom) list.scrollTop = list.scrollHeight;
  };
  $$('[data-open-chat]').forEach((b) =>
    b.addEventListener('click', () => {
      nameInput.value = myName();
      nameInput.hidden = !!myName();
      dialog.showModal();
      fit();
      vv?.addEventListener('resize', fit);
      vv?.addEventListener('scroll', fit);
      renderChat(true);
      quietPolls = 0;
      pollChat();
      // Not on phones: the keyboard would cover half the room before anyone asked to type.
      if (matchMedia('(hover: hover)').matches) setTimeout(() => textInput.focus(), 50);
    }),
  );
  dialog.addEventListener('close', () => {
    clearTimeout(chatTimer);
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
  });
  // Tapping send must not take the focus off the text box: on phones that would close the keyboard after every message.
  $('button[type=submit]', form)?.addEventListener('pointerdown', (e) => e.preventDefault());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    const website = (form.elements.namedItem('website') as HTMLInputElement).value;
    if (nameInput.value.trim() && nameInput.value.trim() !== myName()) setMyName(nameInput.value);
    const name = myName() || 'مهمان';
    const draft: Outgoing = { id: `local-${Date.now()}`, name, text, at: new Date().toISOString(), c: hue(guest()), sending: true };
    outbox.push(draft);
    textInput.value = '';
    textInput.focus(); // still inside the tap, so iOS keeps the keyboard up for the next message
    nameInput.hidden = !!myName();
    renderChat(true);
    try {
      const { message } = await api<{ message: Message | null }>('chat', {
        method: 'POST',
        body: { guest: guest(), name: myName(), text, website },
      });
      outbox = outbox.filter((m) => m !== draft);
      if (message) {
        store.set('myMessages', [...myMessages(), message.id].slice(-300));
        if (!room?.some((m) => m.id === message.id)) outbox.push(message);
        award('chat');
      }
      renderChat(true);
      quietPolls = 0;
      chatTimer = window.setTimeout(pollChat, 2_500);
    } catch (err) {
      outbox = outbox.filter((m) => m !== draft);
      renderChat();
      if (!textInput.value) textInput.value = text;
      toast(slowDown(err) ? 'کمی آهسته‌تر؛ چند ثانیه صبر کنید' : 'پیام ارسال نشد؛ دوباره بفرستید');
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
  if (btn) react(btn);
});

export function initSocial() {
  initComments();
  initChat();
  loadEngage();
  loadLeaders();
  beat(true).then(() => available && startBeats());
}
