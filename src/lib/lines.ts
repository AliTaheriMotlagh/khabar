// What «گوش دادن» reads of a story: its text, not its headline. Paragraph k of the story is line k + 1 of its card.json
// (0 is the headline; server/tts.js voices by that index). A brief's first line repeats its headline and a line that is
// only a link isn't worth hearing: both are skipped. A story with no text is read by its headline. Shared by the story
// page (the text on screen), the today playlist and the offline audio (card.json). Its Latin names are said the
// lexicon's way (`lex`, server/_say.js): `say` is what a voice reads, `map` takes a spoken character back to the shown one.
import { sayLine, toShown } from '../../server/_say.js';

export type Line = {
  text: string;
  post: number;
  i: number;
  say?: string;
  map?: number[][];
  /** A line that isn't a story's paragraph (the podcast's host lines, the weekly recap): what /api/tts reads instead of
   *  post + i, e.g. `day=2026-11-18&k=intro` or `week=2026-11-20&k=3` (server/tts.js textOf). */
  src?: string;
};
export type Lex = Record<string, string> | undefined;

const spoken = (l: Line, lex: Lex): Line => {
  if (!lex) return l;
  const { say, map } = sayLine(l.text, lex);
  return say === l.text ? l : { ...l, say, map };
};
/** What a voice reads for a line. */
export const sayOf = (l: Line) => l.say ?? l.text;
/** A character of what was said → the same place in the shown text. */
export const shownAt = (l: Line, i: number) => (l.map?.length ? toShown(l.map, i) : i);

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `paragraphs`: the story's body then «چرا مهمه؟», as shown (empty ones are dropped, as the server does). */
export function storyLines(post: number, title: string, paragraphs: string[], withTitle = false, lex?: Lex): Line[] {
  return plainLines(post, title, paragraphs, withTitle).map((l) => spoken(l, lex));
}
function plainLines(post: number, title: string, paragraphs: string[], withTitle: boolean): Line[] {
  const head = clean(title).replace(/…$/, '');
  const all = paragraphs.map(clean).filter(Boolean);
  const again = all[0] && all[0].length < head.length + 20 && all[0].startsWith(head.slice(0, 30)) ? 1 : 0;
  const body = all.map((text, k) => ({ text, post, i: k + 1 })).filter(({ text, i }) => i > again && !/^\P{L}*https?:\/\/\S+$/u.test(text));
  if (!body.length) return [{ text: head, post, i: 0 }];
  return withTitle ? [{ text: head, post, i: 0 }, ...body] : body;
}

/** The same from a story's card.json. */
export type Card = { id: number; title: string; body?: string[]; why?: string | null; lex?: Record<string, string> };
export const cardLines = (card: Card, withTitle = false) => storyLines(card.id, card.title, [...(card.body ?? []), card.why ?? ''], withTitle, card.lex);
