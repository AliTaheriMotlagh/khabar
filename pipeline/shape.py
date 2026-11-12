"""Shape channel content into an article without any AI: headline, lede, 'why it matters', tags."""
from __future__ import annotations

import re
from typing import Optional

# How Gholam opens: since November 2026 often a greeting of its own («سلام و ارادت خدمت رفقا.», «سلام رفقا!»,
# «دمتون گرم رفقا.», «سلام به رفقای گل.») or a word to the reader («رفقا،», «رفیق،», «داداش گلم،»), before the news.
# Neither is the news: strip_opener drops the run from the story's start, so it is never the headline nor read aloud.
# Weak words («و», «به», «خدمت», «ارادت») only go when a greeting or a name comes after them («سلام به رفقا»), so
# «رفقا به گفته رویترز…» keeps «به گفته رویترز…».
_ADDRESS = ("رفقا", "رفقای", "رفیق", "رفیقا", "رفیقای", "داداش", "داداشی", "داش", "آبجی", "دوست", "دوستان", "عزیزان")
_OPENER_STRONG = (
    "سلام", "درود", "دمتون گرم", "دمت گرم", "دم همگی گرم", "دم همه گرم", "دم همتون گرم", "دم همه‌تون گرم", "دم شما گرم", "خسته نباشید", "صبح بخیر", "عصر بخیر", "شب بخیر",
    *(f"{a} {e}" for a in _ADDRESS for e in ("گل", "گلم", "عزیز", "من")),  # «داداش گل،», «رفقای عزیز»
    "رفقا", "رفیقا", "رفیق", "داداشی", "داداش", "داش", "آبجی", "گلم", "عزیزان", "عزیزم", "دوستان", "بچه‌ها",
    # Not «طرف» ("the guy"): «طرف اومده یه مدل ساخته» is the story's subject.
    "ببین", "راستش", "خلاصه", "گوش کن",
)
_OPENER_WEAK = ("و", "به", "خدمت", "همه", "همگی", "شما", "ارادت", "عرض ادب", "احترام")
_OPENER_TOKEN_RE = re.compile(
    r"\s*(" + "|".join(re.escape(w) for w in sorted({*_OPENER_STRONG, *_OPENER_WEAK}, key=len, reverse=True)) + r")(?![\w‌])"
    r"[\s،,:!.؛;…]*"
)
# «قضیه از این قراره که …», «ماجرا اینه که …», «خبر رسیده که …»: a run-up to the news, never the news itself.
_RUNUP_RE = re.compile(
    r"^(?:(?:قضیه|ماجرا|داستان|جریان)\s+(?:از\s+)?(?:این\s*(?:قراره|قرارشه|است|ه)|اینه)|خبر\s+(?:رسیده|اومده|داریم))\s+که\s+"
)


def strip_opener(text: str) -> str:
    """The text without Gholam's greeting or word to the reader at its start (see _OPENER_STRONG), nor a run-up."""
    pos = cut = 0
    while m := _OPENER_TOKEN_RE.match(text, pos):
        pos = m.end()
        if m.group(1) not in _OPENER_WEAK:
            cut = pos
    return _RUNUP_RE.sub("", text[cut:], count=1)


# «چرا مهمه؟», «چرا مهم است؟», «اهمیتش اینه که» — often both, «چرا مهمه؟ اهمیتش اینه که …» — maybe bold, with an emoji or a
# colon. The whole run of labels is dropped; the site prints its own heading. An answer that starts «چون …» keeps it.
WHY_LABEL = r"(?:چرا\s*مهم(?:ه|\s*است|\s*هست)\s*[؟?]?|اهمیتش\s+(?:اینه|این\s+است)\s+که)"
WHY_RE = re.compile(r"^[\s*_«»\"'\U0001F300-\U0001FAFF☀-➿️]*(?:" + WHY_LABEL + r"[\s*_:：،,»\"'—–-]*)+")
# A list item: «•», «-», «▪», an emoji bullet, or «۱.» / «1)».
BULLET_RE = re.compile(r"^\s*(?:[•●▪▫◾◽‣⁃∙·\-–—🔹🔸🔺▶✅✔➖➤►]|\*(?!\*)|[0-9۰-۹]{1,2}\s*[.)\-–]\s)")
# The label the site prints over the closing paragraph Gholam writes after his list since November 2026 («خلاصه اینکه…»,
# «تهِ ماجرا اینه که…»): it is his last word on the story, not literally why it matters.
TAKEAWAY_LABEL = "حرف آخر"
SENTENCE_END_RE = re.compile(r"(?<=[.!؟?])\s+")

