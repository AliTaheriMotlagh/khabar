// Sources in any language (src/lib/source.ts): publisher names, the language of a text, clean and short links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedLinks, cleanUrl, langOf, publisherOf, shortUrl, translateUrl } from '../src/lib/source.ts';

test('publisherOf: known names by domain or parent domain, else the domain', () => {
  assert.equal(publisherOf('https://www.bloomberg.com/news/articles/x'), 'Bloomberg');
  assert.equal(publisherOf('https://asia.nikkei.com/a'), 'Nikkei Asia');
  assert.equal(publisherOf('https://tech.sina.com.cn/a'), 'Sina (新浪)');
  assert.equal(publisherOf('https://www.bbc.com/persian/articles/x'), 'BBC فارسی');
  assert.equal(publisherOf('https://www.bbc.com/news/x'), 'BBC');
  assert.equal(publisherOf('techcrunch.com'), 'TechCrunch');
  assert.equal(publisherOf('https://simonw.substack.com/p/x'), 'simonw');
  assert.equal(publisherOf('https://unknown-blog.dev/post'), 'unknown-blog.dev');
  assert.equal(publisherOf(''), '');
  assert.equal(publisherOf('not a url://'), '');
});

test('langOf: by script, then common words for Latin letters', () => {
  assert.equal(langOf('Rene Haas has been approached regarding the CEO role at Nvidia')?.code, 'en');
  assert.equal(langOf('阿里巴巴发布了新一代通义千问大模型，性能大幅提升')?.code, 'zh');
  assert.equal(langOf('ソフトバンクは新しいAIモデルを発表しました')?.code, 'ja');
  assert.equal(langOf('삼성전자가 새로운 인공지능 칩을 공개했다')?.code, 'ko');
  assert.equal(langOf('Компания представила новую модель искусственного интеллекта')?.code, 'ru');
  assert.equal(langOf('أعلنت الشركة عن نموذج جديد للذكاء الاصطناعي')?.code, 'ar');
  assert.equal(langOf('شرکت از مدل تازه‌ی هوش مصنوعی رونمایی کرد و گفت')?.code, 'fa');
  assert.equal(langOf("L'entreprise a présenté une nouvelle puce pour les centres de données avec des performances")?.code, 'fr');
  assert.equal(langOf('Das Unternehmen hat eine neue KI vorgestellt und die ist nicht nur schnell, sondern auch günstig')?.code, 'de');
  assert.equal(langOf('La empresa presentó un nuevo modelo para los desarrolladores con más contexto que el anterior')?.code, 'es');
  assert.equal(langOf('Gemini 4 Neon')?.code ?? null, null, 'too little text');
  assert.equal(langOf('ok')?.code ?? null, null);
  assert.equal(langOf('Компанія представила нову модель і її можливості')?.code, 'uk');
  assert.equal(langOf('Компанія представила нову модель і її можливості')?.fa, 'اوکراینی');
});

test('cleanUrl: tracking parameters go, meaningful ones stay', () => {
  assert.equal(
    cleanUrl('https://www.bloomberg.com/news/articles/a?taid=6af&utm_campaign=x&utm_source=twitter'),
    'https://www.bloomberg.com/news/articles/a',
  );
  assert.equal(cleanUrl('https://x.com/a/status/1?s=52&t=abc'), 'https://x.com/a/status/1');
  assert.equal(cleanUrl('https://youtu.be/abc?si=xyz&t=42'), 'https://youtu.be/abc?t=42');
  assert.equal(cleanUrl('https://example.com/search?q=ai&t=3'), 'https://example.com/search?q=ai&t=3');
  assert.equal(cleanUrl('nonsense'), 'nonsense');
});

test('shortUrl: host and the start of the path', () => {
  const s = shortUrl('https://www.bloomberg.com/news/articles/2026-11-18/arm-ceo-rene-haas?utm_source=x');
  assert.ok(s.startsWith('bloomberg.com/news/articles/') && s.endsWith('…') && s.length <= 38, s);
  assert.equal(shortUrl('https://openai.com/index/'), 'openai.com/index');
  assert.ok(shortUrl('https://example.com/' + 'a'.repeat(100)).length <= 38);
});

test('citedLinks: addresses outside X, cleaned, cut-off ones skipped', () => {
  const t = 'Big news https://www.bloomberg.com/news/a?utm_source=twitter and https://x.com/b/status/2 also https://t.co/xyz https://www.reuters.com/tech/b… (https://openai.com/x).';
  assert.deepEqual(citedLinks(t), ['https://www.bloomberg.com/news/a', 'https://openai.com/x']);
  assert.deepEqual(citedLinks(''), []);
});

test('translateUrl: only for text that is not Persian', () => {
  assert.match(translateUrl('The company announced a new model for developers today') ?? '', /^https:\/\/translate\.google\.com\/\?sl=auto&tl=fa&op=translate&text=The%20company/);
  assert.equal(translateUrl('شرکت از مدل تازه‌ی هوش مصنوعی رونمایی کرد'), null);
  assert.equal(translateUrl(''), null);
});

test('short links: publishers by their own short domain; generic shorteners known as such', async () => {
  const { isShortener } = await import('../src/lib/source.ts');
  assert.equal(publisherOf('https://nyti.ms/abc'), 'The New York Times');
  assert.equal(publisherOf('https://reut.rs/x'), 'Reuters');
  assert.equal(isShortener('https://spr.ly/6019ByRZkc'), true);
  assert.equal(isShortener('https://bit.ly/x'), true);
  assert.equal(isShortener('https://www.bloomberg.com/x'), false);
});

test('sourceKind / settleStatus: the maker\'s own post is official, a newsroom\'s at least a report', async () => {
  const { sourceKind, settleStatus } = await import('../src/lib/source.ts');
  const tweet = (handle) => ({ url: `https://x.com/${handle}/status/1`, author: { handle } });
  assert.equal(sourceKind(tweet('Tesla')), 'official');
  assert.equal(sourceKind(tweet('neuralink')), 'official');
  assert.equal(sourceKind(tweet('Reuters')), 'news');
  assert.equal(sourceKind(tweet('business')), 'news');
  assert.equal(sourceKind(tweet('kimmonismus')), null);
  assert.equal(sourceKind({ url: 'https://openai.com/index/x' }), 'official');
  assert.equal(sourceKind({ url: 'https://www.bloomberg.com/news/x' }), 'news');
  assert.equal(sourceKind({ url: 'https://github.com/x/y' }), null);
  assert.equal(settleStatus('شایعه', tweet('Tesla')), 'رسمی', 'the model called @Tesla a rumour');
  assert.equal(settleStatus('شایعه', tweet('Reuters')), 'گزارش');
  assert.equal(settleStatus('رسمی', tweet('Reuters')), 'رسمی', 'a newsroom quoting the maker stays official');
  assert.equal(settleStatus('شایعه', tweet('kimmonismus')), 'شایعه');
  assert.equal(settleStatus('شایعه', tweet('someone'), 'حساب رسمی نورالینک یه پست گذاشته'), 'رسمی');
  assert.equal(settleStatus('شایعه', tweet('someone'), 'هنوز رسماً تأیید نشده ولی حساب رسمی'), 'شایعه');
  assert.equal(settleStatus(null, null), null);
});
