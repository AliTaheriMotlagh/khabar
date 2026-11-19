// Where a story came from, said well in any language: the publisher's name for an address, the language of a source's
// text (by its script, then common words for Latin-script languages), short readable links without tracking
// parameters, and a translate link for text that isn't Persian. No imports: shared by the build (SourceCard, SourceChip)
// and unit-tested from Node (tests/source.test.mjs).

/** Publishers by their domain (or a parent domain): the name readers know them by. */
const PUBLISHERS: Record<string, string> = {
  // news wires and papers
  'bloomberg.com': 'Bloomberg', 'reuters.com': 'Reuters', 'apnews.com': 'AP', 'nytimes.com': 'The New York Times',
  'wsj.com': 'The Wall Street Journal', 'ft.com': 'Financial Times', 'washingtonpost.com': 'The Washington Post',
  'theguardian.com': 'The Guardian', 'bbc.com': 'BBC', 'bbc.co.uk': 'BBC', 'cnn.com': 'CNN', 'cnbc.com': 'CNBC',
  'axios.com': 'Axios', 'theinformation.com': 'The Information', 'economist.com': 'The Economist', 'fortune.com': 'Fortune',
  'forbes.com': 'Forbes', 'businessinsider.com': 'Business Insider', 'semafor.com': 'Semafor', 'politico.com': 'Politico',
  'nbcnews.com': 'NBC News', 'cbsnews.com': 'CBS News', 'npr.org': 'NPR', 'time.com': 'TIME', 'theatlantic.com': 'The Atlantic',
  'newyorker.com': 'The New Yorker', 'latimes.com': 'Los Angeles Times', 'aljazeera.com': 'Al Jazeera', 'dw.com': 'DW',
  'france24.com': 'France 24', 'lemonde.fr': 'Le Monde', 'lefigaro.fr': 'Le Figaro', 'spiegel.de': 'Der Spiegel',
  'faz.net': 'FAZ', 'zeit.de': 'Die Zeit', 'handelsblatt.com': 'Handelsblatt', 'elpais.com': 'El País', 'corriere.it': 'Corriere della Sera',
  'nikkei.com': 'Nikkei', 'asia.nikkei.com': 'Nikkei Asia', 'japantimes.co.jp': 'The Japan Times', 'nhk.or.jp': 'NHK',
  'scmp.com': 'South China Morning Post', 'caixinglobal.com': 'Caixin', 'caixin.com': 'Caixin (财新)', '36kr.com': '36Kr (36氪)',
  'xinhuanet.com': 'Xinhua (新华社)', 'news.cn': 'Xinhua (新华社)', 'people.com.cn': "People's Daily (人民日报)", 'chinadaily.com.cn': 'China Daily',
  'globaltimes.cn': 'Global Times', 'sina.com.cn': 'Sina (新浪)', 'qq.com': 'Tencent (腾讯)', 'jiqizhixin.com': 'Synced (机器之心)',
  'yonhapnews.co.kr': 'Yonhap (연합뉴스)', 'koreaherald.com': 'The Korea Herald', 'koreatimes.co.kr': 'The Korea Times',
  'timesofindia.indiatimes.com': 'The Times of India', 'thehindu.com': 'The Hindu', 'livemint.com': 'Mint', 'economictimes.indiatimes.com': 'The Economic Times',
  'tass.com': 'TASS', 'rbc.ru': 'RBC', 'kommersant.ru': 'Kommersant', 'haaretz.com': 'Haaretz', 'timesofisrael.com': 'The Times of Israel',
  'arabnews.com': 'Arab News', 'thenationalnews.com': 'The National', 'bbc.com/persian': 'BBC فارسی', 'isna.ir': 'ایسنا', 'irna.ir': 'ایرنا',
  'zoomit.ir': 'زومیت', 'digiato.com': 'دیجیاتو',
  // tech press
  'techcrunch.com': 'TechCrunch', 'theverge.com': 'The Verge', 'wired.com': 'WIRED', 'arstechnica.com': 'Ars Technica',
  'venturebeat.com': 'VentureBeat', 'engadget.com': 'Engadget', 'zdnet.com': 'ZDNET', 'cnet.com': 'CNET', 'gizmodo.com': 'Gizmodo',
  'technologyreview.com': 'MIT Technology Review', 'theregister.com': 'The Register', 'tomshardware.com': "Tom's Hardware",
  '9to5mac.com': '9to5Mac', '9to5google.com': '9to5Google', 'macrumors.com': 'MacRumors', 'androidauthority.com': 'Android Authority',
  'theinformation.co': 'The Information', 'platformer.news': 'Platformer', 'stratechery.com': 'Stratechery', 'semianalysis.com': 'SemiAnalysis',
  'restofworld.org': 'Rest of World', 'protocol.com': 'Protocol', 'siliconangle.com': 'SiliconANGLE', 'the-decoder.com': 'The Decoder',
  'heise.de': 'heise', 'golem.de': 'Golem', 'nature.com': 'Nature', 'science.org': 'Science', 'newscientist.com': 'New Scientist',
  'ieee.org': 'IEEE', 'spectrum.ieee.org': 'IEEE Spectrum', 'quantamagazine.org': 'Quanta Magazine',
  // companies and labs
  'openai.com': 'OpenAI', 'anthropic.com': 'Anthropic', 'claude.com': 'Anthropic', 'claude.ai': 'Anthropic', 'deepmind.google': 'Google DeepMind',
  'deepmind.com': 'Google DeepMind', 'blog.google': 'Google', 'google.com': 'Google', 'research.google': 'Google Research',
  'ai.google.dev': 'Google AI', 'microsoft.com': 'Microsoft', 'microsoft.ai': 'Microsoft AI', 'meta.com': 'Meta', 'ai.meta.com': 'Meta AI',
  'about.fb.com': 'Meta', 'apple.com': 'Apple', 'nvidia.com': 'NVIDIA', 'nvidianews.nvidia.com': 'NVIDIA', 'amazon.com': 'Amazon',
  'aboutamazon.com': 'Amazon', 'aws.amazon.com': 'AWS', 'x.ai': 'xAI', 'mistral.ai': 'Mistral AI', 'cohere.com': 'Cohere',
  'huggingface.co': 'Hugging Face', 'perplexity.ai': 'Perplexity', 'deepseek.com': 'DeepSeek', 'qwenlm.github.io': 'Qwen',
  'qwen.ai': 'Qwen', 'alibabacloud.com': 'Alibaba Cloud', 'moonshot.ai': 'Moonshot AI', 'kimi.com': 'Kimi', 'z.ai': 'Zhipu (Z.ai)',
  'bytedance.com': 'ByteDance', 'tesla.com': 'Tesla', 'spacex.com': 'SpaceX', 'waymo.com': 'Waymo', 'figure.ai': 'Figure',
  'thinkingmachines.ai': 'Thinking Machines', 'ssi.inc': 'SSI', 'cursor.com': 'Cursor', 'github.blog': 'GitHub', 'github.com': 'GitHub',
  'stability.ai': 'Stability AI', 'runwayml.com': 'Runway', 'elevenlabs.io': 'ElevenLabs', 'samsung.com': 'Samsung', 'intel.com': 'Intel',
  'amd.com': 'AMD', 'qualcomm.com': 'Qualcomm', 'arm.com': 'Arm', 'tsmc.com': 'TSMC', 'ibm.com': 'IBM', 'oracle.com': 'Oracle',
  'salesforce.com': 'Salesforce', 'mehrzad.ai': 'mehrzad.ai',
  // papers, code, video, posts
  'arxiv.org': 'arXiv', 'openreview.net': 'OpenReview', 'paperswithcode.com': 'Papers with Code', 'substack.com': 'Substack',
  'medium.com': 'Medium', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'x.com': 'X', 'twitter.com': 'X', 'fxtwitter.com': 'X', 'fixupx.com': 'X', 'threads.net': 'Threads',
  'linkedin.com': 'LinkedIn', 'reddit.com': 'Reddit', 'news.ycombinator.com': 'Hacker News', 'wikipedia.org': 'Wikipedia',
  // publishers' own short links
  'nyti.ms': 'The New York Times', 'wapo.st': 'The Washington Post', 'reut.rs': 'Reuters', 'bloom.bg': 'Bloomberg',
  'on.ft.com': 'Financial Times', 'econ.st': 'The Economist', 'tcrn.ch': 'TechCrunch', 'engt.co': 'Engadget', 'wrd.cm': 'WIRED',
  'cnb.cx': 'CNBC', 'n.pr': 'NPR', 'cnn.it': 'CNN', 'bbc.in': 'BBC', 'on.wsj.com': 'The Wall Street Journal', 'apple.co': 'Apple',
  'msft.it': 'Microsoft', 'goo.gle': 'Google', 'nvda.ws': 'NVIDIA', 'aka.ms': 'Microsoft', 'fb.me': 'Meta', 'amzn.to': 'Amazon',
};
// Link shorteners anyone uses: they say nothing about the source (SourceCard names the tweet's author instead).
const SHORTENER = /^(bit\.ly|bitly\.com|spr\.ly|buff\.ly|ow\.ly|dlvr\.it|trib\.al|lnkd\.in|tinyurl\.com|goo\.gl|t\.ly|rb\.gy|shorturl\.at|is\.gd|bit\.do|ift\.tt|hubs\.(ly|la)|cutt\.ly|tiny\.cc|shrtm\.nu|social\.[\w-]+\.com|link\.[\w-]+\.com)$/;
/** An address on a generic link shortener (bit.ly, spr.ly…). */
export const isShortener = (url: string) => SHORTENER.test(hostOf(url));

