// "Listen" on a device without a Persian voice, and the choice of voice: the sheet in src/components/VoiceOffer.astro
// lists the downloadable voices (src/lib/voices.ts) with a preview of each, downloads the one picked in the background
// (src/scripts/voice.ts; the sheet can close, and a download cut by leaving the page goes on from the next one), makes
// it the voice that reads once it's complete, and switches between the downloaded ones. Once there is a voice it plays
// what the reader asked for — from a tap on «گوش دادن», because iOS only starts audio inside a tap. The settings sheet
// shows the voice's state too.
import { $, $$, fmtNum, store, toast } from './core';
import { hasPersianVoice, persianVoice, systemVoice } from './speech';
import { activeVoice, cancelDownload, chooseVoice, chosenVoice, downloadVoice, downloading, missingBytes, removeVoice, storedBytes, voiceFits, voiceStates, voiceSupported, type VoiceState } from './voice';
import { VOICES, voiceById, type Voice } from '../lib/voices';

const dlg = $<HTMLDialogElement>('#voice');
let then: (() => void) | null = null;
let states = new Map<string, VoiceState>();
let system: 'device' | 'cloud' | null = null; // a Persian voice that needs no download
let progress: { id: string; loaded: number; total: number } | null = null;
const errors = new Map<string, string>(); // the last failed download's message, by family
const mb = (n: number) => fmtNum(Math.round(n / 1e6));

/** "Listen" makes sense here: there is a Persian voice, or one can be downloaded. */
export async function canListen() {
  return (await persianVoice()) !== null || voiceSupported();
}

/** For the tap on a "listen" button: plays at once when there is a voice, otherwise offers the download first. */
export function listenOr(play: () => void) {
  if (hasPersianVoice() || !dlg) return play();
  openVoice(play);
}

// ---------- the sheet ----------
const cards = () => $$<HTMLLIElement>('[data-vo]', dlg!);
/** The build picked in a card: its full or light radio, or its only one. */
const picked = (card: HTMLElement) => voiceById($<HTMLInputElement>('input[type=radio]:checked, input[type=hidden]', card)?.value)!;
const builds = (card: HTMLElement) => VOICES.filter((v) => v.family === card.dataset.vo);
/** The voice that reads now: a downloaded one, or 'system' (the device's or the server's). */
const speaking = () => (hasPersianVoice() === 'local' ? activeVoice()?.id : system ? 'system' : null);

async function refresh() {
  states = await voiceStates();
  if (!dlg?.open) return;
  render();
}