# Keywords → Persian tag. Matched as whole words in either language (see _matcher), so «اپل» never matches «اپلیکیشن»
# and "ring" never matches "during". Prefer names and specific phrases over common words: one stray word mislabels a story.
# No "هوش مصنوعی" topic: the whole channel is about AI, so it would sit on every story and say nothing.
TOPICS: list[tuple[str, tuple[str, ...]]] = [
    ("اوپن‌ای‌آی", ("openai", "chatgpt", "gpt", "codex", "sora", "sam altman", "altman", "اوپن‌ای‌آی", "اوپن ای آی",
                   "اوپن‌اِی‌آی", "چت‌جی‌پی‌تی", "چت جی پی تی", "جی‌پی‌تی", "سورا", "آلتمن")),
    ("آنتروپیک", ("anthropic", "claude", "opus", "dario amodei", "آنتروپیک", "انتروپیک", "کلود", "اوپوس", "آمودی")),
    ("گوگل", ("google", "gemini", "deepmind", "alphabet", "sundar pichai", "android", "waymo", "گوگل", "جمینای", "جمنای",
              "جمینی", "دیپ‌مایند", "دیپ مایند", "وِیمو", "ویمو")),
    ("انویدیا", ("nvidia", "jensen huang", "انویدیا", "جنسن هوانگ", "جنیسن هوانگ")),
    ("اپل", ("apple", "iphone", "ipad", "macbook", "vision pro", "siri", "tim cook", "اپل", "آیفون", "سیری", "تیم کوک")),
    ("مایکروسافت", ("microsoft", "copilot", "satya nadella", "مایکروسافت", "کوپایلت", "ساتیا نادلا")),
    ("متا", ("meta", "facebook", "instagram", "whatsapp", "zuckerberg", "llama", "متا", "فیسبوک", "فیس‌بوک",
             "اینستاگرام", "واتساپ", "زاکربرگ")),
    ("ایلان ماسک", ("elon", "musk", "tesla", "spacex", "starship", "xai", "grok", "neuralink", "ایلان", "ماسک", "تسلا",
                    "اسپیس‌ایکس", "اسپیس ایکس", "گراک", "گروک", "نورالینک")),
    ("آمازون", ("amazon", "aws", "bezos", "alexa", "آمازون", "بزوس", "الکسا")),
    ("سامسونگ", ("samsung", "سامسونگ")),
    ("چین", ("china", "chinese", "deepseek", "qwen", "alibaba", "kimi", "moonshot", "minimax", "zhipu", "bytedance",
             "baidu", "tencent", "huawei", "glm", "xiaomi", "چین", "چینی", "دیپ‌سیک", "دیپ سیک", "کیوِن", "علی‌بابا", "کیمی", "مون‌شات",
             "مونشات", "بایت‌دنس", "هواوی", "شیائومی")),
    ("کدنویسی", ("coding", "programming", "programmer", "developer", "claude code", "cursor", "github", "vibe coding",
                 "opencode", "cline", "windsurf", "replit", "lovable", "bolt.new", "devin", "cognition", "swe-bench",
                 "کدنویسی", "کد نویسی", "برنامه‌نویسی", "برنامه‌نویس", "برنامه نویسی", "کد زدن", "گیت‌هاب")),
    ("رباتیک", ("robot", "robotics", "humanoid", "optimus", "figure ai", "unitree", "boston dynamics", "ربات",
                "رباتیک", "انسان‌نما", "یونیتری")),
    ("تراشه", ("chip", "gpu", "semiconductor", "tsmc", "asml", "datacenter", "data center", "تراشه", "چیپ",
               "پردازنده", "دیتاسنتر", "مرکز داده")),
    ("گجت", ("wearable", "smart ring", "oura", "smart glasses", "ai glasses", "ray-ban", "headset", "gadget", "گجت",
             "انگشتر هوشمند", "عینک هوشمند", "هدست", "پوشیدنی")),
    ("فضا", ("nasa", "rocket", "mars", "satellite", "orbit", "astronaut", "telescope", "starship", "ناسا", "موشک", "مریخ",
             "ماهواره", "فضانورد", "فضاپیما", "فضایی", "تلسکوپ")),
    ("سلامت", ("health", "healthcare", "medical", "medicine", "cancer", "disease", "patient", "clinical", "fda",
               "drug discovery", "سلامت", "پزشکی", "پزشک", "سرطان", "بیماری", "بیمار", "درمان", "دارو")),
    ("کوانتوم", ("quantum", "کوانتوم", "کوانتومی")),
    ("رمزارز", ("bitcoin", "crypto", "ethereum", "stablecoin", "بیت‌کوین", "بیت کوین", "رمزارز", "کریپتو", "اتریوم")),
    ("استارتاپ", ("startup", "funding round", "seed round", "series a", "series b", "series c", "unicorn", "valuation",
                  "y combinator", "yc", "a16z", "venture capital", "استارتاپ", "یونیکورن", "جذب سرمایه", "ارزش‌گذاری",
                  "دور سرمایه‌گذاری", "سرمایه‌گذاری خطرپذیر", "وای‌کامبینیتور")),
    ("امنیت", ("cybersecurity", "security", "hacker", "hackers", "hacked", "breach", "malware", "ransomware",
               "vulnerability", "exploit", "zero-day", "امنیت", "امنیتی", "سایبری", "هکر", "هک", "بدافزار", "باج‌افزار",
               "آسیب‌پذیری", "حفره امنیتی")),
    ("اشتغال", ("layoff", "layoffs", "jobs", "unemployment", "workforce", "اخراج", "تعدیل نیرو", "بیکاری", "شغل",
                "مشاغل", "بازار کار")),
    ("سیاست و قانون", ("trump", "white house", "congress", "senate", "senator", "lawmakers", "legislation", "regulation",
                       "regulators", "executive order", "ai act", "european commission", "pentagon", "department of war",
                       "department of defense", "doj", "ftc", "lawsuit", "sued", "sues", "court", "judge", "copyright",
                       "ترامپ", "کاخ سفید", "کنگره", "سنا", "سناتور", "قانون‌گذار", "قانونگذار", "قانون‌گذاری", "مقررات",
                       "فرمان اجرایی", "اتحادیه اروپا", "کمیسیون اروپا", "پنتاگون", "وزارت جنگ", "وزارت دفاع",
                       "وزارت دادگستری", "دولت آمریکا", "دولت", "دادگاه", "قاضی", "شکایت", "کپی‌رایت", "حق نشر")),
    # Not "scientist" or "math": a lab's "research scientist" and "did the math" aren't science news.
    ("علم", ("mathematics", "mathematician", "theorem", "physics", "biology", "chemistry", "protein", "nobel",
             "neuroscience", "ریاضی", "ریاضیات", "ریاضیدان", "فیزیک", "زیست‌شناسی", "شیمی", "پروتئین", "جامعه علمی",
             "کشف علمی", "نوبل", "علوم اعصاب")),
    ("ایجنت", ("agent", "agentic", "ایجنت", "ایجنتی", "دستیار خودکار")),
    ("تصویر و ویدیو", ("image generation", "image model", "video model", "video generation", "text-to-video",
                       "image editing", "midjourney", "veo", "kling", "nano banana", "runway", "flux", "تولید تصویر",
                       "تولید ویدیو", "ساخت ویدیو", "ساخت تصویر", "ویرایش تصویر", "مدل ویدیویی", "میدجرنی")),
    ("صدا و موسیقی", ("voice", "speech", "text-to-speech", "speech-to-speech", "elevenlabs", "music", "suno", "صوتی",
                      "گفتار", "گفتاری", "موسیقی", "آهنگ", "الون‌لبز")),
    ("متن‌باز", ("open source", "open-source", "open weights", "open-weight", "open model", "hugging face", "huggingface",
                 "متن‌باز", "متن باز", "اوپن‌سورس", "اوپن سورس", "هاگینگ‌فیس", "هاگینگ فیس")),
    # Not «آموزش» alone (it is also a model's training), nor universities (every lab story has one).
    ("آموزش", ("education", "students", "student", "teacher", "teachers", "school", "duolingo", "آموزش و پرورش",
                "تحصیل", "دانشجو", "دانش‌آموز", "مدرسه", "معلم", "دولینگو")),
    ("کسب‌وکار", ("acquisition", "acquires", "acquired", "revenue", "ipo", "stock", "market cap", "earnings",
                  "درآمد", "سهام", "بورس", "عرضه اولیه", "ارزش بازار", "تصاحب", "خریداری", "سودآوری")),
    ("سرگرمی", ("film", "movie", "hollywood", "netflix", "video game", "gaming", "game studio", "فیلم", "سینما",
                "هالیوود", "نتفلیکس", "بازی ویدیویی", "بازی‌سازی", "گیمینگ")),
    ("شبکه‌های اجتماعی", ("linkedin", "snapchat", "tiktok", "youtube", "reddit", "pinterest", "لینکدین", "اسنپ‌چت",
                          "تیک‌تاک", "یوتیوب", "ردیت")),
]

