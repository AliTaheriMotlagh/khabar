// A check on Gholam's numbers (PLAN.md P3-3), for /admin/ only: a number in his Persian text that looks like a slip of one
// the English source says. Gholam (an LLM) can slip a digit or a unit («۱۴ درصد» for 41%); this lists the stories to look at, it
// never changes his text. No model, no imports: the build and tests/checks.test.mjs share it.

const DIGITS: Record<string, string> = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const latin = (s: string) => s.replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]).replace(/٫/g, '.');
const URL = /https?:\/\/\S+/g;
// «۲٬۰۰۰» / "2,000" is one number, and a count (a year is never written with a separator).
const NUM = /\d{1,3}(?:[٬,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** The numbers a text says, as written ("1.3", "79"): years and small counts left out (a source spells "three", and
 *  Gholam dates the story himself). */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of latin((text || '').replace(URL, ' ')).match(NUM) ?? []) {
    const m = raw.replace(/[٬,]/g, '');
    const n = Number(m);
    if (n <= 12 && !m.includes('.')) continue;
    if (m === raw && Number.isInteger(n) && n >= 1990 && n <= 2099) continue;
    out.add(m.replace(/\.0+$/, ''));
  }
  return out;
}

const digitsOf = (n: string) => n.replace('.', '');
/** Two figures one slip apart: swapped digits (14 / 41), one digit wrong (79 / 78 is not: a different, real number
 *  can differ by one — only from three digits up), or the decimal point moved (1.5 / 15). */
export function nearMiss(a: string, b: string): boolean {
  if (a === b) return false;
  const da = digitsOf(a);
  const db = digitsOf(b);
  if (da.length !== db.length) return da.replace(/^0+/, '') === db.replace(/^0+/, '') && da.length > 1;
  if (da.length >= 2 && [...da].sort().join('') === [...db].sort().join('') && a.includes('.') === b.includes('.')) return true;
  if (da === db) return true; // same digits, decimal point elsewhere
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff += da[i] !== db[i] ? 1 : 0;
  return da.length >= 3 && diff === 1 && a.includes('.') === b.includes('.');
}

/** Numbers in `persian` that look like a slip of one in `english` (nearMiss) while the exact figure isn't there:
 *  [his, the source's]. Missing numbers alone say nothing — he reads the whole article, the data keeps its title. */
export function suspectNumbers(persian: string, english: string): [string, string][] {
  if ((english || '').replace(URL, '').length < 160) return [];
  const have = numbersIn(english);
  const out: [string, string][] = [];
  for (const n of numbersIn(persian)) {
    if (have.has(n)) continue;
    const twin = [...have].find((h) => nearMiss(n, h));
    if (twin) out.push([n, twin]);
  }
  return out;
}

/** Numbers in `persian` the `english` never has (also not as thousands: «۱۵۰۰» = "1.5K"/"1,500"). Empty when the
 *  source is too short to judge. */
export function unmatchedNumbers(persian: string, english: string): string[] {
  if ((english || '').replace(URL, '').length < 160) return [];
  const have = numbersIn(english);
  const en = latin(english);
  return [...numbersIn(persian)].filter((n) => {
    if (have.has(n)) return false;
    const v = Number(n);
    // 1500 = "1.5K", 2000000 = "2M": the same figure in another unit.
    for (const [div, unit] of [[1e3, 'k'], [1e6, 'm'], [1e9, 'b']] as const) {
      const short = String(v / div).replace(/\.0+$/, '');
      if (v >= div && new RegExp(`(?<![\\d.])${short.replace('.', '\\.')}\\s*${unit}`, 'i').test(en)) return false;
    }
    return true;
  });
}
