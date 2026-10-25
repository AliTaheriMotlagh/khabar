// "Listen" on a device without a Persian voice: the sheet in src/components/VoiceOffer.astro offers the on-device
// voice (src/scripts/voice.ts), shows the download, and once it's ready plays what the reader asked for — from a tap
// on its own button, because iOS only starts audio inside a tap. The settings sheet shows the voice's state too.
import { $, $$, fmtNum, store, toast } from './core';
import { persianVoice, hasPersianVoice } from './speech';
import { VOICE_MB, downloadVoice, removeVoice, voiceFits, voiceState, voiceSupported } from './voice';

const dlg = $<HTMLDialogElement>('#voice');
let then: (() => void) | null = null;
let downloading = false;

/** "Listen" makes sense here: there is a Persian voice, or one can be downloaded. */
export async function canListen() {
  return (await persianVoice()) !== null || voiceSupported();
}

/** For the tap on a "listen" button: plays at once when there is a voice, otherwise offers the download first. */
export function listenOr(play: () => void) {
  if (hasPersianVoice() || !dlg) return play();
  openVoice(play);
}

type View = 'none' | 'lost' | 'partial' | 'ready' | 'busy' | 'other' | 'error';
function show(view: View, msg = '') {
  if (!dlg) return;
  const go = $<HTMLButtonElement>('[data-voice-go]', dlg)!;
  const lead: Record<View, string> = {
    none: 'این دستگاه صدای فارسی ندارد. صدای فارسی را یک بار دانلود کنید تا خبرها و خلاصه‌ی روز را بشنوید.',
    // Downloaded before, gone now: the browser cleared it (private browsing keeps nothing between pages).
    lost: 'صدای فارسی که قبلاً دانلود کرده بودید را مرورگر پاک کرده — مثلاً در حالت مرور خصوصی چیزی نگه داشته نمی‌شود. دوباره دانلود کنید، یا در حالت عادی مرورگر باز کنید.',
    partial: 'دانلود صدای فارسی نیمه‌کاره مانده — از همان‌جا ادامه می‌دهد.',
    busy: 'در حال دانلود صدای فارسی… تا تمام شدن، این صفحه را باز نگه دارید.',
    ready: 'صدای فارسی روی این دستگاه آماده است.',
    other: 'این دستگاه خودش صدای فارسی دارد؛ دانلود لازم نیست.',
    error: 'دانلود صدای فارسی کامل نشد.',
  };
  const label: Record<View, string> = {
    none: `دانلود صدا (${fmtNum(VOICE_MB)} مگابایت)`,
    lost: `دانلود دوباره (${fmtNum(VOICE_MB)} مگابایت)`,
    partial: 'ادامه‌ی دانلود',
    busy: 'در حال دانلود…',
    ready: then ? 'گوش دادن' : 'تمام',
    other: 'تمام',
    error: 'دوباره امتحان کنید',
  };
  dlg.dataset.view = view;
  $('[data-voice-mb]', dlg)!.textContent = fmtNum(VOICE_MB);
  $('[data-voice-lead]', dlg)!.textContent = lead[view];
  $('[data-voice-go-label]', dlg)!.textContent = label[view];
  go.disabled = view === 'busy';
  $('[data-voice-progress]', dlg)!.hidden = view !== 'busy';
  $('[data-voice-remove]', dlg)!.hidden = view !== 'ready' && view !== 'partial' && view !== 'error';
  $('[data-voice-later]', dlg)!.hidden = view === 'ready' || view === 'other';
  $('[data-voice-msg]', dlg)!.textContent = msg;
}

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

function showProgress(loaded: number, total: number) {
  if (!dlg) return;
  const pct = Math.floor((loaded / total) * 100);
  $<HTMLProgressElement>('progress', dlg)!.value = pct;
  $('[data-voice-pct]', dlg)!.textContent = `${fmtNum(Math.round(loaded / 1e6))} از ${fmtNum(Math.round(total / 1e6))} مگابایت · ${fmtNum(pct)}٪${timeLeft(loaded, total)}`;
}