function render() {
  if (!dlg) return;
  const now = speaking();
  const any = [...states.values()].includes('ready');
  const lost = !any && store.get('voice-had', false);
  const current = voiceById(now);
  $('[data-voice-lead]', dlg)!.textContent = current
    ? `«${current.name}» خبرها را برایتان می‌خواند. می‌توانید صدای دیگری هم دانلود کنید و هر وقت خواستید عوضش کنید.`
    : system === 'device'
      ? 'این دستگاه خودش صدای فارسی دارد و دانلود لازم نیست؛ اگر صدای دیگری می‌خواهید، نمونه‌ها را بشنوید و یکی را دانلود کنید.'
      : system === 'cloud'
        ? 'صدای فارسی از سرور خبر می‌آید و دانلود لازم نیست؛ برای گوش دادن بدون اینترنت، یکی از این صداها را دانلود کنید.'
        : lost
          ? 'صدای فارسی که قبلاً دانلود کرده بودید را مرورگر پاک کرده — مثلاً در حالت مرور خصوصی چیزی نگه داشته نمی‌شود. دوباره دانلود کنید، یا در حالت عادی مرورگر باز کنید.'
          : 'این دستگاه صدای فارسی ندارد. نمونه‌ی صداها را بشنوید و یکی را یک بار دانلود کنید تا خبرها و خلاصه‌ی روز را بشنوید.';
  $('[data-voice-facts]', dlg)!.hidden = any;

  // The device's or the server's own voice, as the first choice.
  const sys = $('[data-vo-system]', dlg)!;
  sys.hidden = !system;
  if (system) {
    $('[data-vo-system-name]', sys)!.textContent = system === 'device' ? 'صدای خود دستگاه' : 'صدای سرور خبر';
    $('[data-vo-system-about]', sys)!.textContent = system === 'device' ? 'صدای فارسی که خود این دستگاه دارد.' : 'صدای فارسی که سرور خبر می‌سازد؛ به اینترنت نیاز دارد.';
    stateLine(sys, now === 'system' ? 'در حال استفاده' : '', now === 'system');
    const go = $<HTMLButtonElement>('[data-vo-go]', sys)!;
    go.hidden = now === 'system';
  }

  for (const card of cards()) {
    const all = builds(card);
    const v = picked(card);
    const state = states.get(v.id) ?? 'none';
    const busy = downloading() === v.id;
    // The card's line: about the speaker, whichever build.
    const using = all.find((b) => b.id === now);
    const getting = all.find((b) => b.id === downloading());
    const here = all.find((b) => states.get(b.id) === 'ready');
    const half = all.find((b) => states.get(b.id) === 'partial');
    stateLine(
      card,
      using
        ? `در حال استفاده${all.length > 1 ? ` (${using.light ? 'سبک' : 'کامل'})` : ''}`
        : getting && progress
          ? `در حال دانلود · ${fmtNum(Math.floor((progress.loaded / progress.total) * 100))}٪`
          : getting
            ? 'در حال دانلود…'
            : here
              ? 'دانلود شده'
              : half
                ? 'دانلود نیمه‌کاره'
                : '',
      !!using,
    );

    const go = $<HTMLButtonElement>('[data-vo-go]', card)!;
    const label = $('[data-vo-go-label]', card)!;
    go.hidden = now === v.id;
    go.classList.toggle('primary', !busy);
    label.textContent = busy ? 'لغو دانلود' : state === 'ready' ? 'استفاده از این صدا' : state === 'partial' ? 'ادامه‌ی دانلود' : `دانلود ${card.dataset.missing ? `(${card.dataset.missing} مگابایت)` : ''}`;
    $('.i', go)?.toggleAttribute('hidden', busy || state === 'ready');
    $('[data-vo-remove]', card)!.hidden = busy || state === 'none';
    $('[data-vo-progress]', card)!.hidden = !busy;
    const msg = errors.get(v.family);
    let err = $('[data-vo-err]', card);
    if (msg && !err) {
      err = Object.assign(document.createElement('p'), { className: 'voice-msg' });
      err.dataset.voErr = '';
      $('.vo-actions', card)!.before(err);
    }
    if (err) err.textContent = msg ?? '';
  }
  const stored = storedBytes();
  const line = $('[data-voice-stored]', dlg)!;
  line.hidden = !stored;
  line.textContent = `صداهای دانلودشده ${mb(stored)} مگابایت از فضای این دستگاه را گرفته‌اند.`;
  $('[data-voice-listen]', dlg)!.hidden = !then || !hasPersianVoice();
  $('[data-voice-later]', dlg)!.textContent = then && !hasPersianVoice() ? 'بعداً' : 'بستن';
}

function stateLine(card: HTMLElement, text: string, on: boolean) {
  const el = $('[data-vo-state]', card)!;
  el.textContent = text;
  el.classList.toggle('on', on);
}

/** Opens one card (closing the others): its details, with the size of what it would download. */
async function expand(card: HTMLElement | null) {
  if (!dlg) return;
  for (const c of [...cards(), $('[data-vo-system]', dlg)!]) {
    const open = c === card;
    $('.vo-toggle', c)!.setAttribute('aria-expanded', String(open));
    $('.vo-body', c)!.hidden = !open;
    c.classList.toggle('open', open);
  }
  if (card?.dataset.vo) {
    // What another voice already brought (the runtime) isn't downloaded again.
    card.dataset.missing = mb(await missingBytes(picked(card)));
    render();
  }
}

const cardOf = (id: string | null | undefined) => (id ? cards().find((c) => c.dataset.vo === voiceById(id)?.family) : undefined);

/** Opens the sheet; `after` runs from the tap on «گوش دادن» once there is a voice. */
export async function openVoice(after?: () => void) {
  if (!dlg) return;
  then = after ?? null;
  if (!dlg.open) dlg.showModal();
  const msg = $('[data-voice-msg]', dlg)!;
  msg.textContent = '';
  await persianVoice();
  system = systemVoice();
  $('[data-voice-list]', dlg)!.hidden = !voiceSupported();
  if (!voiceSupported()) msg.textContent = 'این مرورگر نمی‌تواند صدا را روی دستگاه بسازد؛ مرورگر را به‌روز کنید.';
  await refresh();
  // The card to start from: the download under way, the voice in use, the one picked before, or the recommended one.
  const id = downloading() ?? speaking() ?? chosenVoice();
  const card = id === 'system' ? $('[data-vo-system]', dlg) : (cardOf(id) ?? (system ? null : cardOf(VOICES.find((v) => v.recommended)?.id)));
  if (card?.dataset.vo && id && id !== 'system') {
    const radio = $<HTMLInputElement>(`input[value="${id}"]`, card);
    if (radio) radio.checked = true;
  }
  await expand(card ?? null);
  render();
}
// ---------- download ----------
// The download's speed, smoothed over the last seconds, for "about N minutes left".
let pace = { at: 0, loaded: 0, rate: 0 };
function timeLeft(loaded: number, total: number) {
  const now = performance.now();
  if (!pace.at) pace = { at: now, loaded, rate: 0 };
  else if (now - pace.at >= 1000) {
    const rate = (loaded - pace.loaded) / ((now - pace.at) / 1000);
    pace = { at: now, loaded, rate: pace.rate ? pace.rate * 0.7 + rate * 0.3 : rate };
  }
  const s = pace.rate > 0 ? (total - loaded) / pace.rate : 0;
  return !s ? '' : s < 60 ? ' · کمتر از یک دقیقه مانده' : ` · حدود ${fmtNum(Math.ceil(s / 60))} دقیقه مانده`;
}

