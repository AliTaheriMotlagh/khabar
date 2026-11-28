// The English settings sheet's «Voice for Listen» row (src/components/Settings.astro `[data-en-voice]`): device voice
// or the downloaded one (src/scripts/en-voice.ts), its speaker, a preview (public/voices/en-<sid>.mp3, made by
// `node scripts/voices.mjs bench-en`), download with progress / cancel, remove. Loaded when the sheet first opens.
import { $, $$, BASE, toast } from './core';
import { EN_SPEAKERS } from '../lib/voices';
import { cancelEnDownload, chooseEnVoice, downloadEnVoice, enDownloading, enMissingBytes, enSpeaker, enVoiceOn, enVoiceState, enVoiceSupported, removeEnVoice } from './en-voice';

const mb = (n: number) => `${Math.max(1, Math.round(n / 1e6))} MB`;
let started = false;

export async function initEnVoiceRow() {
  const row = $('[data-en-voice]');
  if (!row || started || !enVoiceSupported()) return;
  started = true;
  row.hidden = false;
  const status = $('[data-env-status]', row)!;
  const dl = $<HTMLButtonElement>('[data-env-dl]', row)!;
  const cancel = $<HTMLButtonElement>('[data-env-cancel]', row)!;
  const rm = $<HTMLButtonElement>('[data-env-rm]', row)!;
  const bar = $<HTMLProgressElement>('[data-env-progress]', row)!;
  const src = $$<HTMLInputElement>('input[name="env-src"]', row);
  const speakers = $$<HTMLInputElement>('input[name="env-speaker"]', row);
  const changed = () => document.dispatchEvent(new Event('en-voice-change'));

  const paint = async () => {
    const state = await enVoiceState();
    const busy = enDownloading();
    const on = enVoiceOn();
    for (const r of src) {
      r.checked = r.value === (on ? 'kitten' : '');
      r.disabled = r.value === 'kitten' && state !== 'ready';
    }
    const sp = enSpeaker();
    for (const r of speakers) r.checked = +r.value === sp.sid;
    dl.hidden = state === 'ready' || busy;
    cancel.hidden = !busy;
    rm.hidden = state === 'none' || busy;
    bar.hidden = !busy;
    if (!busy && state !== 'ready') {
      const left = await enMissingBytes();
      dl.textContent = `${state === 'partial' ? 'Resume download' : 'Download'} (${mb(left)})`;
    }
    status.textContent = busy
      ? 'Downloading… you can keep reading.'
      : state === 'ready'
        ? on
          ? `A natural voice on this device reads: ${sp.name}.`
          : 'Downloaded. Pick “Natural” to use it.'
        : 'Your device’s own voice. A more natural one can be downloaded once and runs on this device.';
  };

  src.forEach((r) =>
    r.addEventListener('change', () => {
      chooseEnVoice(r.value === 'kitten');
      changed();
      void paint();
    }),
  );
  speakers.forEach((r) =>
    r.addEventListener('change', () => {
      chooseEnVoice(enVoiceOn(), +r.value);
      changed();
      void paint();
      play(+r.value);
    }),
  );
  let preview: HTMLAudioElement | null = null;
  const play = (sid: number) => {
    preview?.pause();
    preview = new Audio(`${BASE}/voices/en-${sid}.mp3`);
    void preview.play().catch(() => {});
  };
  $('[data-env-preview]', row)!.addEventListener('click', () => play(enSpeaker().sid));
  row.closest('dialog')?.addEventListener('close', () => preview?.pause());

  dl.addEventListener('click', async () => {
    const need = await enMissingBytes();
    const room = await navigator.storage?.estimate?.().catch(() => undefined);
    if (room?.quota != null && room.usage != null && room.quota - room.usage < need * 1.1) return toast('Not enough free space on this device');
    const run = downloadEnVoice((loaded, total) => {
      bar.max = total || 1;
      bar.value = loaded;
    });
    void paint();
    try {
      await run;
      chooseEnVoice(true);
      changed();
      toast('The natural voice is ready');
    } catch (e) {
      const why = (e as Error).message;
      if (why !== 'cancelled' && why !== 'closed') toast(why === 'corrupt' ? 'The download was damaged; try again' : 'The download stopped; try again to resume');
    }
    void paint();
  });
  cancel.addEventListener('click', () => {
    cancelEnDownload();
    void paint();
  });
  rm.addEventListener('click', async () => {
    await removeEnVoice();
    changed();
    void paint();
  });
  if (!EN_SPEAKERS.length) row.hidden = true;
  await paint();
}
