// The saved stories' page: the list (kept on this device, pages cached for offline reading), and «گوش دادن بدون
// اینترنت» — the sound of every saved story kept too (src/scripts/offline-audio.ts), for the voices that need the
// network: the site's cloud voice, or a service the reader connected. A voice on the device already works offline.
import { $, $$, fmtNum, getSaved, rowHtml, toast } from './core';
import { dropAll, keepStory, keptBytes, paragraphsOf, storyState, type Kind } from './offline-audio';
import { hasPersianVoice, persianVoice } from './speech';

const list = $('[data-saved-list]')!;
const empty = $('[data-saved-empty]')!;
const box = $('[data-oa]')!;
let kind: Kind | null = null;
let busy = false;

async function badges() {
  if (!kind) return;
  for (const li of $$<HTMLElement>('[data-id]', list)) {
    const state = await storyState(Number(li.dataset.id), kind);
    li.classList.toggle('oa-all', state === 'all');
    const b = $('b', li);
    if (b && state === 'all' && !$('.oa-badge', li)) b.insertAdjacentHTML('afterend', '<small class="oa-badge">🎧 صدا روی دستگاه</small>');
  }
}

function render() {
  const items = getSaved();
  empty.hidden = items.length > 0;
  list.innerHTML = items.map((s) => rowHtml(s, true)).join('');
  box.hidden = !items.length || box.dataset.off === '1';
  badges();
  size();
}

async function size() {
  const n = await keptBytes();
  const drop = $<HTMLButtonElement>('[data-oa-drop]', box)!;
  drop.hidden = !n;
  drop.textContent = `پاک کردن صداها (${fmtNum(Math.max(1, Math.round(n / 1e6)))} مگابایت)`;
}

async function keepAll() {
  if (busy || !kind) return;
  busy = true;
  const btn = $<HTMLButtonElement>('[data-oa-keep]', box)!;
  const bar = $('[data-oa-progress]', box)!;
  const pct = $('[data-oa-pct]', box)!;
  btn.disabled = true;
  bar.hidden = false;
  const ids = getSaved().map((s) => s.id);
  let failed = 0;
  try {
    const todo: number[] = [];
    for (const id of ids) if ((await storyState(id, kind)) !== 'all') todo.push(id);
    const total = (await Promise.all(todo.map((id) => paragraphsOf(id).catch(() => 0)))).reduce((a, b) => a + b, 0);
    let done = 0;
    const show = () => {
      $<HTMLProgressElement>('progress', bar)!.value = total ? (done / total) * 100 : 100;
      pct.textContent = `${fmtNum(done)} از ${fmtNum(total)} بند`;
    };
    show();
    for (const id of todo) {
      try {
        await keepStory(id, kind, () => (done++, show()));
      } catch {
        failed++;
      }
    }
    toast(failed ? `صدای ${fmtNum(failed)} خبر آماده نشد؛ اتصال را بررسی کنید و دوباره بزنید` : 'صدای خبرهای ذخیره‌شده روی دستگاه است؛ بدون اینترنت هم گوش بدهید', failed ? 'info' : 'reward');
  } finally {
    busy = false;
    btn.disabled = false;
    bar.hidden = true;
    render();
  }
}

export async function initSaved() {
  render();
  document.addEventListener('saved-change', render);
  const source = await persianVoice();
  const now = hasPersianVoice() ?? source;
  const note = $('[data-oa-note]', box)!;
  if (now === 'cloud' || now === 'remote') {
    kind = now;
    note.textContent =
      now === 'remote'
        ? 'صدای هر خبر ذخیره‌شده با سرویس صدای خودتان ساخته و روی همین دستگاه نگه داشته می‌شود (هزینه‌ی سرویس با خودتان است).'
        : 'صدای هر خبر ذخیره‌شده یک بار دانلود و روی همین دستگاه نگه داشته می‌شود؛ بعد بدون اینترنت هم گوش بدهید.';
    $('[data-oa-actions]', box)!.hidden = false;
  } else if (now === 'local' || now === 'device') {
    note.textContent = 'صدای فارسی شما روی همین دستگاه ساخته می‌شود؛ خبرهای ذخیره‌شده بدون اینترنت هم خوانده می‌شوند ✓';
  } else {
    box.dataset.off = '1';
  }
  $('[data-oa-keep]', box)!.addEventListener('click', keepAll);
  $('[data-oa-drop]', box)!.addEventListener('click', async () => {
    if (!confirm('صداهای نگه‌داشته‌شده از این دستگاه پاک شوند؟')) return;
    await dropAll();
    toast('صداها پاک شد');
    render();
  });
  render();
}