function showProgress(id: string, loaded: number, total: number) {
  progress = { id, loaded, total };
  const card = cardOf(id);
  if (card && dlg?.open) {
    const pct = total ? Math.floor((loaded / total) * 100) : 100;
    $<HTMLProgressElement>('progress', card)!.value = pct;
    $('[data-vo-pct]', card)!.textContent = `${mb(loaded)} از ${mb(total)} مگابایت · ${fmtNum(pct)}٪${timeLeft(loaded, total)}`;
    const line = $('[data-vo-state]', card)!;
    if (!line.classList.contains('on')) line.textContent = `در حال دانلود · ${fmtNum(pct)}٪`;
  }
  settingsLine();
}

/** Downloads a voice in the background and makes it the one that reads. `quiet`: resuming one the reader started on an
 *  earlier page — no questions, no messages unless it completes. */
async function startDownload(voice: Voice, quiet = false) {
  const other = downloading();
  if (other === voice.id) return;
  if (other && !quiet && !confirm(`دانلود «${voiceById(other)!.name}» متوقف شود و این یکی شروع شود؟ آن یکی بعداً از همان‌جا ادامه پیدا می‌کند.`)) return;
  const need = await missingBytes(voice);
  if (!(await voiceFits(need))) {
    errors.set(voice.family, 'فضای خالی دستگاه کافی نیست.');
    return render();
  }
  errors.delete(voice.family);
  store.set('voice-dl', voice.id);
  pace = { at: 0, loaded: 0, rate: 0 };
  progress = { id: voice.id, loaded: 0, total: need };
  const job = downloadVoice(voice.id, (loaded, total) => showProgress(voice.id, loaded, total));
  render();
  settingsLine();
  // The download only runs while the page is open: keep the screen awake meanwhile, where the browser allows it.
  const lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').catch(() => null);
  try {
    await job;
    store.set('voice-dl', '');
    store.set('voice-had', true);
    chooseVoice(voice.id);
    toast(`صدای «${voice.name}» آماده شد و از این به بعد خبرها را می‌خواند`, 'reward');
  } catch (e) {
    const why = (e as Error).message;
    // Cut by leaving the page: the next page goes on with it. Stopped by the reader: it stays half-done.
    if (why === 'closed') return;
    if (why !== 'cancelled' && why !== 'corrupt' && why !== 'crashed' && navigator.onLine) store.set('voice-dl', voice.id);
    else store.set('voice-dl', '');
    if (why !== 'cancelled' && !quiet)
      errors.set(
        voice.family,
        why === 'corrupt'
          ? 'فایل دریافت‌شده سالم نبود و پاک شد؛ دوباره امتحان کنید.'
          : why === 'crashed'
            ? 'مرورگر وسط کار متوقف شد؛ صفحه را دوباره باز کنید و ادامه دهید.'
            : 'اتصال قطع شد. اینترنت را بررسی کنید و دوباره بزنید — دانلود از همان‌جا ادامه پیدا می‌کند.',
      );
  } finally {
    if (progress?.id === voice.id) progress = null;
    lock?.release().catch(() => {});
    await refresh();
    settingsLine();
  }
}

/** A download the reader started on an earlier page (or before the page went into the back cache) goes on. */
function resume() {
  const voice = voiceById(store.get('voice-dl', ''));
  if (!voice || downloading() || !voiceSupported() || !navigator.onLine) return;
  voiceStates().then((s) => (s.get(voice.id) === 'ready' ? store.set('voice-dl', '') : startDownload(voice, true)));
}

