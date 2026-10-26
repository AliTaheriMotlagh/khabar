// The Persian voices a reader can download for «گوش دادن» on a device with no Persian voice of its own (every iPhone
// and iPad, most desktops): sherpa-onnx WebAssembly packages from the demos at
// https://jiangzhuo9357-sherpa-onnx-tts-demos.static.hf.space/ — run by src/scripts/voice.ts, picked in the sheet of
// src/components/VoiceOffer.astro. No imports: shared by the browser, tests/voices.test.mjs and scripts/voices.mjs.
// A package is [loader, glue, runtime, data]: the runtime (.wasm, 12 MB) and the glue are the same bytes in every
// package, so they are stored once (by SHA-256) and a second voice downloads only its own loader and data.
// Adding a voice: see scripts/voices.mjs. `rtf` and `gender` come from its `bench` (Node on an Apple M-series core, one
// thread, as in the browser worker — Chrome's worker measures within a few hundredths of it; a phone is two to four
// times slower; gender from the voice's pitch). Before this picker the site shipped Ganji alone, chosen on the site's
// own text: Whisper transcribed every voice, Matcha Khadijah best (4–6% characters wrong), Ganji next clearest (7–9%)
// and the fastest, with the smaller download. The int8 builds are half the download but speak about 1.5–1.8× slower.

export const REPO = 'datasets/jiangzhuo9357/sherpa-onnx-tts-models';
/** Every file is pinned to this revision and checked against its SHA-256, so a mirror can't serve anything else. */
export const REVISION = 'c17064a360099d72cf3973cfdaaddc46acf98bfb';
/** Where a package's files are: Hugging Face, then a mirror for networks where it is blocked. */
export const mirrors = (pkg: string) => [`https://huggingface.co/${REPO}/resolve/${REVISION}/wasm-${pkg}/`, `https://hf-mirror.com/${REPO}/resolve/${REVISION}/wasm-${pkg}/`];

export type VoiceFile = { name: string; size: number; sha256: string };
export type Voice = {
  /** The package's folder on Hugging Face, without "wasm-". Stored as the reader's choice: never rename one. */
  id: string;
  /** One speaker: its full and light builds share it, and its preview public/voices/<family>.mp3. */
  family: string;
  name: string;
  /** One line for the picker. */
  about: string;
  gender: 'زن' | 'مرد';
  /** The int8 build: about half the download, slower to speak. */
  light?: true;
  recommended?: true;
  /** Seconds of work per second of speech (see above): under 1 keeps ahead of the playback. */
  rtf: number;
  /** [loader, glue, runtime, data] — the order the worker reads them in. */
  files: VoiceFile[];
  /** sherpa-onnx's OfflineTts config; paths are inside the package's .data file. */
  config: unknown;
  /** Speaker number, for a model with several. */
  sid?: number;
};

const GLUE: VoiceFile = { name: 'sherpa-onnx-tts.js', size: 25933, sha256: '51c0523f16a864ec942409aa0fe6e80a581bfb54a492ed94ecbdce491f9e9a79' };
const WASM: VoiceFile = { name: 'sherpa-onnx-wasm-main-tts.wasm', size: 11903250, sha256: 'cfd3c816c2f02477c234b66f00af11cc500f45904956f7e44d86f81bf4fe41d5' };
const pack = (loader: [number, string], data: [number, string]): VoiceFile[] => [
  { name: 'sherpa-onnx-wasm-main-tts.js', size: loader[0], sha256: loader[1] },
  GLUE,
  WASM,
  { name: 'sherpa-onnx-wasm-main-tts.data', size: data[0], sha256: data[1] },
];
const tts = (model: object) => ({ offlineTtsModelConfig: { ...model, numThreads: 1, debug: 0, provider: 'cpu' }, ruleFsts: '', ruleFars: '', maxNumSentences: 1 });
const vits = (onnx: string) => tts({ offlineTtsVitsModelConfig: { model: `./${onnx}`, lexicon: '', tokens: './tokens.txt', dataDir: './espeak-ng-data', noiseScale: 0.667, noiseScaleW: 0.8, lengthScale: 1 } });
const matcha = () => tts({ offlineTtsMatchaModelConfig: { acousticModel: './model.onnx', vocoder: './vocos-22khz-univ.onnx', lexicon: '', tokens: './tokens.txt', dataDir: './espeak-ng-data', noiseScale: 0.667, lengthScale: 1 } });

