// The spoken form of a line (PLAN.md P2-2): Latin names and symbols replaced by how a Persian voice should say them,
// from the lexicon entries a story uses (its card.json `lex`, from data/lexicon.json). Shared by the cloud voice
// (server/tts.js) and the browser (src/lib/lines.ts: the device's and the downloaded voices, and the word highlight,
// which maps a spoken word back to the shown one). Plain JS, no imports.

const TOKEN = /\$\d[\d,.]*\s?[KMBT]?\b|[A-Za-z][\w.+&'/-]*/g;
const trim = (s) => s.replace(/[.,'/&-]+$/, '');

/** { say, map }: `map` is a list of [sayFrom, textFrom, sayLen, textLen] for each replaced word, in order. */
export function sayLine(text, lex) {
  if (!lex || !/[A-Za-z$]/.test(text)) return { say: text, map: [] };
  const low = new Map(Object.entries(lex).map(([k, v]) => [k.toLowerCase(), v]));
  let say = '';
  let last = 0;
  const map = [];
  for (const m of text.matchAll(TOKEN)) {
    const word = trim(m[0]);
    const to = low.get(word.toLowerCase());
    if (!to) continue;
    say += text.slice(last, m.index);
    map.push([say.length, m.index, to.length, word.length]);
    say += to;
    last = m.index + word.length;
  }
  return { say: say + text.slice(last), map };
}

/** A character of the spoken line → the same place in the shown one (a replaced word maps onto the whole word). */
export function toShown(map, i) {
  let shift = 0;
  for (const [sf, tf, sl, tl] of map) {
    if (i < sf) break;
    if (i < sf + sl) return tf + Math.round(((i - sf) / Math.max(1, sl)) * tl);
    shift = tf + tl - (sf + sl);
  }
  return i + shift;
}

/** A character of the shown line → the same place in the spoken one (a tapped word, to seek the clip to it). */
export function toSaid(map, i) {
  let shift = 0;
  for (const [sf, tf, sl, tl] of map) {
    if (i < tf) break;
    if (i < tf + tl) return sf + Math.round(((i - tf) / Math.max(1, tl)) * sl);
    shift = sf + sl - (tf + tl);
  }
  return i + shift;
}
