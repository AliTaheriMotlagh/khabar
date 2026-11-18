// English words in Persian letters, for the voices that only read Persian (the downloaded ones: sherpa-onnx's, and
// Cilla Mini, whose front end drops every non-Persian letter). Used by server/_say.js after the lexicon (data/lexicon.json,
// the model's spellings, which win): a word the lexicon doesn't know is said from this file's own list of the news'
// usual names, as letters when it's an acronym (LLM → ال‌ال‌ام), or by spelling rules. Every word gives exactly one
// word (its parts joined by a zero-width non-joiner), so the word highlight keeps its place. Plain JS, no imports.

const Z = '‌';

/** How the news' usual names are said (lowercase keys). The lexicon overrides any of them. */
const KNOWN = {
  ai: 'ای‌آی', agi: 'ای‌جی‌آی', api: 'ای‌پی‌آی', apis: 'ای‌پی‌آی‌ها', gpt: 'جی‌پی‌تی', chatgpt: 'چت‌جی‌پی‌تی', openai: 'اوپن‌ای‌آی',
  anthropic: 'آنتروپیک', claude: 'کلود', google: 'گوگل', gemini: 'جمینای', deepmind: 'دیپ‌مایند', gemma: 'جما', meta: 'متا',
  llama: 'لاما', microsoft: 'مایکروسافت', copilot: 'کوپایلت', apple: 'اپل', nvidia: 'انویدیا', amd: 'ای‌ام‌دی', intel: 'اینتل',
  tesla: 'تسلا', xai: 'ایکس‌ای‌آی', grok: 'گراک', mistral: 'میسترال', qwen: 'کوئن', deepseek: 'دیپ‌سیک', alibaba: 'علی‌بابا',
  huggingface: 'هاگینگ‌فیس', hugging: 'هاگینگ', face: 'فیس', github: 'گیت‌هاب', python: 'پایتون', javascript: 'جاوااسکریپت',
  cursor: 'کرسر', sora: 'سورا', veo: 'ویو', midjourney: 'میدجرنی', perplexity: 'پرپلکسیتی', amazon: 'آمازون', aws: 'ای‌دبلیو‌اس',
  samsung: 'سامسونگ', huawei: 'هواوی', baidu: 'بایدو', bytedance: 'بایت‌دنس', tiktok: 'تیک‌تاک', twitter: 'توییتر', x: 'ایکس',
  elon: 'ایلان', musk: 'ماسک', sam: 'سم', altman: 'آلتمن', dario: 'داریو', amodei: 'آمودی', sundar: 'ساندار', pichai: 'پیچای',
  satya: 'ساتیا', nadella: 'نادلا', jensen: 'جنسن', huang: 'هوانگ', mark: 'مارک', zuckerberg: 'زاکربرگ', demis: 'دمیس',
  hassabis: 'حسابیس', karpathy: 'کارپاتی', andrej: 'آندری', ilya: 'ایلیا', sutskever: 'سوتسکور', yann: 'یان', lecun: 'لکان',
  iphone: 'آیفون', ipad: 'آیپد', android: 'اندروید', windows: 'ویندوز', linux: 'لینوکس', chrome: 'کروم', youtube: 'یوتیوب',
  telegram: 'تلگرام', whatsapp: 'واتس‌اپ', instagram: 'اینستاگرام', facebook: 'فیسبوک', reddit: 'ردیت', wikipedia: 'ویکی‌پدیا',
  stanford: 'استنفورد', mit: 'ام‌آی‌تی', berkeley: 'برکلی', harvard: 'هاروارد', arxiv: 'آرکایو', benchmark: 'بنچمارک',
  token: 'توکن', tokens: 'توکن‌ها', chip: 'چیپ', gpu: 'جی‌پی‌یو', gpus: 'جی‌پی‌یوها', cpu: 'سی‌پی‌یو', tpu: 'تی‌پی‌یو',
  npu: 'ان‌پی‌یو', cloud: 'کلاد', beta: 'بتا', pro: 'پرو', max: 'مکس', mini: 'مینی', ultra: 'اولترا', flash: 'فلش', nano: 'نانو',
  plus: 'پلاس', turbo: 'توربو', lite: 'لایت', vision: 'ویژن', voice: 'ویس', studio: 'استودیو', lab: 'لب', labs: 'لبز',
  app: 'اپ', apps: 'اپ‌ها', web: 'وب', browser: 'براوزر', search: 'سرچ', data: 'دیتا', server: 'سرور', code: 'کد', codex: 'کودکس',
  agent: 'ایجنت', agents: 'ایجنت‌ها', agentic: 'ایجنتیک', model: 'مدل', models: 'مدل‌ها', open: 'اوپن', source: 'سورس',
  robot: 'ربات', robots: 'ربات‌ها', robotics: 'رباتیک', transformer: 'ترنسفورمر', diffusion: 'دیفیوژن', reasoning: 'ریزنینگ',
  the: 'د', of: 'آو', and: 'اند', for: 'فور', with: 'ویت', in: 'این', on: 'آن', to: 'تو', is: 'ایز', by: 'بای', new: 'نیو',
  one: 'وان', two: 'تو', three: 'تری', four: 'فور', five: 'فایو', next: 'نکست', first: 'فرست', world: 'ورلد', image: 'ایمیج',
  video: 'ویدیو', audio: 'آدیو', music: 'موزیک', chat: 'چت', bot: 'بات', mode: 'مود', deep: 'دیپ', research: 'ریسرچ',
  learning: 'لرنینگ', machine: 'ماشین', neural: 'نورال', network: 'نتورک', language: 'لنگوییج', large: 'لارج', small: 'اسمال',
  edge: 'اج', home: 'هوم', phone: 'فون', watch: 'واچ', glass: 'گلس', glasses: 'گلسز', pixel: 'پیکسل', galaxy: 'گلکسی',
  netflix: 'نتفلیکس', spotify: 'اسپاتیفای', uber: 'اوبر', airbnb: 'ایربی‌ان‌بی', salesforce: 'سیلزفورس', oracle: 'اوراکل',
  ibm: 'آی‌بی‌ام', tsmc: 'تی‌اس‌ام‌سی', arm: 'آرم', qualcomm: 'کوالکام', figure: 'فیگر', optimus: 'اپتیموس', waymo: 'ویمو',
  zoox: 'زوکس', neuralink: 'نورالینک', spacex: 'اسپیس‌ایکس', starlink: 'استارلینک', runway: 'ران‌وی', pika: 'پیکا',
  kling: 'کلینگ', suno: 'سونو', elevenlabs: 'ایلون‌لبز', stability: 'استبیلیتی', cohere: 'کوهیر', nous: 'نوس', moonshot: 'مون‌شات',
  kimi: 'کیمی', minimax: 'مینیمکس', zhipu: 'ژیپو', glm: 'جی‌ال‌ام', sonnet: 'سانِت', opus: 'اوپوس', haiku: 'هایکو',
  o1: 'او‌وان', o3: 'او‌تری', o4: 'او‌فور', v0: 'وی‌زیرو', vercel: 'ورسل', replit: 'رپلیت', notion: 'نوشن', slack: 'اسلک',
  zoom: 'زوم', figma: 'فیگما', adobe: 'ادوبی', photoshop: 'فتوشاپ', canva: 'کانوا', dropbox: 'دراپ‌باکس', linkedin: 'لینکدین',
  com: 'کام', org: 'اورگ', io: 'آی‌او', www: 'دبلیو‌دبلیو‌دبلیو', http: 'اچ‌تی‌تی‌پی', https: 'اچ‌تی‌تی‌پی‌اس', dev: 'دِو',
};
const LETTER = {
  a: 'ای', b: 'بی', c: 'سی', d: 'دی', e: 'ای', f: 'اف', g: 'جی', h: 'اچ', i: 'آی', j: 'جی', k: 'کی', l: 'ال', m: 'ام',
  n: 'ان', o: 'او', p: 'پی', q: 'کیو', r: 'آر', s: 'اس', t: 'تی', u: 'یو', v: 'وی', w: 'دبلیو', x: 'ایکس', y: 'وای', z: 'زد',
};
const ONES = ['صفر', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
/** A number in a name (GPT-5, Llama 3.1, 2026): in words up to 9999, else digit by digit. */
function num(d) {
  const n = Number(d);
  if (d.length > 1 && d.startsWith('0')) return [...d].map((c) => ONES[+c]).join(Z);
  if (n > 9999) return [...d].map((c) => ONES[+c]).join(Z);
  const parts = [];
  let r = n;
  if (r >= 1000) {
    parts.push(r >= 2000 ? `${ONES[Math.floor(r / 1000)]}${Z}هزار` : 'هزار');
    r %= 1000;
  }
  if (r >= 100) {
    parts.push(HUNDREDS[Math.floor(r / 100)]);
    r %= 100;
  }
  if (r >= 20) {
    parts.push(TENS[Math.floor(r / 10)]);
    r %= 10;
  }
  if (r >= 10) {
    parts.push(TEENS[r - 10]);
    r = 0;
  }
  if (r > 0 || !parts.length) parts.push(ONES[r]);
  return parts.join(`${Z}و${Z}`);
}

// Spelling rules, longest first: each English spelling and how it's written in Persian. `^` only at a word's start,
// `$` only at its end. Vowels in the middle of a word are mostly left out, as Persian writes loanwords.
const RULES = [
  ['^ph', 'ف'], ['tion$', 'شن'], ['sion$', 'ژن'], ['ture$', 'چر'], ['ight', 'ایت'], ['ough', 'او'], ['ing$', 'ینگ'],
  ['ous$', 'س'], ['ies$', 'یز'], ['es$', 'ز'], ['ee', 'ی'], ['ea', 'ی'], ['oo', 'و'], ['ou', 'او'], ['ow$', 'او'],
  ['ai', 'ی'], ['ay', 'ی'], ['ei', 'ی'], ['ey$', 'ی'], ['oa', 'و'], ['au', 'ا'], ['ie$', 'ی'], ['ph', 'ف'], ['sh', 'ش'],
  ['chn', 'کن'], ['chr', 'کر'], ['chl', 'کل'], ['ch', 'چ'], ['th', 'ت'], ['ck', 'ک'], ['qu', 'کو'], ['wh', 'و'], ['gh', 'گ'], ['kn', 'ن'], ['wr', 'ر'], ['ng', 'نگ'],
  ['x', 'کس'], ['ce', 'س'], ['ci', 'سی'], ['cy', 'سی'], ['ge$', 'ج'], ['gi', 'جی'], ['c', 'ک'], ['k', 'ک'], ['q', 'ک'],
  ['b', 'ب'], ['d', 'د'], ['f', 'ف'], ['g', 'گ'], ['h', 'ه'], ['j', 'ج'], ['l', 'ل'], ['m', 'م'], ['n', 'ن'], ['p', 'پ'],
  ['r', 'ر'], ['s', 'س'], ['t', 'ت'], ['v', 'و'], ['w', 'و'], ['z', 'ز'],
];
const VOWEL_START = { a: 'آ', e: 'ا', i: 'ای', o: 'او', u: 'آ', y: 'ی' };
const VOWEL_MID = { a: 'ا', e: '', i: 'ی', o: 'و', u: 'و', y: 'ی' };

/** One English word by the rules (lowercase letters only). */
function spell(w) {
  if (!w) return '';
  // Persian can't start a word on two consonants: «اسـ» (streaming → استریمینگ, smart → اسمارت).
  let out = /^s[^aeiouyh]/.test(w) ? 'ا' : '';
  let i = 0;
  // The first vowel sound needs its alef.
  if (/^[aeiou]/.test(w)) {
    const two = w.slice(0, 2);
    out += two === 'ou' || two === 'ow' ? 'آو' : two === 'ai' || two === 'ay' ? 'ای' : two === 'ee' || two === 'ea' ? 'ای' : VOWEL_START[w[0]];
    i = ['ou', 'ow', 'ai', 'ay', 'ee', 'ea'].includes(two) ? 2 : 1;
  }
  while (i < w.length) {
    // A doubled consonant is one sound.
    if (i > 0 && w[i] === w[i - 1] && !/[aeiou]/.test(w[i])) {
      i++;
      continue;
    }
    let hit = false;
    for (const [pat, fa] of RULES) {
      const start = pat.startsWith('^');
      const end = pat.endsWith('$');
      const p = pat.replace(/^\^|\$$/g, '');
      if (start && i > 0) continue;
      if (!w.startsWith(p, i)) continue;
      if (end && i + p.length !== w.length) continue;
      out += fa;
      i += p.length;
      hit = true;
      break;
    }
    if (hit) continue;
    const c = w[i];
    // A silent e at the end; a final a/o/i is said (data, video, mini).
    if (c in VOWEL_MID) out += i === w.length - 1 ? (c === 'e' ? '' : c === 'a' ? 'ا' : c === 'o' ? 'و' : 'ی') : VOWEL_MID[c];
    i++;
  }
  return out || w;
}

/** One part of a name: known, an acronym said by its letters, a number, or spelled. */
function part(p) {
  const low = p.toLowerCase();
  if (KNOWN[low]) return KNOWN[low];
  if (/^\d+$/.test(p)) return num(p);
  // All capitals up to five letters, or a word with no vowel (LLM, RAG, MCP, HTML, CRM): its letters.
  if ((/^[A-Z]{2,5}$/.test(p) && !/^(OK|NASA|NATO|UNESCO)$/.test(p)) || (p.length <= 5 && !/[aeiouy]/i.test(p))) return [...low].map((c) => LETTER[c] ?? '').join(Z);
  if (p.length === 1) return LETTER[low] ?? p;
  return spell(low);
}

/** A whole token as the shown text has it (`GPT-5`, `DeepSeek-V3.1`, `x.com`, `Llama`): one Persian word. */
export function latinWord(token) {
  const low = token.toLowerCase();
  if (KNOWN[low]) return KNOWN[low];
  const parts = token
    // Lower→Upper (DeepSeek), letters↔digits (GPT5, o3-mini), an acronym before a word (XMLParser).
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .split(/[\s\-_/+&'’]+/)
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    // A dot between letters is a domain's (x.com → ایکس دات کام); between digits a decimal point (3.5 → سه ممیز پنج).
    const dots = p.split('.').filter(Boolean);
    dots.forEach((d, k) => {
      if (k) out.push(/^\d+$/.test(d) && /^\d+$/.test(dots[k - 1]) ? 'ممیز' : 'دات');
      out.push(part(d));
    });
  }
  return out.filter(Boolean).join(Z) || token;
}
