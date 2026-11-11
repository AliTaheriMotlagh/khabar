// Guest features backed by the /api functions: reactions, comments, live presence & visits, chat, leaderboard.
// If the API is missing or unreachable, these parts stay hidden and the rest of the site works as usual.
import { SITE } from '../site';
import { $, $$, BASE, compact, esc, fmtNum, guest, hue, initial, myName, relTime, setMyName, store, toast } from './core';
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
type Live = { online: number; chat: string | null; today?: number; total?: number; views?: number; viewsToday?: number };
const articleId = () => Number($('[data-article]')?.dataset.id) || undefined;

function showLive(d: Live) {
  $$('[data-online]').forEach((el) => (el.textContent = fmtNum(d.online)));
  $$('[data-online-pill], [data-live-card]').forEach((el) => (el.hidden = false));
  if (d.today != null) $$('[data-today]').forEach((el) => (el.textContent = compact(d.today!)));
  if (d.total != null) $$('[data-total]').forEach((el) => (el.textContent = compact(d.total!)));
  if (d.total) $$('[data-site-stats]').forEach((el) => (el.hidden = false));
  const id = articleId();
  if (id && d.views) setViews(id, d.views);
  // This story's views today, beside its total (when they aren't the same number).
  const day = $('[data-views-day]');
  if (day && d.viewsToday && d.viewsToday !== d.views) {
    day.textContent = ` · ${compact(d.viewsToday)} امروز`;
    day.hidden = false;
  }
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
    showLive(await api<Live>('live', { method: 'POST', body: { guest: guest(), post: articleId(), view, name: myName() || undefined, ...(view && { ref: visitSource() }) } }));
  } catch {}
}
/** Where this visit came from (counted once per reader per day, for the owner's page): a campaign's utm_source, the
 *  site that linked here, or nothing (typed, a bookmark, the installed app). Only the site's name is sent. */
