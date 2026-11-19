// What the model's per-story facts add up to across the site (PLAN.md P3): the AI models in the news with the scores the
// stories gave them (/models/), the dated events ahead (/calendar/, /calendar.ics) and the threads still moving (the
// home page's «پرونده‌های داغ»). Built from the listed stories only, newest first; empty until the backfill has run.
import { getFeed, getPosts, type ModelFact, type Post, type Thread } from './posts';
import { slugify } from './knowledge';

const key = (name: string) => name.toLowerCase().replace(/[\s‌_–—-]+/g, ' ').trim();
// Who makes a model family, from its name: the small model sometimes names the benchmark's lab or the reporter instead.
const MAKERS: [RegExp, string][] = [
  [/^(gpt|o\d|codex|sora|chatgpt)\b/i, 'اوپن‌ای‌آی'], [/^claude\b|^(opus|sonnet|haiku|fable|mythos)\b/i, 'آنتروپیک'],
  [/^(gemini|gemma|veo|imagen|genie)\b/i, 'گوگل'], [/^(qwen|wan)\b/i, 'علی‌بابا'], [/^(llama|muse)\b/i, 'متا'],
  [/^grok\b/i, 'xAI'], [/^deepseek\b/i, 'دیپ‌سیک'], [/^kimi\b/i, 'مون‌شات'], [/^(mistral|magistral|devstral|codestral)\b/i, 'میسترال'],
  [/^(phi|mai)\b/i, 'مایکروسافت'], [/^(nemotron|cosmos)\b/i, 'انویدیا'], [/^(glm)\b/i, 'ژیپو'], [/^(minimax)\b/i, 'مینی‌مکس'],
];
export const makerOf = (name: string, said: string) => MAKERS.find(([re]) => re.test(name.trim()))?.[1] ?? said;

export type ModelEntry = {
  slug: string;
  name: string;
  maker: string;
  /** Stories that name it, newest first. */
  posts: Post[];
  /** Every score a story gave it, newest first: one benchmark can appear twice (two runs, two dates). */
  scores: (ModelFact['scores'][number] & { post: Post })[];
};

let models: ModelEntry[] | null = null;
/** Each model the stories name, the most recently mentioned first. */
export function modelIndex(): ModelEntry[] {
  if (models) return models;
  const by = new Map<string, ModelEntry & { makers: Map<string, number> }>();
  for (const p of getFeed()) {
    for (const m of p.models) {
      const k = key(m.name);
      let e = by.get(k);
      if (!e) by.set(k, (e = { slug: slugify(m.name), name: m.name, maker: '', posts: [], scores: [], makers: new Map() }));
      if (!e.posts.includes(p)) e.posts.push(p);
      const maker = makerOf(m.name, m.maker);
      if (maker) e.makers.set(maker, (e.makers.get(maker) ?? 0) + 1);
      for (const s of m.scores) e.scores.push({ ...s, post: p });
    }
  }
  models = [...by.values()].map(({ makers, ...e }) => ({ ...e, maker: [...makers].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' }));
  return models;
}

export type CalEvent = { date: string; what: string; post: Post };

/** Dated events from the stories, each once (the same day and words from two posts of one launch), by date. */
export function events(): CalEvent[] {
  const seen = new Set<string>();
  const out: CalEvent[] = [];
  for (const p of getFeed()) {
    for (const e of p.events) {
      const k = `${e.date}|${e.what.replace(/\s+/g, '')}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...e, post: p });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.post.id - a.post.id));
}

export type ActiveThread = { thread: Thread; posts: Post[]; newest: Post };

/** Threads whose newest story is at most `days` days older than the site's newest story, newest first. Measured from
 *  the newest story rather than the clock, so a quiet day doesn't empty the shelf and a rebuild changes nothing. */
export function activeThreads(days = 4, limit = 8): ActiveThread[] {
  const feed = getFeed();
  if (!feed.length) return [];
  const byId = new Map(getPosts().map((p) => [p.id, p]));
  const since = Date.parse(feed[0].date) - days * 86_400_000;
  const seen = new Set<number>();
  const out: ActiveThread[] = [];
  for (const p of feed) {
    if (!p.thread || seen.has(p.thread.key)) continue;
    seen.add(p.thread.key);
    const posts = p.thread.ids.map((id) => byId.get(id)).filter((q): q is Post => !!q && q.listed);
    const newest = posts.at(-1);
    if (!newest || posts.length < 3 || Date.parse(newest.date) < since) continue;
    out.push({ thread: p.thread, posts, newest });
    if (out.length === limit) break;
  }
  return out;
}

/** The thread's name: the model's, else its newest story's short line. */
export const threadName = (t: Thread, posts: Post[]) => t.title || posts.at(-1)?.short || 'پیگیری این ماجرا';