/** Opens the sheet; `after` runs from the tap on «گوش دادن» once the voice is ready. */
export async function openVoice(after?: () => void) {
  if (!dlg) return;
  then = after ?? null;
  if (!dlg.open) dlg.showModal();
  if (downloading) return show('busy');
  const source = await persianVoice();
  if (source === 'device' || source === 'cloud') return show('other');
  if (!voiceSupported()) return show('error', 'این مرورگر نمی‌تواند صدا را روی دستگاه بسازد؛ مرورگر را به‌روز کنید.');
  const state = await voiceState();
  show(state === 'none' && store.get('voice-had', false) ? 'lost' : state);
}

async function startDownload() {
  if (downloading) return;
  if (!(await voiceFits())) return show('error', 'فضای خالی دستگاه کافی نیست.');
  downloading = true;
  pace = { at: 0, loaded: 0, rate: 0 };
  show('busy');
  // The download only runs while the page is open: keep the screen awake meanwhile, where the browser allows it.
  const lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').catch(() => null);
  try {
    await downloadVoice(showProgress);
    store.set('voice-had', true);
    show('ready');
    if (!dlg?.open) toast('صدای فارسی آماده شد — حالا «گوش دادن» را بزنید');
  } catch (e) {
    const why = (e as Error).message;
    show(
      'error',
      why === 'corrupt'
        ? 'فایل دریافت‌شده سالم نبود و پاک شد؛ دوباره امتحان کنید.'
        : why === 'crashed'
          ? 'مرورگر وسط کار متوقف شد؛ صفحه را دوباره باز کنید و ادامه دهید.'
          : 'اتصال قطع شد. اینترنت را بررسی کنید و دوباره بزنید — دانلود از همان‌جا ادامه پیدا می‌کند.',
    );
  } finally {
    downloading = false;
    lock?.release().catch(() => {});
  }
}

// ---------- settings: a line about the voice, and a button to the sheet ----------
async function refreshSettings() {
  const row = $('[data-voice-settings]');
  if (!row) return;
  const source = await persianVoice();
  const state = source === 'device' || source === 'cloud' ? null : await voiceState();
  if (!source && !voiceSupported()) return;
  row.hidden = false;
  $('[data-voice-status]', row)!.textContent =
    source === 'device'
      ? 'صدای فارسی خود دستگاه'
      : source === 'cloud'
        ? 'صدای فارسی از سرور خبر'
        : state === 'ready'
          ? `صدای فارسی روی این دستگاه نصب است (${fmtNum(VOICE_MB)} مگابایت)`
          : state === 'partial'
            ? 'دانلود صدا نیمه‌کاره مانده'
            : 'این دستگاه صدای فارسی ندارد';
  $('[data-voice-open]', row)!.textContent = state === 'ready' ? 'مدیریت' : state === 'partial' ? 'ادامه‌ی دانلود' : state === 'none' ? 'دانلود صدا' : 'جزئیات';
}

export function initVoiceOffer() {
  $$('[data-open-settings]').forEach((b) => b.addEventListener('click', refreshSettings));
  $('[data-voice-open]')?.addEventListener('click', () => {
    $<HTMLDialogElement>('#settings')?.close();
    openVoice();
  });
  if (!dlg) return;
  $('[data-voice-go]', dlg)!.addEventListener('click', () => {
    const view = dlg.dataset.view as View;
    if (view === 'ready' || view === 'other') {
      dlg.close();
      // Still inside the tap: the audio may start.
      then?.();
      then = null;
      return;
    }
    startDownload();
  });
  $('[data-voice-remove]', dlg)!.addEventListener('click', async () => {
    if (downloading || !confirm('صدای فارسی از این دستگاه پاک شود؟')) return;
    await removeVoice();
    store.set('voice-had', false);
    toast('صدای فارسی پاک شد');
    show('none');
  });
  dlg.addEventListener('close', () => {
    if (dlg.dataset.view !== 'ready') then = null;
  });
}
