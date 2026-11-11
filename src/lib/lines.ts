// What «گوش دادن» reads of a story: its text, not its headline. Paragraph k of the story is line k + 1 of its card.json
// (0 is the headline; api/tts.js voices by that index). A brief's first line repeats its headline and a line that is
// only a link isn't worth hearing: both are skipped. A story with no text is read by its headline. Shared by the story
// page (the text on screen), the today playlist and the offline audio (card.json). No imports.

export type Line = { text: string; post: number; i: number };

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `paragraphs`: the story's body then «چرا مهمه؟», as shown (empty ones are dropped, as the server does). */
export function storyLines(post: number, title: string, paragraphs: string[], withTitle = false): Line[] {
  const head = clean(title).replace(/…$/, '');
  const all = paragraphs.map(clean).filter(Boolean);
  const again = all[0] && all[0].length < head.length + 20 && all[0].startsWith(head.slice(0, 30)) ? 1 : 0;
  const body = all.map((text, k) => ({ text, post, i: k + 1 })).filter(({ text, i }) => i > again && !/^\P{L}*https?:\/\/\S+$/u.test(text));
  if (!body.length) return [{ text: head, post, i: 0 }];
  return withTitle ? [{ text: head, post, i: 0 }, ...body] : body;
}

/** The same from a story's card.json. */
export type Card = { id: number; title: string; body?: string[]; why?: string | null };
export const cardLines = (card: Card, withTitle = false) => storyLines(card.id, card.title, [...(card.body ?? []), card.why ?? ''], withTitle);