// ---------- the preview of each voice ----------
const sample = new Audio();
sample.preload = 'none';
let sampleBtn: HTMLButtonElement | null = null;
function stopSample() {
  sample.pause();
  sampleBtn?.setAttribute('aria-pressed', 'false');
  sampleBtn = null;
}
sample.addEventListener('ended', stopSample);
sample.addEventListener('error', () => {
  if (!sampleBtn) return;
  stopSample();
  toast('نمونه‌ی صدا باز نشد؛ اتصال را بررسی کنید');
});

// ---------- settings: a line about the voice, and a button to the sheet ----------
async function settingsLine() {
  const row = $('[data-voice-settings]');
  if (!row) return;
  const source = await persianVoice();
  if (!source && !voiceSupported()) return;
  row.hidden = false;
  const local = activeVoice();
  const getting = voiceById(downloading());
  const pct = progress && getting && progress.total ? `${fmtNum(Math.floor((progress.loaded / progress.total) * 100))}٪` : '';
  $('[data-voice-status]', row)!.textContent = getting
    ? `در حال دانلود «${getting.name}» ${pct}`
    : source === 'local' && local
      ? `«${local.name}»، روی همین دستگاه`
      : source === 'device'
        ? 'صدای فارسی خود دستگاه'
        : source === 'cloud'
          ? 'صدای فارسی از سرور خبر'
          : [...states.values()].includes('partial')
            ? 'دانلود صدا نیمه‌کاره مانده'
            : 'این دستگاه صدای فارسی ندارد';
  $('[data-voice-open]', row)!.textContent = source ? 'انتخاب صدا' : 'دانلود صدا';
}

export function initVoiceOffer() {
  $$('[data-open-settings]').forEach((b) => b.addEventListener('click', () => voiceStates().then((s) => ((states = s), settingsLine()))));
  $('[data-voice-open]')?.addEventListener('click', () => {
    $<HTMLDialogElement>('#settings')?.close();
    openVoice();
  });
  if (!dlg) return;

  dlg.addEventListener('click', async (e) => {
    const t = e.target as Element;
    const card = t.closest<HTMLElement>('.vo');
    const play = t.closest<HTMLButtonElement>('[data-vo-play]');
    if (play) {
      if (sampleBtn === play) return stopSample();
      stopSample();
      sampleBtn = play;
      play.setAttribute('aria-pressed', 'true');
      sample.src = play.dataset.voPlay!;
      sample.play().catch(() => stopSample());
      return;
    }
    if (t.closest('.vo-toggle') && card) return expand(card.classList.contains('open') ? null : card);
    if (t.closest('[data-vo-go]') && card) {
      if (card.hasAttribute('data-vo-system')) {
        chooseVoice('system');
        return refresh();
      }
      const v = picked(card);
      if (downloading() === v.id) return cancelDownload();
      if (states.get(v.id) === 'ready') {
        chooseVoice(v.id);
        toast(`از این به بعد «${v.name}» خبرها را می‌خواند`);
        return refresh();
      }
      return startDownload(v);
    }
    if (t.closest('[data-vo-remove]') && card) {
      const v = picked(card);
      if (!confirm(`صدای «${v.name}»${builds(card).length > 1 ? ` (${v.light ? 'سبک' : 'کامل'})` : ''} از این دستگاه پاک شود؟`)) return;
      await removeVoice(v.id);
      if (chosenVoice() === v.id) store.set('voice', '');
      if (store.get('voice-dl', '') === v.id) store.set('voice-dl', '');
      errors.delete(v.family);
      toast('صدا پاک شد');
      await refresh();
      card.dataset.missing = mb(await missingBytes(v));
      return render();
    }
    if (t.closest('[data-voice-listen]')) {
      dlg.close();
      // Still inside the tap: the audio may start.
      then?.();
      then = null;
    }
  });
  // Full or light: the card's buttons and size follow the build picked.
  dlg.addEventListener('change', async (e) => {
    const card = (e.target as Element).closest<HTMLElement>('[data-vo]');
    if (!card) return;
    card.dataset.missing = mb(await missingBytes(picked(card)));
    render();
  });
  dlg.addEventListener('close', () => {
    stopSample();
    if (!hasPersianVoice()) then = null;
  });

  // A download cut by going to another page goes on here, once the page has settled (pictures on a filtered connection
  // can hold "load" back for long: five seconds at most).
  if (store.get('voice-dl', '')) {
    const later = () => setTimeout(resume, 1500);
    if (document.readyState === 'complete') later();
    else Promise.race([new Promise((r) => addEventListener('load', r, { once: true })), new Promise((r) => setTimeout(r, 5000))]).then(later);
  }
  addEventListener('pageshow', (e) => e.persisted && resume());
  addEventListener('online', resume);
}