/** The host of an address without "www." (and m./mobile.), lower case; '' when it isn't one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www\d?|m|mobile|amp)\./, '');
  } catch {
    return '';
  }
}

/** The publisher's name for an address or a domain, else the domain itself (or '' for nothing usable). */
export function publisherOf(urlOrDomain: string | null | undefined): string {
  if (!urlOrDomain) return '';
  const host = /^[a-z]+:\/\//i.test(urlOrDomain) ? hostOf(urlOrDomain) : urlOrDomain.toLowerCase().replace(/^(www\d?|m|mobile)\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return '';
  if (/^bbc\.(com|co\.uk)$/.test(host) && /\/persian\b/.test(urlOrDomain)) return 'BBC فارسی';
  if (PUBLISHERS[host]) return PUBLISHERS[host];
  // A Substack/Medium/GitHub Pages site: its own name is the first label.
  const sub = host.match(/^([\w-]+)\.(substack\.com|medium\.com|github\.io)$/);
  if (sub) return sub[1];
  // each parent domain: news.example.co.uk → example.co.uk → co.uk (never a bare TLD)
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const name = PUBLISHERS[parts.slice(i).join('.')];
    if (name) return name;
  }
  return host;
}

export type Lang = { code: string; fa: string };
const LANGS: Record<string, string> = {
  fa: 'فارسی', en: 'انگلیسی', ar: 'عربی', zh: 'چینی', ja: 'ژاپنی', ko: 'کره‌ای', ru: 'روسی', uk: 'اوکراینی', he: 'عبری',
  hi: 'هندی', th: 'تایلندی', el: 'یونانی', fr: 'فرانسوی', de: 'آلمانی', es: 'اسپانیایی', it: 'ایتالیایی', pt: 'پرتغالی',
  tr: 'ترکی', nl: 'هلندی', vi: 'ویتنامی', id: 'اندونزیایی', pl: 'لهستانی', ur: 'اردو',
};
// Common short words of Latin-script languages (whole words, lower case). English is the default when none stands out.
const WORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'for', 'with', 'that', 'this', 'on', 'are', 'it', 'by', 'from', 'we', 'has', 'have', 'new'],
  fr: ['le', 'la', 'les', 'des', 'est', 'une', 'pour', 'avec', 'dans', 'qui', 'sur', 'pas', 'du', 'au', 'et', 'nous', 'sont'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'ein', 'eine', 'auf', 'für', 'von', 'zu', 'den', 'wir', 'sich', 'auch'],
  es: ['el', 'los', 'las', 'una', 'para', 'con', 'por', 'que', 'del', 'es', 'en', 'y', 'como', 'más', 'pero', 'sus', 'está'],
  it: ['il', 'gli', 'della', 'per', 'che', 'una', 'sono', 'non', 'di', 'del', 'con', 'è', 'le', 'questo', 'anche', 'più'],
  pt: ['não', 'uma', 'com', 'para', 'dos', 'das', 'que', 'os', 'as', 'por', 'mais', 'como', 'está', 'também', 'ao', 'é'],
  tr: ['ve', 'bir', 'için', 'ile', 'bu', 'da', 'de', 'çok', 'olarak', 'daha', 'gibi', 'yeni', 'ama', 'olan'],
  nl: ['het', 'een', 'van', 'en', 'niet', 'met', 'voor', 'zijn', 'ook', 'naar', 'maar', 'wordt', 'bij', 'dat'],
  id: ['yang', 'dan', 'di', 'ini', 'untuk', 'dengan', 'dari', 'tidak', 'akan', 'pada', 'juga', 'kami', 'adalah'],
  vi: ['của', 'và', 'là', 'các', 'có', 'được', 'cho', 'trong', 'những', 'với', 'không', 'này', 'một'],
  pl: ['nie', 'się', 'jest', 'że', 'na', 'do', 'oraz', 'jak', 'dla', 'ale', 'czy', 'przez', 'został'],
};