/** In the picker's order: the recommended one first. */
export const VOICES: Voice[] = [
  {
    id: 'piper-fa-ganji-medium',
    family: 'ganji',
    name: 'گنجی',
    about: 'واضح و روان، و سریع؛ روی گوشی هم بی‌مکث می‌خواند',
    gender: 'مرد',
    recommended: true,
    rtf: 0.17,
    files: pack([119743, 'ebec9541e999ae99fb267ef40d527ac0f1e436bf5a0b55ec73b10eaae278a14a'], [81142978, 'e354f66cbd0c167b6e6f502c63628bcf4368f51767f22b5c621fdbdc55559c51']),
    config: vits('fa_IR-ganji-medium.onnx'),
  },
  {
    id: 'piper-fa-ganji-medium-int8',
    family: 'ganji',
    name: 'گنجی',
    about: 'واضح و روان، و سریع؛ روی گوشی هم بی‌مکث می‌خواند',
    gender: 'مرد',
    light: true,
    rtf: 0.3,
    files: pack([119743, '922127a5338db3e1bc2c08796a08f9f7b0900ecbf9afc7e89f18c01acaa399d7'], [36573501, 'd324602a63fcb44d6007323971ffcb4baff17943d68a7a04488770852fc88910']),
    config: vits('fa_IR-ganji-medium.onnx'),
  },
  {
    id: 'matcha-fa-en-khadijah',
    family: 'khadijah',
    name: 'خدیجه',
    about: 'واضح‌ترین تلفظ، فارسی و انگلیسی؛ ولی سنگین‌ترین دانلود و دیرتر آماده می‌شود',
    gender: 'زن',
    rtf: 0.27,
    files: pack([119722, 'fa99b531b803c541715502b2e0c7230b01e78c4f6684a75bcbaa8a9ab2e66e3f'], [146151530, 'e52e4334d5d4decbb5968ec43321db9d9019614abb4d4e8a0b12ecb712be2728']),
    config: matcha(),
  },
  {
    id: 'matcha-fa-en-musa',
    family: 'musa',
    name: 'موسی',
    about: 'هم‌خانواده‌ی خدیجه با صدای مرد، فارسی و انگلیسی؛ سنگین‌ترین دانلود',
    gender: 'مرد',
    rtf: 0.27,
    files: pack([119722, 'fa99b531b803c541715502b2e0c7230b01e78c4f6684a75bcbaa8a9ab2e66e3f'], [146151530, 'b012269e6f585bda9e006bb446753051ab9b26372b67ebcd8ba36a85087ad2a3']),
    config: matcha(),
  },
  {
    id: 'piper-fa-ganji_adabi-medium',
    family: 'ganji_adabi',
    name: 'گنجی ادبی',
    about: 'همان گوینده‌ی گنجی، با لحن کتاب‌خوانی',
    gender: 'مرد',
    rtf: 0.17,
    files: pack([119755, '978ef76c8015e91011e4f02da2a06cc712b656a95a96c60e1e9b82cafc1a0125'], [81142990, '13638be1c1cc6a2eb5930aa7bead633218ac59bd69950af6f991932fd863fa95']),
    config: vits('fa_IR-ganji_adabi-medium.onnx'),
  },
  {
    id: 'piper-fa-ganji_adabi-medium-int8',
    family: 'ganji_adabi',
    name: 'گنجی ادبی',
    about: 'همان گوینده‌ی گنجی، با لحن کتاب‌خوانی',
    gender: 'مرد',
    light: true,
    rtf: 0.31,
    files: pack([119755, '87e732fb6fbbe989db7fadca1ea1aef0a9ec6bd6a15a8dba367bd8e907b65599'], [36573512, '21983b03f9ca1c5620452f7cbf519a25dc2cce88fc27b340cc69a5692a56b11b']),
    config: vits('fa_IR-ganji_adabi-medium.onnx'),
  },
  {
    id: 'piper-fa-amir-medium',
    family: 'amir',
    name: 'امیر',
    about: 'صدای پایه‌ای که گنجی از آن ساخته شده',
    gender: 'مرد',
    rtf: 0.18,
    files: pack([119741, '2d90ec19e780400e9ec9e49b0bae1de10560f5582600f74c9215e7673a687cbf'], [81150783, '6eaef3f381f91e682bc9534e2c06d4ca2a219a0cdb7a3117461fde8dfd7be86c']),
    config: vits('fa_IR-amir-medium.onnx'),
  },
  {
    id: 'piper-fa-amir-medium-int8',
    family: 'amir',
    name: 'امیر',
    about: 'صدای پایه‌ای که گنجی از آن ساخته شده',
    gender: 'مرد',
    light: true,
    rtf: 0.33,
    files: pack([119741, 'd413620512b76ab54d31e67d0f9c0901174401b50fd40a1adc775515f87f3c14'], [36581299, 'f0808a0eb80912305f185f858676b99865de1238e2182c35886c61f55fa46c8c']),
    config: vits('fa_IR-amir-medium.onnx'),
  },
  {
    id: 'piper-fa-gyro-medium',
    family: 'gyro',
    name: 'ژیرو',
    about: 'یک صدای دیگر از همین خانواده (Piper)',
    gender: 'مرد',
    rtf: 0.17,
    files: pack([119741, 'a4aa3e543f507f015ebd0896e8bba2b1c79375cb781f87beea3e3b7cce1b7717'], [80949377, '1317fe0ea4c4fe246306fb48d7a0846a7a46f44cf9586afd2041cbf7a52bfa8e']),
    config: vits('fa_IR-gyro-medium.onnx'),
  },
  {
    id: 'piper-fa-gyro-medium-int8',
    family: 'gyro',
    name: 'ژیرو',
    about: 'یک صدای دیگر از همین خانواده (Piper)',
    gender: 'مرد',
    light: true,
    rtf: 0.35,
    files: pack([119741, 'e2827f3fc49b209d54a0f22ffa2515d9c7468018668b7e2524768c9d7a3664ad'], [36304677, '88efa9b4b7e2bab72f415479df977c48e70a748d7502f9a4e67fff55cbbef528']),
    config: vits('fa_IR-gyro-medium.onnx'),
  },
  {
    id: 'piper-fa-reza-medium',
    family: 'reza',
    name: 'رضا',
    about: 'آموخته از صدای یک قاری؛ لحن آرام و شمرده',
    gender: 'مرد',
    rtf: 0.18,
    files: pack([119757, '82cd54fdca277cc81c144b62c586bdb6699c4442b657565696c9ed31d31784f7'], [81151968, 'a53408fd65b023d9269a8794fe42cbad5db94e199386bae26efd0fc330cd65a1']),
    config: vits('fa_IR-reza_ibrahim-medium.onnx'),
  },
  {
    id: 'piper-fa-reza-medium-int8',
    family: 'reza',
    name: 'رضا',
    about: 'آموخته از صدای یک قاری؛ لحن آرام و شمرده',
    gender: 'مرد',
    light: true,
    rtf: 0.3,
    files: pack([119757, 'f31a722edcf72c5c66b6556a199fad818b6eec12600bc84082864e156a8eb991'], [36582496, 'c4a0be2a1e32ca9f734f2707730a0225a53570de619ea37fbad986c8eded6aa8']),
    config: vits('fa_IR-reza_ibrahim-medium.onnx'),
  },
  {
    id: 'piper-fa-en-rezahedayatfar-ibrahimwalk-medium',
    family: 'reza_en',
    name: 'رضا (دوزبانه)',
    about: 'همان رضا، که کلمه‌های انگلیسی را هم انگلیسی می‌خواند',
    gender: 'مرد',
    rtf: 0.19,
    files: pack([119909, 'f41625ee822a8c6fbdaba7e148a53be46a11ccc5cd1480ea5130b1528da28141'], [81515497, 'cd129a47274a4dd6d56759496933b3f2b6092a38a45248fb84845cb8e2b43931']),
    config: vits('fa_en-rezahedayatfar-ibrahimwalk-medium.onnx'),
  },
  {
    id: 'mimic3-fa-haaniye-low',
    family: 'haaniye',
    name: 'هانیه',
    about: 'مدل قدیمی‌تر (Mimic3) با کیفیت پایین‌تر',
    gender: 'زن',
    rtf: 0.17,
    files: pack([119860, 'd6a0eaaf61b82e6d0b2ce85654edbc79cab5384f8228dace217f812b505d8602'], [80782423, 'ae629322e12a2b8657194e5a120f3bcdf81ec0d849bde7d69d6f9d3215603c71']),
    config: vits('fa-haaniye_low.onnx'),
  },
];

/** The voice the site shipped before there was a choice: a reader who downloaded it keeps it. */
export const DEFAULT_VOICE = 'piper-fa-ganji-medium';
export const voiceById = (id: string | null | undefined) => VOICES.find((v) => v.id === id);
export const voiceBytes = (v: Voice) => v.files.reduce((s, f) => s + f.size, 0);
/** How it keeps up, for the picker: a phone is two to four times slower than the measured core, so `rtf` 0.2 is about
 *  half real time on a phone (the next sentence is ready before this one ends) and 0.35 is about real time. */
export const speedOf = (v: Voice) => (v.rtf <= 0.2 ? { label: 'سریع', slow: false } : v.rtf <= 0.35 ? { label: 'سرعت متوسط', slow: false } : { label: 'کند روی گوشی', slow: true });
/** The voices grouped by speaker, in the picker's order: the full build first. */
export function families(): Voice[][] {
  const out = new Map<string, Voice[]>();
  for (const v of VOICES) out.set(v.family, [...(out.get(v.family) ?? []), v]);
  return [...out.values()].map((g) => g.sort((a, b) => Number(!!a.light) - Number(!!b.light)));
}