def split_gholam(text: str) -> tuple[list[str], Optional[str], Optional[str]]:
    """Return (paragraphs, closing, closing_label).

    Two shapes of Gholam's translation:
    - until November 2026: the story, then «چرا مهمه؟ …» / «اهمیتش اینه که …» → closing = that answer, label None
      (the site's «چرا مهمه؟»). The label may also stand alone on its line, the answer on the next.
    - since: a lede, a list («• …»), then an unlabeled paragraph with his take → closing = that paragraph, label
      TAKEAWAY_LABEL.
    """
    paras = [re.sub(r"[ \t]+$", "", p.strip(), flags=re.M) for p in re.split(r"\n\s*\n|\n", text) if p.strip()]
    # His greeting is not the story: dropped from the first paragraph, or the whole paragraph when it is only that.
    if paras:
        paras[0] = strip_opener(paras[0]).strip()
        paras = [p for p in paras if p]
    for i, p in enumerate(paras):
        m = WHY_RE.match(p)
        if not m:
            continue
        why = p[m.end() :].strip()
        rest = paras[i + 1 :]
        if not why and rest:  # «چرا مهمه؟» on its own line: the answer is the next paragraph
            why, rest = rest[0], rest[1:]
        if why:
            return paras[:i] + rest, why, None
    bullets = [i for i, p in enumerate(paras) if BULLET_RE.match(p)]
    # A lede, the list, then exactly one paragraph: that one is the take. A story that goes on longer after its list
    # keeps all its text.
    if bullets and bullets[0] > 0 and bullets[-1] == len(paras) - 2:
        return paras[:-1], paras[-1], TAKEAWAY_LABEL
    return paras, None, None