function visitSource() {
  const utm = new URL(location.href).searchParams.get('utm_source');
  if (utm) return utm.slice(0, 40);
  try {
    const r = new URL(document.referrer);
    return r.hostname === location.hostname ? 'internal' : `${r.protocol}//${r.hostname}`;
  } catch {
    return 'direct';
  }
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
      // A story with comments loads them now, not only near the comments: some are about passages, marked in the text.
      if (d?.c && Number(id) === articleId()) loadComments?.();
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
// A comment can be about a passage the reader highlighted (`quote`, see the selection bar in reader.ts): the passage is
// shown above it, and marked in the story's text — a tap on either goes to the other.
// Replies are one level deep (`re`: the comment answered), shown under it oldest first; a reader can like a comment
// once and report one (enough reports hide it until the site's owner looks: api/comments.js).
type Comment = { id: string; name: string; text: string; at: string; quote?: string; re?: string; likes?: number };
const myComments = () => store.get<string[]>('myComments', []);
const likedComments = () => store.get<string[]>('likedComments', []);
const reportedComments = () => store.get<string[]>('reportedComments', []);
const svg = (d: string) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const HEART = svg('<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>');
const REPLY = svg('<path d="M10 8 4 13l6 5"/><path d="M4 13h10a6 6 0 0 1 6 6"/>');
const FLAG = svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>');
let loadComments: (() => void) | undefined;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const passages = () => $$('h1, .prose p, .why p, .digest-list li', $('[data-article]') ?? document);

/** Wraps the first place each quote appears in the story (inside one paragraph) in a mark, after removing old marks. */
function markQuotes(items: Comment[]) {
  const article = $('[data-article]');
  if (!article) return;
  for (const m of $$('mark.c-mark', article)) m.replaceWith(...m.childNodes);
  article.normalize();
  const byQuote = new Map<string, number>();
  for (const c of items) if (c.quote) byQuote.set(norm(c.quote), (byQuote.get(norm(c.quote)) ?? 0) + 1);
  for (const [quote, n] of byQuote) {
    for (const block of passages()) {
      if (wrap(block, quote, n)) break;
    }
  }
}

/** Finds `quote` in the block's text (spaces counted loosely) and wraps it, text node by text node. */
function wrap(block: Element, quote: string, n: number): boolean {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  // The block's text with whitespace runs as one space, and where each of its characters came from.
  let flat = '';
  const from: [Text, number][] = [];
  for (const node of nodes) {
    const t = node.data;
    for (let i = 0; i < t.length; i++) {
      const space = /\s/.test(t[i]);
      if (space && (flat.endsWith(' ') || !flat)) continue;
      flat += space ? ' ' : t[i];
      from.push([node, i]);
    }
  }
  const at = flat.indexOf(quote);
  if (at < 0 || !quote) return false;
  const end = at + quote.length - 1;
  // Each text node's covered part, from its first to its last covered character.
  const parts = new Map<Text, [number, number]>();
  for (let k = at; k <= end; k++) {
    const [node, i] = from[k];
    const p = parts.get(node);
    parts.set(node, p ? [p[0], i] : [i, i]);
  }
  const label = `${fmtNum(n)} نظر روی این بخش`;
  for (const [node, [a, b]] of parts) {
    const range = document.createRange();
    range.setStart(node, a);
    range.setEnd(node, b + 1);
    const mark = document.createElement('mark');
    mark.className = 'c-mark';
    mark.dataset.quote = quote;
    mark.title = label;
    mark.tabIndex = 0;
    mark.setAttribute('role', 'button');
    mark.setAttribute('aria-label', `${label}: رفتن به نظرها`);
    range.surroundContents(mark);
  }
  return true;
}

const flash = (el: Element) => {
  el.classList.remove('flash');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('flash');
};

function avatarHtml(name: string) {
  return `<span class="avatar" style="--h:${hue(name)}" aria-hidden="true">${esc(initial(name))}</span>`;
}
function commentHtml(c: Comment, replies: Comment[] = []): string {
  const mineC = myComments().includes(c.id);
  const liked = likedComments().includes(c.id);
  const reported = reportedComments().includes(c.id);
  return `<li class="comment${mineC ? ' mine' : ''}${c.re ? ' reply' : ''}" data-cid="${esc(c.id)}" data-cname="${esc(c.name)}"${c.quote ? ` data-cquote="${esc(norm(c.quote))}"` : ''}>
    ${avatarHtml(c.name)}
    <div class="c-body">
      <div class="c-head"><b>${esc(c.name)}</b><time datetime="${esc(c.at)}">${esc(relTime(c.at))}</time></div>
      ${c.quote ? `<button class="c-quote" type="button" data-goto-quote title="دیدن این بخش در متن خبر"><span dir="auto">${esc(c.quote)}</span></button>` : ''}
      <p dir="auto">${esc(c.text)}</p>
      <div class="c-actions">
        <button class="c-act like" type="button" data-like-comment aria-pressed="${liked}" aria-label="${liked ? 'پس گرفتن پسند' : 'پسندیدن'}">${HEART}<span data-likes>${c.likes ? fmtNum(c.likes) : ''}</span></button>
        <button class="c-act" type="button" data-reply-comment>${REPLY}<span>پاسخ</span></button>
        ${
          mineC
            ? '<button class="c-act end" type="button" data-del-comment aria-label="حذف نظر من">حذف</button>'
            : `<button class="c-act end" type="button" data-report-comment ${reported ? 'disabled' : ''} aria-label="گزارش این نظر" title="${reported ? 'گزارش داده‌اید' : 'گزارش نظر نامناسب'}">${FLAG}</button>`
        }
      </div>
      ${replies.length ? `<ol class="replies">${replies.map((r) => commentHtml(r)).join('')}</ol>` : ''}
    </div>
  </li>`;
}

/** Top-level comments newest first, each with its replies oldest first (a reply whose comment is gone stands alone). */
function thread(items: Comment[]) {
  const ids = new Set(items.map((c) => c.id));
  const replies = new Map<string, Comment[]>();
  for (const c of items) if (c.re && ids.has(c.re)) replies.set(c.re, [...(replies.get(c.re) ?? []), c]);
  return items
    .filter((c) => !c.re || !ids.has(c.re))
    .map((c) => commentHtml(c, (replies.get(c.id) ?? []).sort((a, b) => a.at.localeCompare(b.at))))
    .join('');
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
  const textInput = form.elements.namedItem('text') as HTMLTextAreaElement;
  const draft = $('[data-comment-quote]', form)!;
  const replyChip = $('[data-comment-reply]', form)!;
  nameInput.value = myName();
  let items: Comment[] = [];
  let quote = '';
  let replyTo: Comment | null = null;

  const render = () => {
    list.innerHTML = thread(items);
    empty.hidden = items.length > 0;
    count.textContent = items.length ? fmtNum(items.length) : '';
    markQuotes(items);
  };
  let loaded: Promise<void> | null = null;
  const load = () =>
    (loaded ??= (async () => {
      try {
        items = (await api<{ comments: Comment[] }>(`comments?post=${post}`)).comments;
        render();
      } catch {
        off.hidden = false;
        form.hidden = true;
      }
    })());
  loadComments = load;
  // Load when the reader gets near the comments (saves a request for quick readers).
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      load();
    }
  }, { rootMargin: '600px' }).observe(box);

  const setQuote = (q: string) => {
    quote = q;
    draft.hidden = !q;
    $('[data-comment-quote-text]', draft)!.textContent = q;
    textInput.placeholder = q ? 'درباره‌ی این بخش چه نظری دارید؟' : 'نظرتان را بنویسید…';
  };
  $('[data-comment-quote-x]', draft)?.addEventListener('click', () => setQuote(''));
  const setReply = (c: Comment | null) => {
    replyTo = c;
    replyChip.hidden = !c;
    $('[data-comment-reply-name]', replyChip)!.textContent = c?.name ?? '';
    if (c) textInput.placeholder = `پاسخ شما به ${c.name}…`;
    else if (!quote) textInput.placeholder = 'نظرتان را بنویسید…';
  };
  $('[data-comment-reply-x]', replyChip)?.addEventListener('click', () => setReply(null));
  // From the bar over a selection in the story (reader.ts).
  document.addEventListener('comment-on', (e) => {
    load();
    if (form.hidden) return toast('بخش نظرها فعلاً در دسترس نیست');
    setQuote((e as CustomEvent<string>).detail);
    form.scrollIntoView({ block: 'center', behavior: 'smooth' });
    textInput.focus({ preventScroll: true });
  });
  // A marked passage in the story: to its comments.
  $('[data-article]')?.addEventListener('click', (e) => {
    const mark = (e.target as Element).closest<HTMLElement>('mark.c-mark');
    if (!mark || getSelection()?.toString()) return;
    const first = $$<HTMLElement>('[data-cquote]', list).filter((li) => li.dataset.cquote === mark.dataset.quote);
    if (!first.length) return;
    first[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    first.forEach(flash);
  });
  $('[data-article]')?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).matches?.('mark.c-mark')) {
      e.preventDefault();
      (e.target as HTMLElement).click();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const btn = $<HTMLButtonElement>('button[type=submit]', form)!;
    btn.disabled = true;
    try {
      if (nameInput.value.trim() !== myName()) setMyName(nameInput.value);
      const { comment } = await api<{ comment: Comment | null }>('comments', {
        method: 'POST',
        body: { post, guest: guest(), name: myName(), text: data.get('text'), website: data.get('website'), ...(quote && { quote }), ...(replyTo && { re: replyTo.id }) },
      });
      if (comment) {
        store.set('myComments', [...myComments(), comment.id].slice(-500));
        items.unshift(comment);
        render();
        award('comment');
      }
      form.reset();
      setQuote('');
      setReply(null);
      nameInput.value = myName();
      if (comment?.re) list.querySelector(`[data-cid="${CSS.escape(comment.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      toast(slowDown(err) ? 'چند لحظه صبر کنید و دوباره بفرستید' : 'نظر ارسال نشد؛ دوباره امتحان کنید');
    } finally {
      btn.disabled = false;
    }
  });

  list.addEventListener('click', async (e) => {
    const go = (e.target as Element).closest('[data-goto-quote]');
    if (go) {
      const q = go.closest<HTMLElement>('[data-cquote]')!.dataset.cquote;
      const mark = $$<HTMLElement>('mark.c-mark').find((m) => m.dataset.quote === q);
      if (!mark) return toast('این بخش در متن خبر پیدا نشد؛ شاید متن خبر عوض شده');
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
      $$('mark.c-mark').filter((m) => m.dataset.quote === q).forEach(flash);
      return;
    }
    const t = e.target as Element;
    const li = t.closest<HTMLElement>('[data-cid]');
    if (!li) return;
    const cid = li.dataset.cid!;
    const c = items.find((x) => x.id === cid);
    if (t.closest('[data-reply-comment]') && c) {
      setReply(c);
      form.scrollIntoView({ block: 'center', behavior: 'smooth' });
      textInput.focus({ preventScroll: true });
      return;
    }
    const likeBtn = t.closest<HTMLButtonElement>('[data-like-comment]');
    if (likeBtn && c) return likeComment(c, likeBtn);
    if (t.closest('[data-report-comment]') && c) return reportComment(c);
    const del = t.closest('[data-del-comment]');
    if (!del || !confirm('این نظر حذف شود؟')) return;
    const id = cid;
    try {
      await api(`comments?post=${post}&id=${encodeURIComponent(id)}`, { method: 'DELETE', body: { guest: guest() } });
      items = items.filter((c) => c.id !== id);
      render();
    } catch {
      toast('حذف نشد');
    }
  });

  // Shown at once, then the server's count; taken back if it fails.
  async function likeComment(c: Comment, btn: HTMLButtonElement) {
    const on = !likedComments().includes(c.id);
    const before = c.likes ?? 0;
    const paint = () => {
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'پس گرفتن پسند' : 'پسندیدن');
      $('[data-likes]', btn)!.textContent = c.likes ? fmtNum(c.likes) : '';
    };
    store.set('likedComments', on ? [...likedComments(), c.id].slice(-500) : likedComments().filter((x) => x !== c.id));
    c.likes = Math.max(0, before + (on ? 1 : -1));
    paint();
    if (on) {
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
    }
    try {
      c.likes = (await api<{ likes: number }>('comments', { method: 'POST', body: { action: 'like', post, id: c.id, guest: guest(), on } })).likes;
      paint();
    } catch (e) {
      store.set('likedComments', on ? likedComments().filter((x) => x !== c.id) : [...likedComments(), c.id]);
      c.likes = before;
      btn.setAttribute('aria-pressed', String(!on));
      $('[data-likes]', btn)!.textContent = before ? fmtNum(before) : '';
      toast(slowDown(e) ? 'کمی آهسته‌تر 🙂' : 'ثبت نشد؛ دوباره امتحان کنید');
    }
  }

  async function reportComment(c: Comment) {
    if (!confirm('این نظر گزارش شود؟ (توهین، هرزنامه یا محتوای نامناسب) — اگر چند نفر گزارشش کنند، تا بررسی پنهان می‌شود.')) return;
    store.set('reportedComments', [...reportedComments(), c.id].slice(-300));
    try {
      const { hidden } = await api<{ hidden: boolean }>('comments', { method: 'POST', body: { action: 'report', post, id: c.id, guest: guest() } });
      if (hidden) items = items.filter((x) => x.id !== c.id);
      toast(hidden ? 'گزارش شد و این نظر تا بررسی پنهان شد' : 'گزارش شد؛ ممنون که کمک می‌کنید');
    } catch {
      store.set('reportedComments', reportedComments().filter((x) => x !== c.id));
      toast('گزارش ثبت نشد؛ کمی بعد امتحان کنید');
    }
    render();
  }
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

// ---------- sync: a reader asks for a crawl now; any open page offers newer news once a build has it ----------
type Sync = { running: boolean; last: string | null; queued?: boolean };
const built = { latest: Number(document.documentElement.dataset.buildLatest) || 0, count: Number(document.documentElement.dataset.buildCount) || 0 };
const syncBtns = () => $$<HTMLButtonElement>('[data-sync]');
const setBusy = (on: boolean) => syncBtns().forEach((b) => b.toggleAttribute('data-busy', on));
let fresh = false;
let lastCheck = 0;

/** True once the live site has more than this page: then the "news arrived" pill shows. */
async function checkBuild(): Promise<boolean> {
  if (fresh) return true;
  lastCheck = Date.now();
  try {
    const b = await fetch(`${BASE}/build.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json());
    fresh = b.latest > built.latest || b.count > built.count;
  } catch {}
  if (fresh) $$('[data-fresh]').forEach((el) => (el.hidden = false));
  return fresh;
}

