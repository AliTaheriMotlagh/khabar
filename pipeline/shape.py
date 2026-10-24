"""Shape channel content into an article without any AI: headline, lede, 'why it matters', tags."""
from __future__ import annotations

import re
from typing import Optional

OPENER_RE = re.compile(
    r"^\s*(?:(?:ببین|راستش|خلاصه|داش|آبجی|رفیق|داداشی|داداش|دوست من|طرف|گوش کن|بچه‌ها)(?![\w‌])\s*)+[،,:!]?\s*"
)
WHY_RE = re.compile(r"^\s*(چرا مهمه[؟?]?|اهمیتش اینه که)\s*")
SENTENCE_END_RE = re.compile(r"(?<=[.!؟?])\s+")

# (keywords matched case-insensitively in English or Persian text) → Persian tag
TOPICS: list[tuple[str, tuple[str, ...]]] = [
    ("هوش مصنوعی", (" ai ", "a.i.", "artificial intelligence", "llm", "gpt", "chatbot", "agent", "هوش مصنوعی", "مدل زبانی")),
    ("اوپن‌ای‌آی", ("openai", "chatgpt", "sam altman", "اوپن", "چت‌جی‌پی‌تی")),
    ("آنتروپیک", ("anthropic", "claude", "آنتروپیک", "کلاد")),
    ("گوگل", ("google", "gemini", "deepmind", "android", "گوگل", "جمنای")),
    ("انویدیا", ("nvidia", "jensen", "انویدیا")),
    ("اپل", ("apple", "iphone", "ipad", "macbook", "vision pro", "اپل", "آیفون")),
    ("مایکروسافت", ("microsoft", "copilot", "windows", "مایکروسافت")),
    ("متا", ("meta ", "facebook", "instagram", "whatsapp", "zuckerberg", "متا ")),
    ("ایلان ماسک", ("elon", "musk", "tesla", "spacex", "starship", "xai", "grok", "neuralink", "ماسک", "تسلا")),
    ("آمازون", ("amazon", "aws", "bezos", "آمازون")),
    ("سامسونگ", ("samsung", "سامسونگ")),
    ("دیپ‌سیک", ("deepseek", "qwen", "alibaba", "دیپ‌سیک")),
    ("رباتیک", ("robot", "humanoid", "ربات")),
    ("تراشه", ("chip", "gpu", "semiconductor", "tsmc", "تراشه", "چیپ")),
    ("گجت", ("wearable", "ring", "glasses", "headset", "gadget", "گجت", "انگشتر", "عینک")),
    ("فضا", ("nasa", "space", "rocket", "mars", "moon", "satellite", "فضا", "موشک", "مریخ")),
    ("سلامت", ("health", "medical", "cancer", "drug", "brain", "fda", "سلامت", "پزشکی", "سرطان", "مغز")),
    ("کوانتوم", ("quantum", "کوانتوم")),
    ("رمزارز", ("bitcoin", "crypto", "ethereum", "بیت‌کوین", "رمزارز")),
    ("استارتاپ", ("startup", "raises", "funding", "valuation", "series a", "series b", "استارتاپ", "سرمایه‌گذاری")),
    ("امنیت", ("security", "hack", "breach", "malware", "privacy", "امنیت", "هک", "حریم خصوصی")),
]


def split_gholam(text: str) -> tuple[list[str], Optional[str]]:
    """Return (paragraphs, why_it_matters)."""
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n", text) if p.strip()]
    why = None
    for i, p in enumerate(paras):
        if WHY_RE.match(p):
            why = WHY_RE.sub("", p).strip()
            paras = paras[:i] + paras[i + 1 :]
            break
    return paras, why


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
    sentence = OPENER_RE.sub("", first_sentence(gholam_paras[0]))
    sentence = re.sub(r"\s+", " ", sentence).rstrip(".!؟? ")
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


def _matcher(word: str):
    word = word.strip()
    if word.isascii():  # whole words only, so "ring" doesn't match "during"
        return re.compile(r"(?<![a-z])" + re.escape(word) + r"(?![a-z])").search
    return lambda blob: word in blob


_TOPIC_MATCHERS = [(tag, [_matcher(w) for w in words]) for tag, words in TOPICS]


def tags(*texts: str) -> list[str]:
    blob = " ".join(t for t in texts if t).lower()
    return [tag for tag, ms in _TOPIC_MATCHERS if any(m(blob) for m in ms)][:5]