def first_sentence(text: str) -> str:
    return SENTENCE_END_RE.split(text.strip(), maxsplit=1)[0].strip()


def clip(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip("،,:;-–")
    return cut + "…"


CLAUSE_RE = re.compile(r"\s*[؛;]\s*")
HEADLINE_MAX = 200  # a whole sentence up to this long is the headline as-is
HEADLINE_HARD_MAX = 320  # past this, a sentence with no clause break is clipped


def headline(gholam_paras: list[str]) -> Optional[str]:
    """Gholam's first sentence, whole. A long one is cut at its first «؛» clause, never mid-thought."""
    if not gholam_paras:
        return None
    sentence = first_sentence(strip_opener(gholam_paras[0]))
    # A lede that opens a list ends with «:» («…معماری متفاوتیه که سوار کردن:»): a headline doesn't.
    sentence = re.sub(r"\s+", " ", sentence).rstrip(".!؟?:：؛;،, ")
    if not sentence:
        return None
    if len(sentence) <= HEADLINE_MAX:
        return sentence
    clause = CLAUSE_RE.split(sentence, maxsplit=1)[0]
    if 40 <= len(clause) <= HEADLINE_MAX:
        return clause
    return sentence if len(sentence) <= HEADLINE_HARD_MAX else clip(sentence, HEADLINE_MAX)


def source_title(post_text: str, links: list[dict], preview: Optional[dict]) -> Optional[str]:
    """Best original-language title for the story (article title, tweet's first line, preview title)."""
    for l in links:
        if l.get("kind") == "tweet":
            if l.get("article", {}).get("title"):
                return l["article"]["title"]
            line = next((x for x in (l.get("text") or "").splitlines() if x.strip()), "")
            if line:
                return clip(re.sub(r"https?://\S+", "", line), 140)
        elif l.get("title"):
            return clip(l["title"], 140)
    if preview and preview.get("title"):
        return clip(preview["title"], 140)
    line = next((x for x in post_text.splitlines() if x.strip() and not x.strip().startswith("http")), "")
    return clip(line, 140) if line else None


# A Persian word continues through letters and ZWNJ (‌), so «اوپن‌سورس» is one word and «اوپن» alone won't match it.
_FA_LETTER = r"[\u0600-\u06FF\u200c]"
# Suffixes a Persian keyword may take: «امنیتی», «ربات‌ها», «گوگلِ» … but not «فضای» (as in «فضای مجازی», cyberspace).
_FA_SUFFIX = r"(?:\u200c?(?:ها|های|هایی|ش|شون|شان|اش|م|ت|ه)|ها|های)?"


def _matcher(word: str):
    """Count of whole-word matches. English takes plurals and possessives ("robots", "OpenAI's")."""
    word = word.strip().lower()
    if word.isascii():
        return re.compile(r"(?<![a-z0-9])" + re.escape(word) + r"(?:s|es|'s|’s)?(?![a-z0-9])").findall
    return re.compile(r"(?<!" + _FA_LETTER + r")" + re.escape(word) + _FA_SUFFIX + r"(?!" + _FA_LETTER + r")").findall


# Links name sites, not topics: "github.com/openai/math" doesn't make a math story a coding one.
URL_RE = re.compile(r"(?:https?://|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|ai|io|org|net|dev|co|app|so|me)\b(?:/\S*)?", re.I)


def _norm(text: str) -> str:
    """Lowercase, links dropped, and Arabic yeh/kaf → Persian so either spelling matches."""
    return URL_RE.sub(" ", text).lower().replace("ي", "ی").replace("ك", "ک")


_TOPIC_MATCHERS = [(tag, [_matcher(w) for w in words]) for tag, words in TOPICS]
MAX_TAGS = 3
TITLE_WEIGHT = 3


def tags(*texts: str, title: str = "") -> list[str]:
    """Topics a story is about, most relevant first (the first one is its section).

    A keyword in the title counts TITLE_WEIGHT times, in the rest once. A topic needs 2 points: named in the title, or
    at least twice in the text (Gholam's Persian and the English source both naming it). One passing mention ("faster
    than OpenAI's model") doesn't make a Kimi story an OpenAI story. The topics after the first are named in the title
    or close behind it (half its score): a side remark in a long thread isn't what the story is about."""
    head = _norm(title)
    body = _norm(" ".join(t for t in (title, *texts) if t))
    scores = []
    for i, (tag, ms) in enumerate(_TOPIC_MATCHERS):
        in_head = sum(len(m(head)) for m in ms) if head else 0
        score = TITLE_WEIGHT * in_head + sum(len(m(body)) for m in ms)
        if score:
            scores.append((score, -i, tag, in_head > 0))
    if not scores:
        return []
    best = max(scores)[0]
    keep = [(sc, i, tag) for sc, i, tag, in_head in scores if sc >= 2 and (sc * 2 >= best or in_head)]
    return [tag for _, _, tag in sorted(keep, reverse=True)][:MAX_TAGS]