let watchTimer: number | undefined;
/** Wait for the crawl to finish and the site to publish what it found. `asked`: the reader tapped, so say if nothing came. */
function watch(asked: boolean) {
  const since = Date.now();
  let doneAt = 0;
  setBusy(true);
  clearInterval(watchTimer);
  const stop = (found: boolean) => {
    clearInterval(watchTimer);
    setBusy(false);
    if (!found && asked) toast('خبر تازه‌ای در کانال نبود؛ همه‌ی خبرها همین‌جاست');
  };
  watchTimer = window.setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    if (await checkBuild()) return stop(true);
    // A just-started run takes a few seconds to show up as running, so "not running" only counts after a minute.
    if (!doneAt && Date.now() - since > 60_000) {
      try {
        if (!(await api<Sync>('sync')).running) doneAt = Date.now();
      } catch {}
    }
    // After the crawl, the site needs a few minutes to build and publish what it committed.
    if ((doneAt && Date.now() - doneAt > 240_000) || Date.now() - since > 900_000) stop(false);
  }, 20_000);
}

async function requestSync() {
  if (syncBtns()[0]?.hasAttribute('data-busy')) return toast('در حال به‌روزرسانی از کانال…');
  if (await checkBuild()) return toast('خبرهای تازه آماده‌ست؛ دکمه‌ی بالا رو بزنید');
  setBusy(true);
  try {
    const st = await api<Sync>('sync', { method: 'POST', body: { guest: guest() } });
    if (st.queued) toast('درخواست ثبت شد؛ خبرهای تازه‌ی کانال تا چند دقیقه‌ی دیگه می‌رسن');
    else if (st.running) toast('همین حالا در حال به‌روزرسانی از کانال است…');
    else toast(`سایت ${st.last ? relTime(st.last) : 'همین تازگی'} با کانال هماهنگ شده`);
    // Even a crawl that just finished may still be on its way to the site.
    watch(st.queued || st.running);
  } catch (e) {
    setBusy(false);
    toast(slowDown(e) ? 'چند دقیقه‌ی دیگه دوباره امتحان کنید' : 'الان نشد؛ کمی بعد دوباره امتحان کنید');
  }
}

async function initSync() {
  // A page served from the offline cache on a slow connection can be hours old: say so right away.
  checkBuild();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && Date.now() - lastCheck > 120_000 && checkBuild());
  $$('[data-fresh]').forEach((b) => b.addEventListener('click', () => location.reload()));
  if (!syncBtns().length) return;
  try {
    const st = await api<Sync>('sync'); // 501 when the site has no GitHub token: the button stays hidden
    syncBtns().forEach((b) => {
      b.hidden = false;
      b.addEventListener('click', requestSync);
    });
    if (st.running) watch(false);
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
  initSync();
  beat(true).then(() => available && startBeats());
}