/** The language of a text, by its letters (and for Latin letters, its common words). null for too little text. */
export function langOf(text: string | null | undefined): Lang | null {
  const s = (text ?? '').replace(/https?:\/\/\S+/g, ' ').replace(/[@#][\w.]+/g, ' ');
  const count = (re: RegExp) => (s.match(re) ?? []).length;
  const letters = count(/\p{L}/gu);
  if (letters < 14) return null;
  const pick = (code: string): Lang => ({ code, fa: LANGS[code] });
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = count(/\p{Script=Han}/gu);
  const scripts: [string, number][] = [
    ['ja', kana ? kana + han : 0],
    ['zh', kana ? 0 : han * 2], // one Han character carries a word's worth
    ['ko', count(/\p{Script=Hangul}/gu)],
    ['ru', count(/\p{Script=Cyrillic}/gu)],
    ['he', count(/\p{Script=Hebrew}/gu)],
    ['hi', count(/\p{Script=Devanagari}/gu)],
    ['th', count(/\p{Script=Thai}/gu)],
    ['el', count(/\p{Script=Greek}/gu)],
    ['arabic', count(/\p{Script=Arabic}/gu)],
    ['latin', count(/\p{Script=Latin}/gu)],
  ];
  const [top] = scripts.sort((a, b) => b[1] - a[1])[0];
  if (top === 'arabic') {
    // Persian has its own letters; Urdu its own too; otherwise Arabic.
    if (count(/[ٹڈڑںھےۓ]/g) >= 2) return pick('ur');
    return count(/[پچژگکی]/g) >= 2 ? pick('fa') : pick('ar');
  }
  if (top === 'ru') return count(/[іїєґ]/gi) >= 2 ? pick('uk') : pick('ru');
  if (top !== 'latin') return pick(top);
  const words = s.toLowerCase().match(/\p{L}+/gu) ?? [];
  let best = 'en';
  let bestScore = 0;
  for (const [code, list] of Object.entries(WORDS)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length / Math.max(words.length, 1);
    if (score > bestScore + (code === 'en' ? 0 : 0.02)) {
      best = code;
      bestScore = score;
    }
  }
  return pick(bestScore > 0.04 ? best : 'en');
}

const TRACKING = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src|ref_url|taid|cmpid|smid|mbid|ncid|guccounter|_hsenc|_hsmi|sr_share)$/i;
// Short names that only track on these hosts (YouTube's ?t= is a time and stays).
const TRACKING_ON: [RegExp, RegExp][] = [
  [/(^|\.)(x\.com|twitter\.com|fxtwitter\.com|fixupx\.com)$/, /^(s|t|a|ref)$/],
  [/(^|\.)(youtube\.com|youtu\.be)$/, /^(si|feature|pp)$/],
  [/(^|\.)(instagram\.com|threads\.net)$/, /^(igsh|img_index)$/],
];
/** An address without tracking parameters (utm_*, taid, X's ?s=&t=…); unchanged when it can't be parsed. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    const local = TRACKING_ON.find(([host]) => host.test(u.hostname))?.[1];
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k) || local?.test(k)) u.searchParams.delete(k);
    u.hash = /^#?(:~:|xtor|utm)/.test(u.hash) ? '' : u.hash;
    return u.toString().replace(/\?$/, '');
  } catch {
    return url;
  }
}

/** A short form of an address to show: host + the start of its path, e.g. «bloomberg.com/news/articles/2026-11…». */
export function shortUrl(url: string, max = 38): string {
  try {
    const u = new URL(cleanUrl(url));
    const host = u.hostname.replace(/^www\./, '');
    const rest = decodeURIComponent(u.pathname + u.search).replace(/\/$/, '');
    const s = host + rest;
    return s.length <= max ? s : s.slice(0, max - 1).replace(/[/?&=._-]+$/, '') + '…';
  } catch {
    return url.length <= max ? url : url.slice(0, max - 1) + '…';
  }
}

const SOCIAL = /(^|\.)(x\.com|twitter\.com|t\.co|fxtwitter\.com|fixupx\.com|vxtwitter\.com|nitter\.\w+)$/;
/** The addresses a tweet cites (outside X), cleaned and without repeats: often the article the news is from. */
export function citedLinks(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(/https?:\/\/[^\s<>"'«»]+/g)) {
    const raw = m[0].replace(/[),.;:!?،؛»]+$/, '');
    if (raw.endsWith('…')) continue; // cut off by the text it was in
    const host = hostOf(raw);
    if (!host || SOCIAL.test(host)) continue;
    const url = cleanUrl(raw);
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** A link that opens the text translated into Persian (Google Translate; null for Persian or too little text). */
export function translateUrl(text: string | null | undefined, lang = langOf(text)): string | null {
  if (!text || !lang || lang.code === 'fa') return null;
  const t = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 1800);
  return t.length < 8 ? null : `https://translate.google.com/?sl=auto&tl=fa&op=translate&text=${encodeURIComponent(t)}`;
}
