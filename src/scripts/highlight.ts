// The word being said, lit where the text is read (PLAN.md P1-D): a soft pill glides from word to word behind the text,
// and the rest of the paragraph is a little muted until it is said. No spans in the page's HTML (its markup is multiplied
// by every post): the word is found as a Range, the pill is one empty element in the paragraph being read, and the
// muted rest is a CSS Custom Highlight (::highlight(tts-ahead)) where the browser has them. Off with the reader's
// «هایلایت کلمه‌ها» setting (html[data-words="off"]).
import type { Word } from './words';

type Spot = { node: Text; at: number };
const maps = new WeakMap<Element, Spot[]>();
const hasHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
const still = matchMedia('(prefers-reduced-motion: reduce)');

/** The element's text as the voice reads it (whitespace collapsed, trimmed: src/lib/lines.ts), character by character,
 *  back to the DOM. A space stands for the run of whitespace it replaced. */
function charMap(el: Element): Spot[] {
  const cached = maps.get(el);
  // Still the same text nodes? (A comment's highlight wraps part of a paragraph in <mark> later, splitting them.)
  const ok = (s?: Spot) => !s || (s.at < s.node.data.length && el.contains(s.node));
  if (cached && ok(cached[0]) && ok(cached[cached.length >> 1]) && ok(cached[cached.length - 1])) return cached;
  const out: Spot[] = [];
  let gap: Spot | null = null;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) {
    for (let i = 0; i < node.data.length; i++) {
      if (/\s/.test(node.data[i])) {
        if (out.length && !gap) gap = { node, at: i };
        continue;
      }
      if (gap) out.push(gap);
      gap = null;
      out.push({ node, at: i });
    }
  }
  maps.set(el, out);
  return out;
}

function range(el: Element, from: number, to: number): Range | null {
  const map = charMap(el);
  const a = map[from];
  const b = map[Math.min(to, map.length) - 1];
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.at);
  r.setEnd(b.node, b.at + 1);
  return r;
}

/** Character index (as the voice reads it) under a point of `el`, for a tapped word; -1 when not on its text. */
export function charAt(el: Element, x: number, y: number): number {
  const doc = el.ownerDocument as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
  const pos = doc.caretPositionFromPoint?.(x, y);
  const r = pos ? { node: pos.offsetNode, at: pos.offset } : (() => {
    const c = doc.caretRangeFromPoint?.(x, y);
    return c ? { node: c.startContainer, at: c.startOffset } : null;
  })();
  if (!r || !el.contains(r.node)) return -1;
  const map = charMap(el);
  const k = map.findIndex((s) => s.node === r.node && s.at >= r.at);
  return k >= 0 ? k : map.findIndex((s) => s.node === r.node);
}

let lit: { el: Element; pill: HTMLElement; top: number } | null = null;

export function clearWord() {
  lit?.pill.remove();
  lit?.el.classList.remove('has-word');
  lit = null;
  if (hasHighlights) CSS.highlights.delete('tts-ahead');
}

/** Lights `w` (characters of `el`'s text). */
export function showWord(el: Element, w: Word) {
  if (document.documentElement.dataset.words === 'off') return clearWord();
  const r = range(el, w.from, w.to);
  const box = r?.getClientRects()[0];
  if (!r || !box) return;
  if (lit?.el !== el) {
    clearWord();
    const pill = document.createElement('span');
    pill.className = 'tts-pill';
    pill.setAttribute('aria-hidden', 'true');
    el.append(pill);
    el.classList.add('has-word');
    lit = { el, pill, top: NaN };
  }
  const base = el.getBoundingClientRect();
  const x = box.left - base.left;
  const y = box.top - base.top;
  const { pill } = lit!;
  // Along a line it glides; onto the next line it jumps (a slide across the whole line reads as noise).
  pill.classList.toggle('jump', still.matches || Math.abs(y - lit!.top) > 2);
  lit!.top = y;
  pill.style.transform = `translate(${x - 3}px, ${y - 1}px)`;
  pill.style.width = `${box.width + 6}px`;
  pill.style.height = `${box.height + 2}px`;
  if (hasHighlights) {
    const ahead = document.createRange();
    ahead.setStart(r.endContainer, r.endOffset);
    ahead.setEnd(el, el.childNodes.length);
    CSS.highlights.set('tts-ahead', new Highlight(ahead));
  }
}
